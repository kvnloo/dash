package app.dash.cutout

import kotlin.math.roundToInt

/**
 * Pure px → DIP projection, converted exactly once here. JS must not multiply again.
 * Rects are the system's window-relative DisplayCutout bounding rects for the current rotation.
 */
object CutoutProjection {
  fun unsupported(): Map<String, Any?> = mapOf("supported" to false, "rects" to emptyList<Map<String, Double>>())

  fun project(
    rects: List<IntArray>,
    density: Float,
    windowWidthPx: Int,
    windowHeightPx: Int,
    safeInsetTopPx: Int,
    statusBarTopPx: Int,
    rotation: Int,
  ): Map<String, Any?>? {
    if (density <= 0f || windowWidthPx <= 0 || windowHeightPx <= 0) return null
    fun dip(px: Int): Double = (px / density * 100f).roundToInt() / 100.0
    val projected = rects.filter { it.size == 4 && it[2] > it[0] && it[3] > it[1] }.map {
      mapOf("x" to dip(it[0]), "y" to dip(it[1]), "width" to dip(it[2] - it[0]), "height" to dip(it[3] - it[1]))
    }
    return mapOf(
      "supported" to true,
      "rects" to projected,
      "density" to density.toDouble(),
      "windowWidth" to dip(windowWidthPx),
      "windowHeight" to dip(windowHeightPx),
      "safeInsetTop" to dip(safeInsetTopPx),
      "statusBarTop" to dip(statusBarTopPx),
      "rotation" to rotation,
    )
  }
}
