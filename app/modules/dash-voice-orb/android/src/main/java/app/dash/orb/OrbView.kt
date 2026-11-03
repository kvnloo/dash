package app.dash.orb

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.View
import kotlin.math.*

/**
 * Animated Fibonacci dot-sphere orb, matching AgentOrb / orb-phase.ts visuals.
 * Runs a ValueAnimator-style clock on the main thread; draws with Canvas.drawCircle.
 * Phase → motion params ported verbatim from orb-phase.ts.
 */
class OrbView(context: Context) : View(context) {

    companion object {
        // 44 dp overlay size (minimum accessible touch target)
        const val ORB_DP = 44
        /** Call after a Context is available to get pixel size. */
        fun orbSizePx(context: Context): Int =
            TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, ORB_DP.toFloat(),
                context.resources.displayMetrics).toInt()

        // Fibonacci sphere: N dots on a sphere projected into 2D
        private const val N_DOTS = 80
        private val PHI = (1.0 + sqrt(5.0)) / 2.0

        /** Port of orbMotion() from orb-phase.ts */
        data class OrbMotion(
            val animated: Boolean,
            val spin: Double,   // deg per full clock revolution
            val base: Double,
            val amp: Double,
            val beats: Double,
            val wave: String,   // "cos" | "abs"
            val radiusX: Double, // 0..26 in 64-unit viewBox
            val radiusY: Double,
            val opacity: Double
        )

        fun orbMotion(phase: String): OrbMotion = when (phase) {
            "thinking"   -> OrbMotion(true,  360.0, 0.96, 0.04, 2.0, "cos", 26.0, 26.0, 1.0)
            "tool"       -> OrbMotion(true, -360.0, 0.96, 0.04, 2.0, "cos", 26.0, 26.0, 1.0)
            "streaming"  -> OrbMotion(true,  720.0, 0.96, 0.04, 2.0, "cos", 26.0, 18.0, 1.0)
            "listening"  -> OrbMotion(true,   90.0, 0.93, 0.03, 1.0, "cos", 23.0, 23.0, 1.0)
            "speaking"   -> OrbMotion(true,  540.0, 1.0,  0.07, 8.0, "abs", 26.0, 26.0, 1.0)
            "connecting" -> OrbMotion(true,  180.0, 0.9,  0.05, 1.0, "cos", 24.0, 24.0, 0.75)
            else         -> OrbMotion(false,   0.0, 1.0,  0.0,  0.0, "cos", 26.0, 26.0, 0.55)
        }

        /** Port of orbFrame() */
        fun orbFrame(m: OrbMotion, p: Double): Pair<Double, Double> {
            val wave = if (m.wave == "abs")
                abs(sin(p * PI * m.beats))
            else
                cos(p * PI * 2 * m.beats)
            return Pair(p * m.spin, m.base + m.amp * wave)
        }

        // Fibonacci sphere dot positions (fixed, unit sphere)
        private val DOT_X = DoubleArray(N_DOTS)
        private val DOT_Y = DoubleArray(N_DOTS)
        private val DOT_Z = DoubleArray(N_DOTS)

        init {
            for (i in 0 until N_DOTS) {
                val theta = acos(1.0 - 2.0 * (i + 0.5) / N_DOTS)
                val phi   = 2 * PI * i / PHI
                DOT_X[i] = sin(theta) * cos(phi)
                DOT_Y[i] = sin(theta) * sin(phi)
                DOT_Z[i] = cos(theta)
            }
        }
    }

    // ── State ──────────────────────────────────────────────────────────────

    private var phase: String = "connecting"
    private var muted: Boolean = false
    private var clockP: Double = 0.0          // 0..1 per 6 s cycle
    private var lastTick: Long = System.currentTimeMillis()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val handler = Handler(Looper.getMainLooper())
    private val CYCLE_MS = 6000.0

    // Phase-based colors (ARGB)
    private fun orbColor(phase: String, alpha: Float): Int {
        val base = when (phase) {
            "thinking"  -> 0xFFFFFFFF.toInt()
            "speaking"  -> 0xFFBBDDFF.toInt()
            "tool"      -> 0xFFFFCC88.toInt()
            "listening" -> 0xFFDDDDFF.toInt()
            else        -> 0xFFCCCCCC.toInt()
        }
        val a = (alpha * 255).toInt().coerceIn(0, 255)
        return (base and 0x00FFFFFF) or (a shl 24)
    }

    // ── Ticker ────────────────────────────────────────────────────────────

    private val tick = object : Runnable {
        override fun run() {
            val now = System.currentTimeMillis()
            val dt  = (now - lastTick).coerceAtMost(100)
            lastTick = now
            clockP = (clockP + dt / CYCLE_MS) % 1.0
            invalidate()
            handler.postDelayed(this, 16)  // ~60 fps
        }
    }

    init {
        handler.post(tick)
    }

    fun update(phase: String, muted: Boolean) {
        this.phase = phase
        this.muted = muted
        invalidate()
    }

    override fun onDetachedFromWindow() {
        handler.removeCallbacks(tick)
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toDouble()
        val h = height.toDouble()
        val cx = w / 2.0
        val cy = h / 2.0
        val radius = minOf(cx, cy) * 0.88   // slightly smaller than view

        val m = orbMotion(phase)
        val (rotateDeg, scale) = orbFrame(m, clockP)
        val rotateRad = Math.toRadians(rotateDeg)

        val opacityMult = if (muted) 0.45f else 1.0f
        val baseAlpha   = (m.opacity * opacityMult).toFloat()

        // Draw each Fibonacci dot, rotated around Y axis
        for (i in 0 until N_DOTS) {
            val x0 = DOT_X[i]
            val y0 = DOT_Y[i]
            val z0 = DOT_Z[i]

            // Y-axis rotation
            val x1 = x0 * cos(rotateRad) - z0 * sin(rotateRad)
            val z1 = x0 * sin(rotateRad) + z0 * cos(rotateRad)

            // Project onto 2D with simple perspective (z depth → alpha/size)
            val depth = (z1 + 1.0) / 2.0  // 0..1, front=1

            val px = cx + x1 * (m.radiusX / 26.0) * radius * scale
            val py = cy + y0 * (m.radiusY / 26.0) * radius * scale

            val dotR   = (radius * 0.055 * depth.coerceAtLeast(0.35)).toFloat()
            val dotA   = (baseAlpha * depth.coerceAtLeast(0.2).toFloat())
            paint.color = orbColor(phase, dotA)
            canvas.drawCircle(px.toFloat(), py.toFloat(), dotR, paint)
        }
    }
}
