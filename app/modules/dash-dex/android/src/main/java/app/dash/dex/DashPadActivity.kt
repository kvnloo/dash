package app.dash.dex

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper
import java.lang.ref.WeakReference

/** Uses the application's existing ReactHost, never a second React runtime. */
class DashPadActivity : ReactActivity() {
  companion object {
    private var attached = WeakReference<DashPadActivity>(null)
    val isOpen: Boolean get() = attached.get()?.let { !it.isFinishing && !it.isDestroyed } == true
    fun close() { attached.get()?.finish() }
  }

  override fun getMainComponentName() = "DashPad"
  override fun createReactActivityDelegate(): ReactActivityDelegate =
    ReactActivityDelegateWrapper(this, true, DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled))

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    attached = WeakReference(this)
  }

  override fun onDestroy() {
    if (attached.get() === this) attached.clear()
    super.onDestroy()
  }
}
