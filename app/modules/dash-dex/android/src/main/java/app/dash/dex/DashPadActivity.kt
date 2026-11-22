package app.dash.dex

import android.app.Activity
import android.os.Bundle
import com.facebook.react.ReactApplication
import com.facebook.react.interfaces.fabric.ReactSurface
import java.lang.ref.WeakReference

/** MainActivity remains the ReactHost lifecycle owner even when both displays resume. */
class DashPadActivity : Activity() {
  companion object {
    private var attached = WeakReference<DashPadActivity>(null)
    val isOpen: Boolean get() = attached.get()?.let { !it.isFinishing && !it.isDestroyed } == true
    fun close() { attached.get()?.finish() }
  }

  private var surface: ReactSurface? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val host = (application as? ReactApplication)?.reactHost
    if (host?.currentReactContext == null) {
      // Android can restore this task independently after process death.
      finish()
      return
    }
    val pad = host.createSurface(this, "DashPad", null)
    val root = pad.view
    if (root == null) {
      pad.detach()
      finish()
      return
    }
    surface = pad
    attached = WeakReference(this)
    setContentView(root)
    pad.start()
  }

  override fun onDestroy() {
    if (attached.get() === this) attached.clear()
    surface?.stop()
    surface = null
    super.onDestroy()
  }
}
