package app.dash.orb

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.view.WindowManager
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs

/**
 * Foreground service that keeps Dash's view of a z0live call alive while Dash is backgrounded.
 *
 * Armed by JS (while Dash is in front) with the bridge's /z0live/events URL and a bearer token.
 * A worker thread holds that SSE stream; every `z0live` event is a full snapshot
 * {live, orb, muted}. While a call is live and Dash is not in front, a small orb is drawn in a
 * TYPE_APPLICATION_OVERLAY window over whatever app is showing. Tokens are short-lived, so on
 * every reconnect the service asks JS (through [tokenNeeded]) for a fresh one.
 */
class VoiceOrbService : Service() {

  companion object {
    private const val TAG = "DashVoiceOrb"
    const val ACTION_ARM = "app.dash.orb.ARM"
    const val EXTRA_URL = "url"
    const val EXTRA_TOKEN = "token"

    private const val CHANNEL_ID = "z0live_orb"
    private const val NOTIFICATION_ID = 0xDA5001
    private const val READ_TIMEOUT_MS = 45_000 // bridge heartbeats every 15 s
    private const val MAX_BACKOFF_MS = 30_000L

    /** Set by the Expo module; asks JS to mint a token and call setToken. */
    @Volatile var tokenNeeded: (() -> Unit)? = null
    @Volatile private var instance: VoiceOrbService? = null
    @Volatile private var appForeground = true

    fun running() = instance != null

    fun setToken(token: String) { instance?.updateToken(token) }

    fun setAppForeground(foreground: Boolean) {
      appForeground = foreground
      instance?.let { s -> s.main.post { s.render() } }
    }

    fun arm(context: Context, url: String, token: String) {
      val intent = Intent(context, VoiceOrbService::class.java)
        .setAction(ACTION_ARM).putExtra(EXTRA_URL, url).putExtra(EXTRA_TOKEN, token)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }

    fun disarm(context: Context) { context.stopService(Intent(context, VoiceOrbService::class.java)) }

    fun label(orb: String) = when (orb) {
      "connecting" -> "connecting"
      "listening" -> "listening"
      "user" -> "you're speaking"
      "thinking" -> "thinking"
      "speaking" -> "speaking"
      "working" -> "working"
      "error" -> "lost the bridge"
      else -> "live"
    }
  }

  private data class Call(val live: Boolean, val orb: String, val muted: Boolean)

  private val main = Handler(Looper.getMainLooper())
  private var wm: WindowManager? = null
  private var orbView: OrbView? = null
  private var call = Call(false, "idle", false)
  private var notified: String? = null

  @Volatile private var url: String? = null
  @Volatile private var token: String? = null
  @Volatile private var running = false
  @Volatile private var conn: HttpURLConnection? = null
  private var worker: Thread? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    wm = getSystemService(WINDOW_SERVICE) as WindowManager
    createChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // startForegroundService requires startForeground on every start, before anything else.
    goForeground()
    if (intent?.action == ACTION_ARM) {
      val u = intent.getStringExtra(EXTRA_URL)
      val t = intent.getStringExtra(EXTRA_TOKEN)
      if (t != null) token = t
      if (u != null && u != url) { url = u; conn?.disconnect() }
      startWorker()
    }
    // Without JS there is no fresh token, so a system restart would only spin; JS re-arms.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    instance = null
    worker?.interrupt()
    conn?.disconnect()
    main.removeCallbacksAndMessages(null)
    hideOrb()
    super.onDestroy()
  }

  // ── Bridge stream ────────────────────────────────────────────────────────────────

  private fun updateToken(t: String) {
    token = t
    worker?.interrupt() // wake a backoff sleep
  }

  private fun startWorker() {
    if (worker?.isAlive == true) return
    running = true
    worker = Thread({ watch() }, "dash-voice-orb-sse").also { it.isDaemon = true; it.start() }
  }

  private fun watch() {
    var backoff = 1_000L
    while (running) {
      val u = url
      val t = token
      if (u != null && t != null) {
        try {
          if (stream(u, t)) backoff = 1_000L
        } catch (e: Exception) {
          if (running) Log.w(TAG, "z0live stream: ${e.javaClass.simpleName}: ${e.message}")
        }
      }
      if (!running) break
      main.post { onLinkLost() }
      tokenNeeded?.invoke()
      try { Thread.sleep(backoff) } catch (_: InterruptedException) { }
      backoff = (backoff * 2).coerceAtMost(MAX_BACKOFF_MS)
    }
  }

  /** Reads one SSE connection to the end. True when the bridge accepted it. */
  private fun stream(u: String, t: String): Boolean {
    val c = (URL(u).openConnection() as HttpURLConnection).apply {
      connectTimeout = 10_000
      readTimeout = READ_TIMEOUT_MS
      setRequestProperty("Authorization", "Bearer $t")
      setRequestProperty("Accept", "text/event-stream")
    }
    conn = c
    try {
      val code = c.responseCode
      if (code == 401 || code == 403) {
        if (token == t) token = null // wait for JS to mint a fresh one
        return false
      }
      if (code != 200) return false
      Log.i(TAG, "z0live stream connected")
      BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8)).use { reader ->
        var event = ""
        val data = StringBuilder()
        while (running) {
          val line = reader.readLine() ?: break
          when {
            line.isEmpty() -> {
              if (event == "z0live" && data.isNotEmpty()) deliver(data.toString())
              event = ""; data.setLength(0)
            }
            line.startsWith(":") -> Unit
            line.startsWith("event:") -> event = line.substring(6).trim()
            line.startsWith("data:") -> {
              if (data.isNotEmpty()) data.append('\n')
              data.append(line.substring(5).trimStart())
            }
          }
        }
      }
      return true
    } finally {
      c.disconnect()
      conn = null
    }
  }

  private fun deliver(json: String) {
    val next = try {
      val o = JSONObject(json)
      Call(o.optBoolean("live", false), o.optString("orb", "idle"), o.optBoolean("muted", false))
    } catch (_: Exception) { return }
    Log.i(TAG, "z0live live=${next.live} orb=${next.orb} muted=${next.muted}")
    main.post { call = next; render() }
  }

  /** Mid-call, a dropped stream is shown as the error orb until the bridge says otherwise. */
  private fun onLinkLost() {
    if (call.live && call.orb != "error") { call = call.copy(orb = "error"); render() }
  }

  // ── Rendering (main thread) ──────────────────────────────────────────────────────

  private fun render() {
    if (call.live && !appForeground && canDrawOverlays()) showOrb() else hideOrb()
    orbView?.update(call.orb, call.muted)
    val text = if (call.live) "z0live · ${label(call.orb)}${if (call.muted) " · muted" else ""}" else null
    if (text != notified) { notified = text; goForeground() }
  }

  private fun canDrawOverlays() = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)

  @SuppressLint("ClickableViewAccessibility")
  private fun showOrb() {
    if (orbView != null) return
    val size = OrbView.orbSizePx(this)
    val metrics = resources.displayMetrics
    val view = OrbView(this)
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
               else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
    val params = WindowManager.LayoutParams(
      size, size, type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = metrics.widthPixels - size - dp(6)
      y = (metrics.heightPixels * 0.28f).toInt()
      title = "z0live orb"
    }
    // Drag anywhere, snap to the nearer side edge on release; a tap opens Dash.
    val slop = ViewConfiguration.get(this).scaledTouchSlop
    var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var dragging = false
    view.setOnTouchListener { v, e ->
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; startX = params.x; startY = params.y; dragging = false; true }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - downX; val dy = e.rawY - downY
          if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
          if (dragging) {
            params.x = startX + dx.toInt(); params.y = startY + dy.toInt()
            wm?.updateViewLayout(v, params)
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          if (dragging) {
            val w = resources.displayMetrics.widthPixels
            params.x = if (params.x + size / 2 < w / 2) dp(6) else w - size - dp(6)
            params.y = params.y.coerceIn(dp(24), resources.displayMetrics.heightPixels - size - dp(24))
            wm?.updateViewLayout(v, params)
          } else openDash()
          true
        }
        else -> false
      }
    }
    try {
      wm?.addView(view, params)
      orbView = view
    } catch (e: Exception) {
      Log.w(TAG, "overlay addView failed: ${e.message}")
    }
  }

  private fun hideOrb() {
    orbView?.let { v -> try { wm?.removeView(v) } catch (_: Exception) { } }
    orbView = null
  }

  private fun openDash() {
    packageManager.getLaunchIntentForPackage(packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      ?.let { startActivity(it) }
  }

  // ── Notification ─────────────────────────────────────────────────────────────────

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val ch = NotificationChannel(CHANNEL_ID, "z0live orb", NotificationManager.IMPORTANCE_MIN)
      .apply { description = "Lets the z0live orb appear over other apps during a call"; setShowBadge(false) }
    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
  }

  private fun goForeground() {
    val n = notification(notified ?: "Ready to show the z0live orb")
    if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(NOTIFICATION_ID, n)
  }

  private fun notification(text: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) ?: Intent()
    val pi = PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
            else @Suppress("DEPRECATION") Notification.Builder(this)
    return b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setContentTitle("Dash")
      .setContentText(text)
      .setOngoing(true)
      .setContentIntent(pi)
      .build()
  }

  private fun dp(v: Int) = (v * resources.displayMetrics.density + 0.5f).toInt()
}
