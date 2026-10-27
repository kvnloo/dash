import { describe, expect, mock, test } from "bun:test";

// Native file access is replaced with a tiny captured-audio fixture in Bun.
mock.module("expo-file-system", () => ({
  File: class {
    async arrayBuffer(): Promise<ArrayBuffer> {
      return new Uint8Array([1, 2, 3]).buffer;
    }
  },
}));

const { VoiceSession } = await import("./voice-session");
import type { Recorder, VoicePhase } from "./voice-session";

function deferred(): { promise: Promise<void>; finish(): void } {
  let finish = (): void => {
    throw new Error("Deferred promise not initialized");
  };
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish: () => finish() };
}

function harness(prepare: () => Promise<void>) {
  let recording = false;
  let records = 0;
  const phases: VoicePhase[] = [];
  const errors: string[] = [];
  const recorder: Recorder = {
    uri: null,
    prepareToRecordAsync: prepare,
    record: () => {
      records++;
      recording = true;
    },
    stop: async () => {
      recording = false;
    },
    getStatus: () => ({ isRecording: recording }),
  };
  const session = new VoiceSession(recorder, {
    onPhase: (phase) => phases.push(phase),
    onLevel: () => {},
    onUtterance: () => {
      throw new Error("Unexpected utterance");
    },
    onBargeIn: () => {},
    onError: (message) => errors.push(message),
  });
  return { session, phases, errors, records: () => records, recording: () => recording };
}

describe("legacy voice session lifecycle", () => {
  test("utterance stays thinking through recorder restart and TTS pauses until real turn completion", async () => {
    const phases: VoicePhase[] = [];
    let recording = false;
    let db = -10;
    const recorder: Recorder = { uri: "fixture.m4a", prepareToRecordAsync: async () => {}, record: () => { recording = true; }, stop: async () => { recording = false; }, getStatus: () => ({ isRecording: recording, metering: db }) };
    const session = new VoiceSession(recorder, { onPhase: phase => phases.push(phase), onLevel() {}, onUtterance: () => true, onBargeIn() {}, onError: message => { throw new Error(message); } });
    await session.start();
    try {
      await Bun.sleep(600);
      db = -80;
      await Bun.sleep(1200);
      expect(recording).toBe(true);
      expect(phases.at(-1)).toBe("thinking");
      session.setReplyActive(true);
      expect(phases.at(-1)).toBe("speaking");
      session.setReplyActive(false);
      expect(phases.at(-1)).toBe("thinking");
      session.turnSettled();
      expect(phases.at(-1)).toBe("listening");
      await session.stop();
      session.setReplyActive(true);
      expect(phases.at(-1)).toBe("idle");
    } finally { await session.stop(); }
  });
  test("leaving during preparation never starts capture afterward", async () => {
    const preparation = deferred();
    const voice = harness(() => preparation.promise);
    const started = voice.session.start();
    await voice.session.stop();
    preparation.finish();
    await started;
    try {
      expect(voice.records()).toBe(0);
      expect(voice.recording()).toBe(false);
      expect(voice.phases).not.toContain("listening");
    } finally {
      await voice.session.stop();
    }
  });

  test("an old preparation cannot start capture after a new session replaces it", async () => {
    const first = deferred();
    const second = deferred();
    let preparations = 0;
    const voice = harness(() => (++preparations === 1 ? first.promise : second.promise));
    const oldStart = voice.session.start();
    await voice.session.stop();
    const newStart = voice.session.start();
    first.finish();
    await oldStart;
    try {
      expect(voice.records()).toBe(0);
      second.finish();
      await newStart;
      expect(voice.records()).toBe(1);
    } finally {
      second.finish();
      await newStart;
      await voice.session.stop();
    }
  });

  test("explicit start captures once and stop ends capture", async () => {
    const voice = harness(async () => {});
    expect(voice.records()).toBe(0);
    await voice.session.start();
    await voice.session.start();
    expect(voice.records()).toBe(1);
    expect(voice.recording()).toBe(true);
    await voice.session.stop();
    expect(voice.recording()).toBe(false);
    expect(voice.phases).toEqual(["listening", "idle"]);
  });
});
