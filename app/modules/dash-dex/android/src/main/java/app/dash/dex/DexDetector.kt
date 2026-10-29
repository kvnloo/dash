package app.dash.dex

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.hardware.input.InputManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import android.view.InputDevice
import java.lang.ref.WeakReference

class DexDetector(private val app: Application, private val changed: (Map<String, Any?>) -> Unit) :
  DisplayManager.DisplayListener, Application.ActivityLifecycleCallbacks, ComponentCallbacks, InputManager.InputDeviceListener {
  private val displays = app.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
  private val inputs = app.getSystemService(Context.INPUT_SERVICE) as InputManager
  private var main = WeakReference<Activity>(null)
  private var knox = false
  private var previous: Map<String, Any?>? = null
  private val handler = Handler(Looper.getMainLooper())
  private val refresh = Runnable { publish() }
  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      knox = intent.action == ENTER
      publish()
    }
  }

  fun start(activity: Activity?) {
    track(activity)
    displays.registerDisplayListener(this, handler)
    inputs.registerInputDeviceListener(this, handler)
    app.registerActivityLifecycleCallbacks(this)
    app.registerComponentCallbacks(this)
    val filter = IntentFilter().apply { addAction(ENTER); addAction(EXIT) }
    if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    else app.registerReceiver(receiver, filter)
    publish()
  }

  fun stop() {
    handler.removeCallbacks(refresh)
    displays.unregisterDisplayListener(this)
    inputs.unregisterInputDeviceListener(this)
    app.unregisterActivityLifecycleCallbacks(this)
    app.unregisterComponentCallbacks(this)
    app.unregisterReceiver(receiver)
  }

  private fun track(activity: Activity?) {
    if (activity != null && activity.javaClass.simpleName == "MainActivity") main = WeakReference(activity)
  }

  fun mainActivity(): Activity? = main.get()?.takeUnless { it.isDestroyed || it.isFinishing }

  @Suppress("DEPRECATION")
  fun displayId(activity: Activity): Int = if (Build.VERSION.SDK_INT >= 30) {
    activity.display?.displayId ?: Display.DEFAULT_DISPLAY
  } else activity.windowManager.defaultDisplay.displayId

  /** A real (non-virtual) mouse or touchpad is attached: DeX, a Bluetooth mouse, a keyboard cover. */
  private fun pointerAttached(): Boolean = try {
    inputs.inputDeviceIds.any { id ->
      val device = inputs.getInputDevice(id) ?: return@any false
      !device.isVirtual && (device.supportsSource(InputDevice.SOURCE_MOUSE) || device.supportsSource(InputDevice.SOURCE_TOUCHPAD))
    }
  } catch (_: Exception) { false }

  /**
   * Android desktop windowing, which One UI 9 DeX is built on (launcher-integrated: honeyspace
   * dexservice; no desktopmode service, no legacy DeX packages): the activity is in a multi-window
   * mode whose window is smaller than its display in both dimensions (a floating, resizable window
   * rather than split screen), on a display at least tablet-sized. A phone's own screen
   * (smallest width < 600 dp) never counts, so One UI pop-up view on the phone is not "desktop".
   */
  private fun freeformWindow(activity: Activity): Boolean = try {
    if (Build.VERSION.SDK_INT < 30 || !activity.isInMultiWindowMode || activity.isInPictureInPictureMode) false
    else {
      val now = activity.windowManager.currentWindowMetrics.bounds
      val max = activity.windowManager.maximumWindowMetrics.bounds
      val density = activity.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
      now.width() < max.width() && now.height() < max.height() && minOf(max.width(), max.height()) / density >= 600f
    }
  } catch (_: Exception) { false }

  /**
   * An external, public display that DeX could be driving (wired HDMI/USB-C or Wireless DeX):
   * not the phone's panel, not app-private, not a virtual display, switched on. Android reports
   * such displays as presentation displays; One UI 9 puts DeX on them via desktop windowing.
   */
  private fun externalDisplay(): Display? = try {
    displays.getDisplays(DisplayManager.DISPLAY_CATEGORY_PRESENTATION).firstOrNull {
      it.displayId != Display.DEFAULT_DISPLAY && it.state == Display.STATE_ON &&
        (it.flags and Display.FLAG_PRIVATE) == 0 && (it.flags and Display.FLAG_PRESENTATION) != 0
    }
  } catch (_: Exception) { null }

  fun state(): Map<String, Any?> {
    val activity = mainActivity()
    val mainId = activity?.let { displayId(it) } ?: Display.DEFAULT_DISPLAY
    var tvId: Int? = null
    var mode = "off"
    var source = "none"
    // Priority is deliberate: public window/display APIs precede Samsung hooks.
    if (mainId != Display.DEFAULT_DISPLAY) {
      tvId = mainId; mode = "dual"; source = "activity-display"
    } else {
      val desk = displays.displays.firstOrNull {
        it.displayId != Display.DEFAULT_DISPLAY &&
          app.createDisplayContext(it).resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_DESK
      }
      val samsung = if (desk == null) displays.getDisplays(DESKTOP).firstOrNull { it.displayId != Display.DEFAULT_DISPLAY } else null
      if (desk != null || samsung != null) {
        tvId = (desk ?: samsung)?.displayId
        mode = "dual"; source = if (desk != null) "display-desk" else "samsung-category"
      } else if ((activity ?: app).resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_DESK) {
        // Public signal on the phone's own display: standalone DeX / desktop windowing reports desk ui mode.
        mode = "standalone"; source = "ui-mode-desk"
      } else {
        // Private, optional: getSystemService("desktopmode") is absent on One UI 8/9 (S22+, S25 scouted
        // 2026-10-28); reflection may disappear on any One UI update. No private failure escapes.
        try {
          val config = (activity ?: app).resources.configuration
          val enabled = config.javaClass.getField("semDesktopModeEnabled").getInt(config)
          if (enabled == 1) { mode = "standalone"; source = "samsung-configuration" }
        } catch (_: Exception) { }
        try {
          val service = app.getSystemService("desktopmode")
          val state = service?.javaClass?.getMethod("getDesktopModeState")?.invoke(service)
          val enabled = state?.javaClass?.getMethod("getEnabled")?.invoke(state) as? Int
          val type = state?.javaClass?.getMethod("getDisplayType")?.invoke(state) as? Int
          if (enabled == 4 && (type == 101 || type == 102)) {
            mode = if (type == 102) "dual" else "standalone"; source = "samsung-desktopmode"
          }
        } catch (_: Exception) { }
        if (mode == "off" && knox) { mode = "dual"; source = "knox-broadcast" }
      }
    }
    activity?.let { DexLifecycle.relaxOrientation(it, mainId) }
    val config = (activity ?: app).resources.configuration
    // "desktop" feeds only the desk layout (a lower width threshold). It never changes `mode`,
    // which gates the Pad and window moves, so a mis-read here cannot open or move anything.
    val freeform = activity?.let { freeformWindow(it) } == true
    val external = if (mode == "off" && !freeform) externalDisplay() else null
    val desktopSource = when {
      mode != "off" -> source
      freeform -> "freeform-window"
      external != null -> "external-display"
      else -> "none"
    }
    return mapOf("available" to true, "mode" to mode, "source" to source,
      "desktop" to (desktopSource != "none"), "desktopSource" to desktopSource,
      "freeform" to freeform, "externalDisplayId" to external?.displayId,
      "tvDisplayId" to tvId, "mainDisplayId" to mainId, "padOpen" to DashPadActivity.isOpen,
      "pointer" to pointerAttached(), "widthDp" to config.screenWidthDp,
      "uiModeDesk" to (config.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_DESK))
  }

  fun publish() {
    val next = state()
    if (next["mode"] == "off") DashPadActivity.close()
    if (previous != next) { previous = next; changed(next) }
  }

  override fun onDisplayAdded(id: Int) = publish()
  override fun onDisplayRemoved(id: Int) = publish()
  override fun onDisplayChanged(id: Int) = publish()
  override fun onConfigurationChanged(config: Configuration) = publish()
  override fun onInputDeviceAdded(id: Int) = publish()
  override fun onInputDeviceRemoved(id: Int) = publish()
  override fun onInputDeviceChanged(id: Int) = publish()
  override fun onLowMemory() { }
  override fun onActivityResumed(activity: Activity) { track(activity); publish() }
  override fun onActivityCreated(activity: Activity, saved: Bundle?) { track(activity) }
  override fun onActivityDestroyed(activity: Activity) { handler.post(refresh) }
  override fun onActivityStarted(activity: Activity) { }
  override fun onActivityStopped(activity: Activity) { }
  override fun onActivityPaused(activity: Activity) { }
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) { }

  companion object {
    const val DESKTOP = "com.samsung.android.hardware.display.category.DESKTOP"
    const val ENTER = "android.app.action.ENTER_KNOX_DESKTOP_MODE"
    const val EXIT = "android.app.action.EXIT_KNOX_DESKTOP_MODE"
  }
}
