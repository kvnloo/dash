package app.dash.dex

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import java.lang.ref.WeakReference

/**
 * Uses the application's existing ReactHost, never a second React runtime.
 *
 * Note: ReactActivityDelegateWrapper removed — dash-dex is an autolinking
 * module that expo itself depends on, so adding expo as a dependency creates
 * a circular build dependency. DefaultReactActivityDelegate is sufficient for
 * DashPad; expo module lifecycle hooks via the wrapper are not required here.
 */
class DashPadActivity : ReactActivity() {
  companion object {
    private var attached = WeakReference<DashPadActivity>(null)
    val isOpen: Boolean get() = attached.get()?.let { !it.isFinishing && !it.isDestroyed } == true
    fun close() { attached.get()?.finish() }
  }

  override fun getMainComponentName() = "DashPad"
  override fun createReactActivityDelegate(): ReactActivityDelegate =
    DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
    attached = WeakReference(this)
  }

  override fun onDestroy() {
    if (attached.get() === this) attached.clear()
    super.onDestroy()
  }
}
