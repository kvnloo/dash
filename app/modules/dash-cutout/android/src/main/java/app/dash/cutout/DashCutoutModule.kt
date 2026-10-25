package app.dash.cutout

import android.os.Build
import android.view.View
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Read-only display cut-out geometry for this app's own window. No overlay, no permission.
 * Returns null until the window has insets (before attach), so JS keeps its safe-area fallback.
 */
class DashCutoutModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DashDisplayCutout")
    Function("read") {
      val view: View = appContext.currentActivity?.window?.decorView ?: return@Function null
      read(view)
    }
  }

  @Suppress("DEPRECATION")
  private fun read(view: View): Map<String, Any?>? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return CutoutProjection.unsupported()
    val insets = view.rootWindowInsets ?: return null
    val cutout = insets.displayCutout
    val rects = cutout?.boundingRects.orEmpty().map { intArrayOf(it.left, it.top, it.right, it.bottom) }
    @Suppress("DEPRECATION")
    val rotation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) view.display?.rotation ?: 0
      else appContext.currentActivity?.windowManager?.defaultDisplay?.rotation ?: 0
    return CutoutProjection.project(
      rects = rects,
      density = view.resources.displayMetrics.density,
      windowWidthPx = view.width,
      windowHeightPx = view.height,
      safeInsetTopPx = cutout?.safeInsetTop ?: 0,
      statusBarTopPx = insets.stableInsetTop,
      rotation = rotation,
    )
  }
}
