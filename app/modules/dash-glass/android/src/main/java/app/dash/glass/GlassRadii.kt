package app.dash.glass

import kotlin.math.roundToInt

/** Pure decision: what the window applies for a requested radius on this device right now. */
object GlassRadii {
  /** Android clamps large radii internally; past ~120dp the cost rises with no visible gain. */
  const val MAX_DP = 120.0
  const val MIN_SDK = 31 // Build.VERSION_CODES.S: setBackgroundBlurRadius / setBlurBehindRadius

  enum class Mode(val wire: String) { BLUR("blur"), DISABLED("disabled"), UNSUPPORTED("unsupported") }

  data class Plan(val backgroundPx: Int, val behindPx: Int, val blurBehindFlag: Boolean, val mode: Mode)

  fun toPx(dp: Double, density: Float): Int {
    if (dp.isNaN() || density <= 0f) return 0
    return (dp.coerceIn(0.0, MAX_DP) * density).roundToInt()
  }

  /**
   * `crossWindowEnabled` is WindowManager.isCrossWindowBlurEnabled(): false under battery saver,
   * with "Allow window-level blurs" off, or on GPUs without support. Then JS falls back to tint only.
   */
  fun plan(sdk: Int, crossWindowEnabled: Boolean, backgroundPx: Int, behindPx: Int): Plan = when {
    sdk < MIN_SDK -> Plan(0, 0, false, Mode.UNSUPPORTED)
    !crossWindowEnabled -> Plan(0, 0, false, Mode.DISABLED)
    else -> Plan(backgroundPx.coerceAtLeast(0), behindPx.coerceAtLeast(0), behindPx > 0, Mode.BLUR)
  }
}
