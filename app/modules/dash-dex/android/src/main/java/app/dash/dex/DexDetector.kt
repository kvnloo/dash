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
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Display
import java.lang.ref.WeakReference

class DexDetector(private val app: Application, private val changed: (Map<String, Any?>) -> Unit) :
  DisplayManager.DisplayListener, Application.ActivityLifecycleCallbacks, ComponentCallbacks {
  private val displays = app.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager
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
      } else {
        // Private APIs may disappear on any One UI update. No private failure escapes.
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
    return mapOf("available" to true, "mode" to mode, "source" to source,
      "tvDisplayId" to tvId, "mainDisplayId" to mainId, "padOpen" to DashPadActivity.isOpen)
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
