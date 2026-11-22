package app.dash.wallpaper

import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.view.Window
import android.view.WindowManager.LayoutParams
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import java.lang.ref.WeakReference

/** Ask WindowManager to composite the current wallpaper; never read it or forward app touches. */
class DashWallpaperModule : Module() {
  private data class Original(
    val window: WeakReference<Window>,
    val background: Drawable?,
    val format: Int,
    val wallpaperShown: Boolean,
    val wallpaperTouches: Boolean,
  )

  private var original: Original? = null

  override fun definition() = ModuleDefinition {
    Name("DashWallpaper")
    AsyncFunction("setEnabled") { enabled: Boolean ->
      val window = appContext.currentActivity?.window ?: return@AsyncFunction false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return@AsyncFunction false

      val attributes = window.attributes
      val saved = original?.takeIf { it.window.get() === window }
      if (enabled) {
        if (saved == null) {
          original = Original(
            WeakReference(window), window.decorView.background, attributes.format,
            attributes.flags and LayoutParams.FLAG_SHOW_WALLPAPER != 0,
            attributes.areWallpaperTouchEventsEnabled(),
          )
        }
        attributes.setWallpaperTouchEventsEnabled(false)
        window.attributes = attributes
        window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        window.setFormat(PixelFormat.TRANSLUCENT)
        window.addFlags(LayoutParams.FLAG_SHOW_WALLPAPER)
      } else if (saved != null) {
        window.setFlags(if (saved.wallpaperShown) LayoutParams.FLAG_SHOW_WALLPAPER else 0, LayoutParams.FLAG_SHOW_WALLPAPER)
        window.setBackgroundDrawable(saved.background)
        window.setFormat(saved.format)
        window.attributes = window.attributes.apply { setWallpaperTouchEventsEnabled(saved.wallpaperTouches) }
        original = null
      }
      enabled
    }.runOnQueue(Queues.MAIN)
  }
}
