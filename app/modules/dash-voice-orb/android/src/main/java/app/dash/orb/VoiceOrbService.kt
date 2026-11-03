package app.dash.orb

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.view.Gravity
import android.view.WindowManager

/** Foreground service that owns the overlay orb lifecycle. */
class VoiceOrbService : Service() {

    companion object {
        const val EXTRA_ACTION = "action"
        const val EXTRA_PHASE = "phase"
        const val EXTRA_MUTED = "muted"
        const val EXTRA_FOREGROUNDED = "foregrounded"

        const val ACTION_START = "start"
        const val ACTION_UPDATE = "update"
        const val ACTION_STOP = "stop"
        const val ACTION_APP_FOREGROUNDED = "appForegrounded"

        private const val CHANNEL_ID = "z0live_orb"
        private const val NOTIFICATION_ID = 0xDA5_001

        // Phase → notification text
        fun phaseLabel(phase: String) = when (phase) {
            "listening" -> "Listening…"
            "speaking"  -> "Speaking…"
            "thinking"  -> "Thinking…"
            "tool"      -> "Working…"
            "connecting"-> "Connecting…"
            else        -> "z0live active"
        }
    }

    private var wm: WindowManager? = null
    private var orbView: OrbView? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var appForegrounded = false

    // ── Lifecycle ──────────────────────────────────────────────────────────

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "z0live::OrbWakeLock").also {
            it.setReferenceCounted(false)
            it.acquire(30 * 60 * 1000L)  // max 30 min
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.getStringExtra(EXTRA_ACTION) ?: ACTION_START
        val phase  = intent?.getStringExtra(EXTRA_PHASE) ?: "connecting"
        val muted  = intent?.getBooleanExtra(EXTRA_MUTED, false) ?: false
        val fg     = intent?.getBooleanExtra(EXTRA_FOREGROUNDED, false) ?: false

        when (action) {
            ACTION_START -> {
                startForeground(NOTIFICATION_ID, buildNotification(phase, muted))
                if (!appForegrounded) showOrb(phase, muted)
            }
            ACTION_UPDATE -> {
                updateNotification(phase, muted)
                orbView?.update(phase, muted)
            }
            ACTION_STOP -> stopSelf()
            ACTION_APP_FOREGROUNDED -> {
                appForegrounded = fg
                if (fg) hideOrb() else orbView?.let { /* already shown */ } ?: showOrb(phase, muted)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        hideOrb()
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    // ── Overlay window ─────────────────────────────────────────────────────

    private fun showOrb(phase: String, muted: Boolean) {
        if (orbView != null) return
        val orbSizePx = OrbView.orbSizePx(this)
        val view = OrbView(this)
        view.update(phase, muted)
        val params = WindowManager.LayoutParams(
            orbSizePx, orbSizePx,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dpToPx(8)
            y = dpToPx(56)  // below status bar
        }
        wm?.addView(view, params)
        orbView = view
    }

    private fun hideOrb() {
        orbView?.let { wm?.removeView(it); orbView = null }
    }

    // ── Notifications ──────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, "z0live voice call", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Indicates an active z0live voice call" }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(ch)
        }
    }

    private fun buildNotification(phase: String, muted: Boolean): Notification {
        val contentText = "${phaseLabel(phase)}${if (muted) " · Muted" else ""}"
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        val pi = PendingIntent.getActivity(
            this, 0, launchIntent ?: Intent(),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("z0live")
                .setContentText(contentText)
                .setOngoing(true)
                .setContentIntent(pi)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("z0live")
                .setContentText(contentText)
                .setOngoing(true)
                .setContentIntent(pi)
                .build()
        }
    }

    private fun updateNotification(phase: String, muted: Boolean) {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIFICATION_ID, buildNotification(phase, muted))
    }

    private fun dpToPx(dp: Int): Int =
        (dp * resources.displayMetrics.density + 0.5f).toInt()
}
