import Constants, { ExecutionEnvironment } from "expo-constants";
// Namespace import: names resolve at call time, so linking never needs a static PermissionsAndroid export.
import * as ReactNative from "react-native";
import type { VoicePeer } from "./continuous-voice";

/** Native media only. Import lazily after rejecting Expo Go, which has no WebRTC module. */
/** The react-native surface this module needs; tests pass their own (bun module mocks are process-wide). */
export type VoicePeerHost = Pick<typeof ReactNative, "PermissionsAndroid" | "Platform">;

export async function createVoicePeer(event: (raw: string) => void, ready: () => void, lost: () => void, host: VoicePeerHost = ReactNative): Promise<VoicePeer> {
  const { PermissionsAndroid, Platform } = host;
  if (Platform.OS !== "android" || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) throw new Error("Native continuous voice is unavailable in Expo Go. Install the reviewed native Dash APK.");
  const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (permission !== PermissionsAndroid.RESULTS.GRANTED) throw new Error("Microphone permission denied.");
  const { RTCPeerConnection, mediaDevices } = require("react-native-webrtc") as typeof import("react-native-webrtc");
  const peer = new RTCPeerConnection({ iceServers: [] });
  let closed = false;
  let notified = false;
  const stream = await mediaDevices.getUserMedia({ audio: true, video: false }).catch(error => { peer.close(); throw error; });
  // Muted until ICE AND the data channel are ready; native remote audio renders automatically.
  for (const track of stream.getAudioTracks()) { track.enabled = false; peer.addTrack(track, stream); }
  const channel = peer.createDataChannel("oai-events");
  const check = () => {
    if (closed) return;
    if (!notified && peer.connectionState === "connected" && channel.readyState === "open") { notified = true; ready(); }
    if (["failed", "disconnected", "closed"].includes(peer.connectionState)) lost();
  };
  peer.addEventListener("connectionstatechange", check);
  channel.addEventListener("open", check);
  channel.addEventListener("close", () => { if (!closed) lost(); });
  channel.addEventListener("message", message => { if (!closed && typeof message.data === "string" && message.data.length <= 131072) event(message.data); });
  channel.addEventListener("error", () => { if (!closed) lost(); });
  return {
    async offer() {
      const description: unknown = await peer.createOffer({ offerToReceiveAudio: true });
      if (typeof description !== "object" || description === null || !("sdp" in description) || typeof description.sdp !== "string") throw new Error("No SDP offer");
      await peer.setLocalDescription({ type: "offer", sdp: description.sdp });
      // OpenAI signaling accepts the initial SDP; ICE candidates gather during the HTTP exchange.
      return peer.localDescription?.sdp ?? description.sdp;
    },
    async answer(sdp) { if (!closed) await peer.setRemoteDescription({ type: "answer", sdp }); },
    mute(value) { for (const track of stream.getAudioTracks()) track.enabled = !value && !closed; },
    send(value) { if (closed) return; if (channel.readyState !== "open" || channel.bufferedAmount >= 262144) { lost(); return; } channel.send(JSON.stringify(value)); },
    close() {
      if (closed) return;
      closed = true;
      for (const track of stream.getTracks()) { track.enabled = false; track.stop(); }
      channel.close(); peer.close(); stream.release();
    },
  };
}
