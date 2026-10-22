import { expect, test } from "bun:test";
import { CaptureGate, RecordedSpeech } from "./recorded-speech";

function harness(gate = new CaptureGate()) {
  const events: string[] = [];
  let prepared = () => {};
  const speech = new RecordedSpeech("annotation", gate, {
    prepare: () => new Promise<void>(resolve => { prepared = resolve; }),
    record: () => { events.push("record"); }, stop: async () => { events.push("stop"); },
    transcribe: async () => "the marked button", text: text => { events.push(text); },
    changed: state => { events.push(state.phase); },
  });
  return { speech, gate, events, prepared: () => prepared() };
}
test("quick hold/release before permission/preparation resolves never starts a hot mic", async () => {
  const h = harness(); const begin = h.speech.begin();
  await h.speech.end(); h.prepared(); await begin;
  expect(h.events).not.toContain("record"); expect(h.gate.owner).toBeUndefined();
});
test("one capture owner, including while permission or preparation is pending", async () => {
  const h = harness(); const begin = h.speech.begin();
  expect(h.gate.acquire("live")).toBeUndefined();
  h.prepared(); await begin; await h.speech.end();
  expect(h.events).toContain("the marked button"); expect(h.gate.owner).toBeUndefined();
});
test("cancel on unmount discards only the new recording and frees the lease after cleanup", async () => {
  const h = harness(); const begin = h.speech.begin();
  const cancel = h.speech.cancel(); h.prepared(); await begin; await cancel;
  expect(h.events).not.toContain("the marked button"); expect(h.gate.owner).toBeUndefined();
});
test("record/stop/transcribe errors are visible and never clear the caller's draft", async () => {
  const states: string[] = []; const gate = new CaptureGate();
  const speech = new RecordedSpeech("dictation", gate, { prepare: async () => {}, record: () => {}, stop: async () => {}, transcribe: async () => { throw new Error("Transcription: HTTP 503"); }, text: () => { throw new Error("must not insert"); }, changed: state => { states.push(state.note ?? state.phase); } });
  await speech.begin(); await speech.end();
  expect(states).toContain("Transcription: HTTP 503"); expect(gate.owner).toBeUndefined();
});
test("stale release cannot free a later owner's capture", () => {
  const gate = new CaptureGate(); const release = gate.acquire("annotation");
  release?.(); const live = gate.acquire("live"); release?.();
  expect(gate.owner).toBe("live"); live?.();
});
