package app.dash.stylus

import android.graphics.Rect
import android.os.Handler
import android.os.Looper
import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.TextView
import android.widget.EditText
import java.util.WeakHashMap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

/** Observes only this app's window. All touch/hover events reach the original callback. */
class DashStylusModule : Module() {
  private var original: Window.Callback? = null
  private var observer: Window.Callback? = null
  private var window: Window? = null
  private var observing = false
  private var edges = ButtonEdges()
  private val selections = WeakHashMap<TextView, ActionMode.Callback?>()
  private val replyId = 0x0da501

  override fun definition() = ModuleDefinition {
    Name("DashStylus")
    Events("button", "replySelection")
    OnStartObserving("button") { observing = true; install() }
    OnStopObserving("button") { observing = false; uninstall() }
    OnActivityEntersForeground { if (observing) install() }
    OnActivityEntersBackground {
      edges.sample(false)?.let { sendEvent("button", mapOf("pressed" to it)) }
    }
    OnActivityDestroys { uninstall() }
    OnDestroy { uninstall() }
    AsyncFunction("regionText") { x: Double, y: Double, width: Double, height: Double ->
      val root = appContext.currentActivity?.window?.decorView
      if (root == null) "" else {
        val d = root.resources.displayMetrics.density
        val rect = Rect((x*d).toInt(), (y*d).toInt(), ((x+width)*d).toInt(), ((y+height)*d).toInt())
        textViews(topScreen(root) ?: root).mapNotNull { view ->
          val visible = Rect()
          val clipped = Rect(rect)
          if (!view.getGlobalVisibleRect(visible) || !clipped.intersect(visible)) null
          else {
            val layout = view.layout
            if (layout == null || view.text.isEmpty()) null else {
              val loc = IntArray(2); view.getLocationOnScreen(loc)
              val localTop = (clipped.top - loc[1] - view.totalPaddingTop + view.scrollY).coerceAtLeast(0)
              val localBottom = (clipped.bottom - loc[1] - view.totalPaddingTop + view.scrollY).coerceAtMost(layout.height - 1)
              if (localBottom < localTop) null else {
                val first = layout.getLineForVertical(localTop)
                val last = layout.getLineForVertical(localBottom)
                (first..last).map { line ->
                  val left = (clipped.left-loc[0]-view.totalPaddingLeft+view.scrollX).toFloat()
                  val right = (clipped.right-loc[0]-view.totalPaddingLeft+view.scrollX).toFloat()
                  val a = layout.getOffsetForHorizontal(line, left)
                  val b = layout.getOffsetForHorizontal(line, right)
                  view.text.subSequence(minOf(a,b), maxOf(a,b)).toString()
                }.filter { it.isNotBlank() }.joinToString("\n")
              }
            }
          }
        }.filter { it.isNotBlank() }.distinct().joinToString("\n").take(12000)
      }
    }.runOnQueue(Queues.MAIN)
  }

  /** Native-stack keeps the covered workspace mounted; never quote its occluded text. */
  private fun topScreen(root: View): View? {
    if (!root.isShown) return null
    if (root is ViewGroup) {
      for (i in root.childCount - 1 downTo 0) topScreen(root.getChildAt(i))?.let { return it }
    }
    return if (root.javaClass.name == "com.swmansion.rnscreens.Screen") root else null
  }
  private fun textViews(root: View): List<TextView> {
    if (!root.isShown) return emptyList()
    if (root is TextView) return listOf(root)
    if (root !is ViewGroup) return emptyList()
    return (0 until root.childCount).flatMap { textViews(root.getChildAt(it)) }
  }
  private fun installSelection(root: View) {
    textViews(root).filter { it.isTextSelectable && it !is EditText }.forEach { view ->
      if (!selections.containsKey(view)) {
        val previous = view.customSelectionActionModeCallback
        selections[view] = previous
        view.customSelectionActionModeCallback = selectionCallback(previous, view)
      }
    }
  }
  private fun selectionCallback(callback: ActionMode.Callback?, owner: TextView): ActionMode.Callback = object : ActionMode.Callback2() {
    private fun addReply(menu: Menu) {
      if (menu.findItem(replyId) == null) menu.add(Menu.NONE, replyId, Menu.NONE, "Reply to selection")
    }
    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
      val result = callback?.onCreateActionMode(mode, menu) ?: true
      if (result) addReply(menu)
      return result
    }
    override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean {
      callback?.onPrepareActionMode(mode, menu)
      addReply(menu)
      return true
    }
    override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean {
      if (item.itemId != replyId) return callback?.onActionItemClicked(mode, item) ?: false
      val a = owner.selectionStart; val b = owner.selectionEnd
      if (a < 0 || b < 0 || a == b) return false
      val text = owner.text.subSequence(minOf(a,b), maxOf(a,b)).toString()
      if (text.isNotBlank()) sendEvent("replySelection", mapOf("text" to text.take(12000)))
      mode.finish()
      return true
    }
    override fun onDestroyActionMode(mode: ActionMode) { callback?.onDestroyActionMode(mode) }
    override fun onGetContentRect(mode: ActionMode, view: View, outRect: Rect) {
      if (callback is ActionMode.Callback2) callback.onGetContentRect(mode, view, outRect)
      else super.onGetContentRect(mode, view, outRect)
    }
  }
  private fun sample(event: MotionEvent) {
    if ((0 until event.pointerCount).none { event.getToolType(it) == MotionEvent.TOOL_TYPE_STYLUS || event.getToolType(it) == MotionEvent.TOOL_TYPE_ERASER }) return
    val pressed = (event.buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY) != 0
    edges.sample(pressed)?.let { sendEvent("button", mapOf("pressed" to it)) }
  }
  private fun install() {
    appContext.currentActivity?.runOnUiThread {
      val next = appContext.currentActivity?.window ?: return@runOnUiThread
      if (next === window && next.callback === observer) return@runOnUiThread
      restore()
      val delegate = next.callback ?: return@runOnUiThread
      val wrapper = object : Window.Callback by delegate {
        override fun dispatchTouchEvent(event: MotionEvent): Boolean {
          if (event.actionMasked == MotionEvent.ACTION_DOWN) installSelection(next.decorView)
          sample(event)
          return delegate.dispatchTouchEvent(event)
        }
        override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean { sample(event); return delegate.dispatchGenericMotionEvent(event) }
      }
      window = next; original = delegate; observer = wrapper; edges = ButtonEdges(); next.callback = wrapper
    }
  }
  private fun restore() {
    selections.forEach { (view, callback) -> view.customSelectionActionModeCallback = callback }
    selections.clear()
    if (window?.callback === observer && original != null) window?.callback = original
    window = null; original = null; observer = null
  }
  private fun uninstall() { Handler(Looper.getMainLooper()).post { restore() } }
}
