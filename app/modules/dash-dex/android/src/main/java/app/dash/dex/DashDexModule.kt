package app.dash.dex

import android.app.ActivityOptions
import android.app.Application
import android.content.Intent
import android.view.Display
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DashDexModule : Module() {
  private var detector: DexDetector? = null

  private fun detection(): DexDetector {
    detector?.let { return it }
    val context = requireNotNull(appContext.reactContext) { "React context unavailable" }
    return DexDetector(context.applicationContext as Application) { sendEvent("dexState", it) }.also {
      detector = it
      it.start(appContext.currentActivity)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("DashDex")
    Events("dexState")
    AsyncFunction("getState") { detection().state() }.runOnQueue(Queues.MAIN)
    OnStartObserving { appContext.currentActivity?.runOnUiThread { detection().publish() } }
    AsyncFunction("openPad") {
      val d = detection()
      check(d.state()["mode"] != "off") { "Desktop mode is not active" }
      val activity = requireNotNull(d.mainActivity()) { "Main activity unavailable" }
      val intent = Intent(activity, DashPadActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent, ActivityOptions.makeBasic().apply {
        launchDisplayId = Display.DEFAULT_DISPLAY
      }.toBundle())
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("closePad") { DashPadActivity.close() }.runOnQueue(Queues.MAIN)
    AsyncFunction("moveMainToDex") {
      val d = detection()
      val activity = requireNotNull(d.mainActivity()) { "Main activity unavailable" }
      val displayId = d.state()["tvDisplayId"] as? Int
        ?: error("No launchable desktop display; standalone/private signals alone cannot launch a window")
      val intent = Intent(activity, activity.javaClass).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      activity.startActivity(intent, ActivityOptions.makeBasic().apply { launchDisplayId = displayId }.toBundle())
    }.runOnQueue(Queues.MAIN)
    OnDestroy {
      val old = detector
      detector = null
      android.os.Handler(android.os.Looper.getMainLooper()).post { old?.stop() }
    }
  }
}
