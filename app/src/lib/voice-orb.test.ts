import { expect, test } from "bun:test";
import { recordingPhase, voiceOrbPhase } from "./voice-orb";

test("voice orb maps capture, work, TTS, stop and error states", () => {
  expect(voiceOrbPhase("listening", true)).toBe("listening");
  expect(voiceOrbPhase("hearing", true)).toBe("listening");
  expect(voiceOrbPhase("thinking", true)).toBe("thinking");
  expect(voiceOrbPhase("speaking", true)).toBe("speaking");
  expect(voiceOrbPhase("idle", false)).toBe("idle");
  expect(voiceOrbPhase("thinking", false)).toBe("idle");
  expect(voiceOrbPhase("speaking", true, "Microphone denied")).toBe("idle");
});
test("capture restarts and TTS gaps preserve pending work", () => {
  expect(recordingPhase(false, true)).toBe("thinking");
  expect(recordingPhase(true, true)).toBe("speaking");
  expect(recordingPhase(true, false)).toBe("speaking");
  expect(recordingPhase(false, false)).toBe("listening");
});
