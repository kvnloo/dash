package app.dash.share

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.sharing.SharingSingleton

class DashShareModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("DashShareFiles")
    AsyncFunction("consume") {
      val intent = synchronized(SharingSingleton) {
        val current = SharingSingleton.intent
        SharingSingleton.intent = null
        current
      }
      intent?.let { ShareInbox(requireNotNull(appContext.reactContext)).consume(it) }
    }
    AsyncFunction("discard") { id: String ->
      ShareInbox(requireNotNull(appContext.reactContext)).discard(id)
    }
  }
}
