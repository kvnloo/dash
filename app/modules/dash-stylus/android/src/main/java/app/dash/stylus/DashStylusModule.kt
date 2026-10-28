package app.dash.stylus

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.Window
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Watches only Dash's own window; every motion reaches the original callback. */
class DashStylusModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var observing = false
  private var window: Window? = null
  private var original: Window.Callback? = null
  private var observer: Window.Callback? = null
  private var edges = ButtonEdges()

  override fun definition() = ModuleDefinition {
    Name("DashStylus")
    Events("button")
    OnStartObserving("button") { onMain { observing = true; install() } }
    OnStopObserving("button") { onMain { observing = false; restore() } }
    OnActivityEntersForeground { onMain { if (observing) install() } }
    OnActivityEntersBackground { onMain { restore() } }
    OnActivityDestroys { onMain { restore() } }
    OnDestroy { onMain { observing = false; restore() } }
    AsyncFunction("getUptimeMillis") { SystemClock.uptimeMillis().toDouble() }
  }

  private fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post(action)
  }

  private fun sample(event: MotionEvent) {
    if ((0 until event.pointerCount).none {
        val tool = event.getToolType(it)
        tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER
      }) return
    val pressed = (event.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY) != 0
    edges.sample(pressed)?.let { sendEvent("button", mapOf("pressed" to it)) }
  }

  private fun release() {
    edges.sample(false)?.let { sendEvent("button", mapOf("pressed" to it)) }
  }

  private fun install() {
    val next = appContext.currentActivity?.window ?: return
    if (next === window && next.callback === observer) return
    restore()
    val delegate = next.callback ?: return
    val wrapper = object : Window.Callback by delegate {
      override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        try { sample(event) } catch (error: Exception) {
          Log.w("DashStylus", "Could not observe stylus touch; forwarding event", error)
        }
        return delegate.dispatchTouchEvent(event)
      }
      override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        try { sample(event) } catch (error: Exception) {
          Log.w("DashStylus", "Could not observe stylus hover; forwarding event", error)
        }
        return delegate.dispatchGenericMotionEvent(event)
      }
    }
    window = next
    original = delegate
    observer = wrapper
    edges = ButtonEdges()
    next.callback = wrapper
  }

  private fun restore() {
    if (observing) release() else edges = ButtonEdges()
    if (window?.callback === observer && original != null) window?.callback = original
    window = null
    original = null
    observer = null
  }
}
