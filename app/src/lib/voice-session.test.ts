import { describe, expect, mock, test } from "bun:test";

// Native file access is replaced with a tiny captured-audio fixture in Bun.
mock.module("expo-file-system", () => ({
  File: class {
    async arrayBuffer(): Promise<ArrayBuffer> {
      return new Uint8Array([1, 2, 3]).buffer;
    }
  },
}));

const { VoiceSession, VoiceBootstrapSession } = await import("./voice-session");
import type { Recorder, VoicePhase, VoiceBootstrapPillState } from "./voice-session";

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

  test("End waits for native stop, clears the level and safely permits another call", async () => {
    const stopped = deferred();
    let recording = false;
    let started = 0;
    let stopCalls = 0;
    const levels: number[] = [];
    const phases: VoicePhase[] = [];
    const recorder: Recorder = {
      uri: null,
      prepareToRecordAsync: async () => {},
      record: () => { started++; recording = true; },
      stop: async () => { stopCalls++; await stopped.promise; recording = false; },
      getStatus: () => ({ isRecording: recording }),
    };
    const session = new VoiceSession(recorder, {
      onPhase: phase => phases.push(phase), onLevel: level => levels.push(level),
      onUtterance: () => false, onBargeIn: () => {},
      onError: message => { throw new Error(message); },
    });
    await session.start();
    const end = session.stop();
    const restart = session.start();
    await Promise.resolve(); // Native stop is scheduled on the next microtask.
    expect(started).toBe(1);
    expect(stopCalls).toBe(1);
    expect(levels.at(-1)).toBe(-160);
    expect(phases.at(-1)).toBe("idle");
    stopped.finish();
    await Promise.all([end, restart]);
    expect(started).toBe(2);
    expect(recording).toBe(true);
    expect(phases.at(-1)).toBe("listening");
    await session.stop();
    expect(recording).toBe(false);
  });

  test("a second End cancels a restart queued behind microphone teardown", async () => {
    const stopped = deferred();
    let recording = false;
    let starts = 0;
    const recorder: Recorder = {
      uri: null,
      prepareToRecordAsync: async () => {},
      record: () => { starts++; recording = true; },
      stop: async () => { await stopped.promise; recording = false; },
      getStatus: () => ({ isRecording: recording }),
    };
    const session = new VoiceSession(recorder, {
      onPhase: () => {}, onLevel: () => {},
      onUtterance: () => false, onBargeIn: () => {},
      onError: message => { throw new Error(message); },
    });
    await session.start();
    const end = session.stop();
    const queuedStart = session.start();
    const cancel = session.stop();
    stopped.finish();
    await Promise.all([end, queuedStart, cancel]);
    expect(starts).toBe(1);
    expect(recording).toBe(false);
    await session.stop();
  });

  test("a fresh call does not overlap a cancelled native preparation", async () => {
    const preparing = deferred();
    let preparations = 0;
    const voice = harness(() => ++preparations === 1 ? preparing.promise : Promise.resolve());
    const oldStart = voice.session.start();
    await voice.session.stop();
    const newStart = voice.session.start();
    expect(preparations).toBe(1);
    preparing.finish();
    await Promise.all([oldStart, newStart]);
    expect(preparations).toBe(2);
    expect(voice.records()).toBe(1);
    expect(voice.recording()).toBe(true);
    await voice.session.stop();
  });
});


describe("voice bootstrap pill and manual retry", () => {
  const attached = { profile: "hermes", session: "attached-session" };

  test("HTTP 503 publishes a short error with Retry, then succeeds only on tap", async () => {
    const states: VoiceBootstrapPillState[] = [];
    const targets: { profile: string; session: string }[] = [];
    let count = 0;
    const session = new VoiceBootstrapSession(async target => {
      count++;
      targets.push({ profile: target.profile, session: target.session });
      return count === 1
        ? Response.json({ error: "deployment disabled" }, { status: 503 })
        : Response.json({ ready: true, profile: target.profile, session: target.session });
    }, state => states.push(state));
    await session.start(attached);
    expect(session.state).toEqual({ phase: "error", message: "Voice is disabled on this bridge.", actionLabel: "Retry" });
    expect(states.map(state => state.phase)).toEqual(["connecting", "error"]);
    expect(count).toBe(1);
    await session.retry();
    expect(session.state).toEqual({ phase: "ready", message: "Voice ready" });
    expect(states.map(state => state.phase)).toEqual(["connecting", "error", "connecting", "ready"]);
    expect(targets).toEqual([attached, attached]);
    await session.retry();
    expect(count).toBe(2);
  });

  test("offline error exposes Retry and never retries by itself", async () => {
    let requests = 0;
    const session = new VoiceBootstrapSession(async () => {
      requests++;
      throw new TypeError("Network failed");
    }, () => {});
    await session.start(attached);
    expect(session.state).toEqual({ phase: "error", message: "Can't reach Dash voice. Check connection.", actionLabel: "Retry" });
    expect(requests).toBe(1);
    await session.retry();
    expect(requests).toBe(2);
    expect(session.state.phase).toBe("error");
  });

  test("cancel discards an in-flight response and disables stale Retry", async () => {
    const states: VoiceBootstrapPillState[] = [];
    let finish: (reply: Response) => void = () => { throw new Error("deferred not initialized"); };
    let requests = 0;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    const session = new VoiceBootstrapSession(() => {
      requests++;
      return pending;
    }, state => states.push(state));
    const starting = session.start(attached);
    await session.start(attached);
    expect(requests).toBe(1);
    session.cancel();
    finish(Response.json({ error: "unavailable" }, { status: 404 }));
    await starting;
    expect(session.state).toEqual({ phase: "idle", message: "" });
    expect(states.map(state => state.phase)).toEqual(["connecting", "idle"]);
    await session.retry();
    expect(requests).toBe(1);
  });
});
