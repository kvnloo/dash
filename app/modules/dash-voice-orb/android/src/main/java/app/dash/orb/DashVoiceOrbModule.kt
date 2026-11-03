package app.dash.orb

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DashVoiceOrbModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("DashVoiceOrb")

        AsyncFunction("startOrb") { phase: String, muted: Boolean ->
            val ctx = appContext.reactContext ?: return@AsyncFunction
            if (!canDrawOverlays(ctx)) return@AsyncFunction
            val intent = Intent(ctx, VoiceOrbService::class.java).apply {
                putExtra(VoiceOrbService.EXTRA_ACTION, VoiceOrbService.ACTION_START)
                putExtra(VoiceOrbService.EXTRA_PHASE, phase)
                putExtra(VoiceOrbService.EXTRA_MUTED, muted)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent)
            } else {
                ctx.startService(intent)
            }
        }

        AsyncFunction("updateOrb") { phase: String, muted: Boolean ->
            val ctx = appContext.reactContext ?: return@AsyncFunction
            val intent = Intent(ctx, VoiceOrbService::class.java).apply {
                putExtra(VoiceOrbService.EXTRA_ACTION, VoiceOrbService.ACTION_UPDATE)
                putExtra(VoiceOrbService.EXTRA_PHASE, phase)
                putExtra(VoiceOrbService.EXTRA_MUTED, muted)
            }
            ctx.startService(intent)
        }

        AsyncFunction("stopOrb") {
            val ctx = appContext.reactContext ?: return@AsyncFunction
            val intent = Intent(ctx, VoiceOrbService::class.java).apply {
                putExtra(VoiceOrbService.EXTRA_ACTION, VoiceOrbService.ACTION_STOP)
            }
            ctx.startService(intent)
        }

        AsyncFunction("setAppForegrounded") { foregrounded: Boolean ->
            val ctx = appContext.reactContext ?: return@AsyncFunction
            val intent = Intent(ctx, VoiceOrbService::class.java).apply {
                putExtra(VoiceOrbService.EXTRA_ACTION, VoiceOrbService.ACTION_APP_FOREGROUNDED)
                putExtra(VoiceOrbService.EXTRA_FOREGROUNDED, foregrounded)
            }
            ctx.startService(intent)
        }

        Function("getOverlayPermissionGranted") {
            val ctx = appContext.reactContext ?: return@Function false
            canDrawOverlays(ctx)
        }

        AsyncFunction("requestOverlayPermission") {
            val ctx = appContext.reactContext ?: return@AsyncFunction
            if (!canDrawOverlays(ctx)) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:${ctx.packageName}")
                ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                ctx.startActivity(intent)
            }
        }
    }

    private fun canDrawOverlays(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)
}
