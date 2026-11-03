package app.dash.orb

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.TypedValue
import android.view.Choreographer
import android.view.View
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The AgentOrb dot sphere for the system overlay, drawn on a hardware Canvas (Android's HWUI
 * renders Canvas through Skia). Motion is a straight port of orbMotion/orbFrame in
 * app/src/lib/orb-phase.ts on the same 6 s clock; "user" and "error" are overlay-only phases.
 */
class OrbView(context: Context) : View(context) {

  companion object {
    const val ORB_DP = 44
    fun orbSizePx(context: Context): Int =
      TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, ORB_DP.toFloat(), context.resources.displayMetrics).toInt()

    private const val CYCLE_MS = 6000.0
    private const val N_DOTS = 96 // orbDotCount() for a 21..159 px orb
    private val GOLDEN = PI * (3.0 - sqrt(5.0))
    private val DX = DoubleArray(N_DOTS)
    private val DY = DoubleArray(N_DOTS)
    private val DZ = DoubleArray(N_DOTS)

    init {
      for (i in 0 until N_DOTS) {
        val y = 1.0 - 2.0 * (i + 0.5) / N_DOTS
        val r = sqrt(1.0 - y * y)
        val t = GOLDEN * i
        DX[i] = cos(t) * r; DY[i] = y; DZ[i] = sin(t) * r
      }
    }

    /** orb-phase.ts OrbMotionParams. */
    data class Motion(
      val animated: Boolean, val spin: Double, val base: Double, val amp: Double, val beats: Double,
      val abs: Boolean, val radiusX: Double, val radiusY: Double, val opacity: Double,
    )

    /** orbMotion(), keyed by the overlay orb vocabulary (working = tool). */
    fun motion(orb: String): Motion = when (orb) {
      "thinking" -> Motion(true, 360.0, 0.96, 0.04, 2.0, false, 26.0, 26.0, 1.0)
      "working" -> Motion(true, -360.0, 0.96, 0.04, 2.0, false, 26.0, 26.0, 1.0)
      "listening" -> Motion(true, 90.0, 0.93, 0.03, 1.0, false, 23.0, 23.0, 1.0)
      "speaking" -> Motion(true, 540.0, 1.0, 0.07, 8.0, true, 26.0, 26.0, 1.0)
      "connecting" -> Motion(true, 180.0, 0.9, 0.05, 1.0, false, 24.0, 24.0, 0.75)
      // Overlay-only: the caller's voice gets a quicker, smaller outward pulse than the agent's.
      "user" -> Motion(true, 180.0, 0.97, 0.05, 6.0, true, 25.0, 25.0, 1.0)
      "error" -> Motion(false, 0.0, 1.0, 0.0, 0.0, false, 26.0, 26.0, 1.0)
      else -> Motion(false, 0.0, 1.0, 0.0, 0.0, false, 26.0, 26.0, 0.55)
    }

    /** orbFrame(): rotate degrees and scale at clock position p in 0..1. */
    fun frame(m: Motion, p: Double): Pair<Double, Double> {
      val wave = if (m.abs) abs(sin(p * PI * m.beats)) else cos(p * PI * 2 * m.beats)
      return Pair(p * m.spin, m.base + m.amp * wave)
    }

    fun color(orb: String): Int = when (orb) {
      "speaking" -> 0xFF9CC8FF.toInt()
      "user" -> 0xFF8CF0C0.toInt()
      "working" -> 0xFFFFC46B.toInt()
      "error" -> 0xFFFF5A5A.toInt()
      "listening" -> 0xFFD8D8FF.toInt()
      else -> 0xFFFFFFFF.toInt()
    }
  }

  private var orb = "connecting"
  private var muted = false
  private var clock = 0.0
  private var last = 0L
  private val dot = Paint(Paint.ANTI_ALIAS_FLAG)
  private val disc = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xCC000000.toInt() }
  private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
  private val ticker = object : Choreographer.FrameCallback {
    override fun doFrame(now: Long) {
      if (last != 0L) clock = (clock + (now - last).coerceAtMost(100_000_000L) / 1e6 / CYCLE_MS) % 1.0
      last = now
      invalidate()
      if (isAttachedToWindow && motion(orb).animated) Choreographer.getInstance().postFrameCallback(this)
      else last = 0L
    }
  }

  init {
    contentDescription = "z0live call"
  }

  fun update(orb: String, muted: Boolean) {
    val wasAnimated = motion(this.orb).animated
    this.orb = orb
    this.muted = muted
    contentDescription = "z0live: ${VoiceOrbService.label(orb)}${if (muted) ", muted" else ""}"
    if (!wasAnimated && motion(orb).animated && isAttachedToWindow) Choreographer.getInstance().postFrameCallback(ticker)
    invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    Choreographer.getInstance().postFrameCallback(ticker)
  }

  override fun onDetachedFromWindow() {
    Choreographer.getInstance().removeFrameCallback(ticker)
    last = 0L
    super.onDetachedFromWindow()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val cx = width / 2f
    val cy = height / 2f
    val r = minOf(cx, cy)
    // Dark disc so the white dots read over any app, light or dark.
    canvas.drawCircle(cx, cy, r, disc)
    val tint = color(orb)
    if (orb == "error" || muted) {
      ring.color = if (orb == "error") tint else 0x99FFFFFF.toInt()
      ring.strokeWidth = r * 0.08f
      canvas.drawCircle(cx, cy, r * 0.94f, ring)
    }
    val m = motion(orb)
    val (deg, scale) = frame(m, clock)
    val a = Math.toRadians(deg)
    val ca = cos(a); val sa = sin(a)
    val sphere = r * 0.8 * scale / 26.0 // viewBox units -> px
    val alpha = m.opacity * (if (muted) 0.45 else 1.0)
    for (i in 0 until N_DOTS) {
      val x = DX[i] * ca + DZ[i] * sa
      val z = -DX[i] * sa + DZ[i] * ca
      val depth = (z + 1.0) / 2.0 // 0 back .. 1 front
      val px = cx + x * m.radiusX * sphere
      val py = cy + DY[i] * m.radiusY * sphere
      dot.color = (tint and 0x00FFFFFF) or (((alpha * (0.25 + 0.75 * depth)) * 255).toInt().coerceIn(0, 255) shl 24)
      canvas.drawCircle(px.toFloat(), py.toFloat(), (r * (0.035 + 0.035 * depth)).toFloat(), dot)
    }
  }
}
