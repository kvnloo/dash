package app.dash.orb

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS surface of the z0live overlay orb. JS arms the service with the bridge's SSE URL and a
 * token while Dash is in front; from then on the native service follows the call by itself and
 * only calls back (onTokenNeeded) when it must reconnect with a fresh token.
 */
class DashVoiceOrbModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DashVoiceOrb")
    Events("onTokenNeeded")

    OnCreate {
      VoiceOrbService.tokenNeeded = { sendEvent("onTokenNeeded", emptyMap<String, Any>()) }
      VoiceOrbService.setAppForeground(true)
    }
    OnDestroy { VoiceOrbService.tokenNeeded = null }
    OnActivityEntersForeground { VoiceOrbService.setAppForeground(true) }
    OnActivityEntersBackground { VoiceOrbService.setAppForeground(false) }

    Function("canDrawOverlays") {
      val ctx = appContext.reactContext ?: return@Function false
      Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)
    }

    Function("isArmed") { VoiceOrbService.running() }

    AsyncFunction("requestOverlayPermission") {
      val ctx = appContext.reactContext ?: return@AsyncFunction
      ctx.startActivity(
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    /** Starts (or re-points) the foreground service. Call while Dash is in front. */
    AsyncFunction("arm") { eventsUrl: String, token: String ->
      val ctx = requireNotNull(appContext.reactContext) { "React context unavailable" }
      VoiceOrbService.arm(ctx.applicationContext, eventsUrl, token)
    }

    Function("setToken") { token: String -> VoiceOrbService.setToken(token) }

    AsyncFunction("disarm") {
      val ctx = appContext.reactContext ?: return@AsyncFunction
      VoiceOrbService.disarm(ctx.applicationContext)
    }
  }
}
