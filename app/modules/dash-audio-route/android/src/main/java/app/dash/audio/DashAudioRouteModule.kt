package app.dash.audio

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class DashAudioRouteModule : Module() {
  private var audioManager: AudioManager? = null
  private var speakerRequested = false
  private var watchingDevices = false

  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
      updateSpeakerRoute()
    }

    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
      updateSpeakerRoute()
    }
  }

  private fun hasHeadset(audio: AudioManager): Boolean =
    audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { device ->
      when (device.type) {
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_ACCESSORY,
        AudioDeviceInfo.TYPE_USB_DEVICE,
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_HEARING_AID -> true
        else -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
          (device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
            device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER)
      }
    }

  @Synchronized
  @Suppress("DEPRECATION")
  private fun updateSpeakerRoute() {
    val audio = audioManager ?: return
    if (!speakerRequested) return
    val external = hasHeadset(audio)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (external) {
        audio.clearCommunicationDevice()
      } else {
        val speaker = audio.availableCommunicationDevices.firstOrNull {
          it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
        }
        if (speaker == null || !audio.setCommunicationDevice(speaker)) {
          audio.clearCommunicationDevice()
        }
      }
    } else {
      audio.isSpeakerphoneOn = !external
    }
  }

  @Synchronized
  private fun enableSpeaker() {
    val context = requireNotNull(appContext.reactContext)
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    audioManager = audio
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
    speakerRequested = true
    if (!watchingDevices) {
      audio.registerAudioDeviceCallback(devices, Handler(Looper.getMainLooper()))
      watchingDevices = true
    }
    updateSpeakerRoute()
  }

  @Synchronized
  @Suppress("DEPRECATION")
  private fun resetRoute() {
    speakerRequested = false
    val audio = audioManager ?: return
    if (watchingDevices) {
      audio.unregisterAudioDeviceCallback(devices)
      watchingDevices = false
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      audio.clearCommunicationDevice()
    } else {
      audio.isSpeakerphoneOn = false
    }
    audio.mode = AudioManager.MODE_NORMAL
    audioManager = null
  }

  override fun definition() = ModuleDefinition {
    Name("DashAudioRoute")

    AsyncFunction("setCallRoute") { route: String ->
      when (route) {
        "speaker" -> enableSpeaker()
        "default" -> resetRoute()
        else -> throw IllegalArgumentException("Unknown audio route: $route")
      }
    }

    OnDestroy { resetRoute() }
  }
}
