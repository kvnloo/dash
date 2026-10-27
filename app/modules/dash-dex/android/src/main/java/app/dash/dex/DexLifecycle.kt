package app.dash.dex

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.Display
import java.util.WeakHashMap

object DexLifecycle {
  private val orientations = WeakHashMap<Activity, Int>()

  fun relaxOrientation(activity: Activity, displayId: Int) {
    if (displayId != Display.DEFAULT_DISPLAY) {
      if (!orientations.containsKey(activity)) orientations[activity] = activity.requestedOrientation
      if (activity.requestedOrientation != ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED) {
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
      }
    } else {
      orientations.remove(activity)?.let { activity.requestedOrientation = it }
    }
  }
}
