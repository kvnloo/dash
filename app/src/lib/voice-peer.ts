import { Platform } from "react-native";
import type { VoicePeer } from "./continuous-voice";

// Available only to an explicitly flagged web-army export. Tokens are ephemeral
// per-test credentials minted by the local identity fixture, never persisted.
declare global {
  interface Window {
    __dashVoiceSay?: string;
    __dashVoiceNoTranscript?: boolean;
    __dashVoiceNeverReady?: boolean;
    /** Scripted multi-turn call (DA-024): no default utterance; the test speaks each turn with __dashVoiceUtter. */
    __dashVoiceScripted?: boolean;
    __dashVoiceUtter?: (text: string) => void;
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
  let spoken = "ARMY voice reply";
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
        if (window.__dashVoiceScripted) {
          let turn = 0;
          // One utterance: speech, then end of speech, then the streamed final transcript ~300 ms later.
          window.__dashVoiceUtter = (text: string) => {
            const n = ++turn;
            emit({ type: "input_audio_buffer.speech_started" });
            later(600, () => {
              performance.mark(`dash-voice-speech-stopped-${n}`);
              emit({ type: "input_audio_buffer.speech_stopped" });
            });
            later(800, () => emit({ type: "conversation.item.input_audio_transcription.delta", item_id: `army-voice-item-${n}`, delta: text.split(" ").slice(0, 2).join(" ") }));
            later(900, () => {
              performance.mark(`dash-voice-final-${n}`);
              emit({ type: "conversation.item.input_audio_transcription.completed", item_id: `army-voice-item-${n}`, transcript: text });
            });
          };
          return;
        }
        later(750, () => emit({ type: "input_audio_buffer.speech_started" }));
        later(1500, () => {
          performance.mark("dash-voice-speech-stopped");
          emit({ type: "input_audio_buffer.speech_stopped" });
        });
        // Streaming transcription: a partial of the first words before the completed utterance.
        if (!window.__dashVoiceNoTranscript) later(1900, () => emit({
          type: "conversation.item.input_audio_transcription.delta",
          item_id: "army-voice-item-1",
          delta: (window.__dashVoiceSay ?? "ARMY voice hello").split(" ").slice(0, 2).join(" "),
        }));
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
      if (window.__dashVoiceScripted && message.type === "conversation.item.create") {
        // Speak the result Dash handed over, so the caption shows which lane's answer is playing.
        const item: unknown = Reflect.get(message, "item");
        const content: unknown = typeof item === "object" && item !== null ? Reflect.get(item, "content") : undefined;
        const first: unknown = Array.isArray(content) ? content[0] : undefined;
        const text: unknown = typeof first === "object" && first !== null ? Reflect.get(first, "text") : undefined;
        const at = typeof text === "string" ? text.indexOf("Result: ") : -1;
        if (typeof text === "string" && at >= 0) {
          try { const said: unknown = JSON.parse(text.slice(at + 8)); if (typeof said === "string") spoken = said; } catch { /* keep the default line */ }
        }
        return;
      }
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
      const said = spoken;
      later(400, () => emit({ type: "response.output_audio_transcript.delta", delta: said.split(" ").slice(0, 2).join(" ") }));
      later(520, () => emit({ type: "response.output_audio_transcript.done", transcript: said }));
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
