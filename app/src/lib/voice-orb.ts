import type { OrbPhase } from "../components/orb-html";
import type { VoicePhase } from "./voice-session";

/** Capture, bridge work and TTS events are authoritative; screen visibility isn't activity. */
export function voiceOrbPhase(phase: VoicePhase, started: boolean, error?: string): OrbPhase {
  if (!started || error) return "idle";
  return phase === "hearing" ? "listening" : phase;
}

export function recordingPhase(replyActive: boolean, awaitingReply: boolean): VoicePhase {
  return replyActive ? "speaking" : awaitingReply ? "thinking" : "listening";
}
