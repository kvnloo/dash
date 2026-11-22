package app.dash.workermode

import android.content.Context
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

internal const val WORKER_MODE = "worker"
internal fun modePreferences(context: Context) =
  context.getSharedPreferences("dash_worker_mode", Context.MODE_PRIVATE)

/** Runs in Dash's process even if the React activity has never been opened. */
class WorkerModeTile : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    render()
  }

  override fun onClick() {
    super.onClick()
    if (isLocked) unlockAndRun { toggle() } else toggle()
  }

  private fun toggle() {
    val preferences = modePreferences(this)
    preferences.edit().putBoolean(WORKER_MODE, !preferences.getBoolean(WORKER_MODE, true)).apply()
    render()
  }

  private fun render() {
    val tile = qsTile ?: return
    val worker = modePreferences(this).getBoolean(WORKER_MODE, true)
    val mode = getString(if (worker) R.string.dash_worker_mode else R.string.dash_me_mode)
    tile.state = if (worker) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      tile.label = getString(R.string.dash_mode_tile)
      tile.subtitle = mode
    } else {
      tile.label = mode
    }
    tile.contentDescription = mode
    tile.updateTile()
  }
}
