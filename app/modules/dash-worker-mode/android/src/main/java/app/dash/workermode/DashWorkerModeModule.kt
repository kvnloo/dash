package app.dash.workermode

import android.content.SharedPreferences
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DashWorkerModeModule : Module() {
  private var observing: SharedPreferences? = null
  private val changed = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
    if (key == WORKER_MODE) sendEvent("workerModeChanged", emptyMap<String, Any>())
  }

  override fun definition() = ModuleDefinition {
    Name("DashWorkerMode")
    Events("workerModeChanged")
    Function("isWorkerMode") {
      appContext.reactContext?.let { modePreferences(it).getBoolean(WORKER_MODE, true) } ?: true
    }
    OnStartObserving {
      appContext.reactContext?.let {
        observing = modePreferences(it).also { preferences ->
          preferences.registerOnSharedPreferenceChangeListener(changed)
        }
      }
    }
    OnStopObserving { stopObserving() }
    OnDestroy { stopObserving() }
  }

  private fun stopObserving() {
    observing?.unregisterOnSharedPreferenceChangeListener(changed)
    observing = null
  }
}
