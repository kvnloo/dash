package app.dash.glass

import android.app.Activity
import android.graphics.PixelFormat
import android.os.Build
import android.view.WindowManager
import android.annotation.TargetApi
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.function.Consumer

/**
 * Native window glass for the DASH_GLASS build. Inert until JS calls `set`: the classic build
 * autolinks this class but never invokes it, so its window is untouched.
 *
 * - Window.setBackgroundBlurRadius blurs whatever sits behind this window's (transparent)
 *   background: with android:windowShowWallpaper that is the wallpaper, live wallpapers included.
 * - FLAG_BLUR_BEHIND + LayoutParams.setBlurBehindRadius blurs everything behind the window.
 * - Both are honoured only while WindowManager.isCrossWindowBlurEnabled(); the listener re-applies
 *   when battery saver (or the developer toggle) flips it, and tells JS so it can raise the tint.
 */
class DashGlassModule : Module() {
  private var blurDp = 0.0
  private var behindDp = 0.0
  private var plan: GlassRadii.Plan? = null
  private var listener: Consumer<Boolean>? = null
  private var listenerOwner: WindowManager? = null

  override fun definition() = ModuleDefinition {
    Name("DashGlassWindow")
    Events("onCrossWindowBlurChanged")

    Function("state") { state() }

    AsyncFunction("set") { blurRadius: Double, behindRadius: Double ->
      blurDp = blurRadius
      behindDp = behindRadius
      val activity = appContext.currentActivity ?: return@AsyncFunction state()
      if (Build.VERSION.SDK_INT >= GlassRadii.MIN_SDK) ensureListener(activity)
      apply(activity)
      state()
    }.runOnQueue(Queues.MAIN)

    OnActivityDestroys { removeListener() }
    OnDestroy { removeListener() }
  }

  private fun apply(activity: Activity) {
    val window = activity.window ?: return
    val sdk = Build.VERSION.SDK_INT
    val enabled = sdk >= GlassRadii.MIN_SDK && crossWindowEnabled(activity)
    val density = activity.resources.displayMetrics.density
    val next = GlassRadii.plan(sdk, enabled, GlassRadii.toPx(blurDp, density), GlassRadii.toPx(behindDp, density))
    // Blur needs a non-opaque surface; a transparent windowBackground already implies this.
    window.setFormat(PixelFormat.TRANSLUCENT)
    if (sdk >= GlassRadii.MIN_SDK) applyBlur(activity, next)
    plan = next
  }

  @TargetApi(31)
  private fun applyBlur(activity: Activity, next: GlassRadii.Plan) {
    val window = activity.window
    window.setBackgroundBlurRadius(next.backgroundPx)
    val attrs = window.attributes
    if (next.blurBehindFlag) {
      attrs.flags = attrs.flags or WindowManager.LayoutParams.FLAG_BLUR_BEHIND
      attrs.setBlurBehindRadius(next.behindPx)
    } else {
      attrs.flags = attrs.flags and WindowManager.LayoutParams.FLAG_BLUR_BEHIND.inv()
      attrs.setBlurBehindRadius(0)
    }
    window.attributes = attrs
  }

  private fun crossWindowEnabled(activity: Activity): Boolean =
    Build.VERSION.SDK_INT >= GlassRadii.MIN_SDK && enabledApi31(activity)

  @TargetApi(31)
  private fun enabledApi31(activity: Activity): Boolean = activity.windowManager.isCrossWindowBlurEnabled

  @TargetApi(31)
  private fun ensureListener(activity: Activity) {
    if (listener != null) return
    val wm = activity.windowManager
    val l = Consumer<Boolean> { enabled ->
      appContext.currentActivity?.let { apply(it) }
      sendEvent("onCrossWindowBlurChanged", mapOf("enabled" to enabled, "mode" to plan?.mode?.wire))
    }
    wm.addCrossWindowBlurEnabledListener(activity.mainExecutor, l)
    listener = l
    listenerOwner = wm
  }

  private fun removeListener() {
    val l = listener ?: return
    if (Build.VERSION.SDK_INT >= GlassRadii.MIN_SDK) listenerOwner?.let { removeApi31(it, l) }
    listener = null
    listenerOwner = null
  }

  @TargetApi(31)
  private fun removeApi31(wm: WindowManager, l: Consumer<Boolean>) {
    runCatching { wm.removeCrossWindowBlurEnabledListener(l) }
  }

  private fun state(): Map<String, Any?> {
    val activity = appContext.currentActivity
    val sdk = Build.VERSION.SDK_INT
    val flags = activity?.window?.attributes?.flags ?: 0
    val enabled = activity != null && crossWindowEnabled(activity)
    return mapOf(
      "sdk" to sdk,
      "supported" to (sdk >= GlassRadii.MIN_SDK),
      "crossWindowBlurEnabled" to enabled,
      "showsWallpaper" to ((flags and WindowManager.LayoutParams.FLAG_SHOW_WALLPAPER) != 0),
      "mode" to (plan?.mode ?: GlassRadii.plan(sdk, enabled, 0, 0).mode).wire,
      "backgroundBlurPx" to (plan?.backgroundPx ?: 0),
      "blurBehindPx" to (plan?.behindPx ?: 0),
    )
  }
}
