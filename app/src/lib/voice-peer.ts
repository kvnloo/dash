import { Platform } from "react-native";
import type { VoicePeer } from "./continuous-voice";

// Available only to an explicitly flagged web-army export. Tokens are ephemeral
// per-test credentials minted by the local identity fixture, never persisted.
declare global {
  interface Window {
    __dashVoiceSay?: string;
    __dashVoiceNoTranscript?: boolean;
    __dashVoiceNeverReady?: boolean;
    __dashVoiceSpeechStoppedAt?: number;
    __dashVoiceArmy?: {
      dash: string;
      z0live: string;
      identity: { credentialId: string };
    };
  }
}

export async function createVoicePeer(
  event: (raw: string) => void,
  ready: () => void,
  _lost: () => void,
): Promise<VoicePeer> {
  if (Platform.OS !== "web" || process.env.EXPO_PUBLIC_DASH_VOICE_FAKE !== "1") {
    throw new Error("Continuous voice is unavailable in Expo Go/web. Use the reviewed native Dash APK.");
  }

  let closed = false;
  let muted = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const emit = (message: { type: string; [key: string]: unknown }) => {
    if (!closed && (!muted || !message.type.startsWith("input_audio_buffer."))) event(JSON.stringify(message));
  };
  const later = (ms: number, callback: () => void) => {
    const timer = setTimeout(() => { timers.delete(timer); if (!closed) callback(); }, ms);
    timers.add(timer);
  };
  return {
    async offer() { return "v=0 army-scripted-offer"; },
    async answer(sdp: string) {
      if (!sdp.startsWith("v=0")) throw new Error("Scripted voice peer received invalid SDP");
      if (window.__dashVoiceNeverReady) return; // Valid SDP, but ICE/data-channel readiness never arrives.
      later(950, () => {
        ready();
        later(750, () => emit({ type: "input_audio_buffer.speech_started" }));
        later(1500, () => {
          window.__dashVoiceSpeechStoppedAt = performance.now();
          emit({ type: "input_audio_buffer.speech_stopped" });
        });
        if (!window.__dashVoiceNoTranscript) later(2300, () => emit({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "army-voice-item-1",
          transcript: window.__dashVoiceSay ?? "ARMY voice hello",
        }));
      });
    },
    mute(value: boolean) { muted = value; },
    send(message: object) {
      if (!("type" in message)) return;
      if (message.type === "session.update") {
        // The provider/broker owns transcription configuration. This is its scripted echo.
        later(30, () => emit({
          type: "session.updated",
          session: { audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" } } } },
        }));
        return;
      }
      if (message.type !== "response.create") return;
      later(180, () => emit({ type: "response.created" }));
      later(280, () => emit({ type: "output_audio_buffer.started" }));
      later(520, () => emit({ type: "response.output_audio_transcript.done", transcript: "ARMY voice reply" }));
      later(930, () => emit({ type: "output_audio_buffer.stopped" }));
      later(1100, () => emit({ type: "response.done" }));
    },
    close() {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
