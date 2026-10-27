import { expect, test } from "bun:test";
import { createTurnFuser, flowStageForFuseOutput } from "./turn-fuse";

function makeFuser(options: { joinWindowMs?: number; penIdleMs?: number } = {}) {
  let serial = 0;
  return createTurnFuser({
    ...options,
    newId: () => "id-" + ++serial,
  });
}

test("speech then pen at +1s shares the trace and opens a joined capture", () => {
  const fuser = makeFuser();
  expect(fuser.handle({ type: "speech-start", at: 0 })).toEqual([
    { kind: "turn-open", traceId: "id-1", generation: 0, at: 0 },
    { kind: "floor", event: "speech-start", traceId: "id-1" },
  ]);
  expect(fuser.handle({ type: "speech-stop", at: 100 })).toEqual([
    { kind: "floor", event: "speech-stop", traceId: "id-1" },
  ]);
  expect(fuser.handle({ type: "pen-down", at: 1100 })).toEqual([
    { kind: "commit", traceId: "id-1", generation: 0, at: 100, captureIds: [] },
    { kind: "generation-bump", traceId: "id-1", generation: 1 },
    { kind: "capture-open", captureId: "id-2", traceId: "id-1", joined: true },
  ]);
  expect(fuser.handle({ type: "pen-up", at: 1200 })).toEqual([]);
  expect(fuser.tick(1999)).toEqual([]);
  expect(fuser.tick(2000)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 1, at: 2000, captureIds: ["id-2"] },
  ]);
  expect(fuser.state().generation).toBe(1);
});

test("pen two seconds after speech stop starts a new trace", () => {
  const fuser = makeFuser();
  fuser.handle({ type: "speech-start", at: 0 });
  fuser.handle({ type: "speech-stop", at: 100 });
  expect(fuser.handle({ type: "pen-down", at: 2100 })).toEqual([
    { kind: "commit", traceId: "id-1", generation: 0, at: 100, captureIds: [] },
    { kind: "turn-open", traceId: "id-2", generation: 0, at: 2100 },
    { kind: "capture-open", captureId: "id-3", traceId: "id-2", joined: false },
  ]);
  expect(fuser.state().traceId).toBe("id-2");
});

test("join window is exclusive at 1500ms, and can be overridden", () => {
  const inside = makeFuser();
  inside.handle({ type: "speech-start", at: 0 });
  inside.handle({ type: "speech-stop", at: 100 });
  expect(inside.handle({ type: "pen-down", at: 1599 })).toContainEqual({
    kind: "capture-open", captureId: "id-2", traceId: "id-1", joined: true,
  });

  const edge = makeFuser();
  edge.handle({ type: "speech-start", at: 0 });
  edge.handle({ type: "speech-stop", at: 100 });
  expect(edge.handle({ type: "pen-down", at: 1600 })).toContainEqual({
    kind: "capture-open", captureId: "id-3", traceId: "id-2", joined: false,
  });

  const custom = makeFuser({ joinWindowMs: 2000 });
  custom.handle({ type: "speech-start", at: 0 });
  custom.handle({ type: "speech-stop", at: 100 });
  expect(custom.handle({ type: "pen-down", at: 1600 })).toContainEqual({
    kind: "capture-open", captureId: "id-2", traceId: "id-1", joined: true,
  });
});

test("when speech stops later, the commit time is the speech stop", () => {
  const fuser = makeFuser();
  fuser.handle({ type: "speech-start", at: 0 });
  fuser.handle({ type: "pen-down", at: 50 });
  fuser.handle({ type: "pen-up", at: 100 });
  expect(fuser.tick(899)).toEqual([]);
  expect(fuser.tick(900)).toEqual([]); // Speech is still running.
  fuser.handle({ type: "speech-stop", at: 1100 });
  expect(fuser.state().pendingCommitAt).toBe(1100);
  expect(fuser.tick(1100)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 0, at: 1100, captureIds: ["id-2"] },
  ]);
  expect(fuser.tick(1100)).toEqual([]);
  expect(fuser.tick(5000)).toEqual([]);
});

test("when pen goes idle later, the commit time is pen-up plus 800ms", () => {
  const fuser = makeFuser();
  fuser.handle({ type: "speech-start", at: 0 });
  fuser.handle({ type: "pen-down", at: 20 });
  fuser.handle({ type: "speech-stop", at: 100 });
  expect(fuser.tick(1000)).toEqual([]); // Pen is still down.
  fuser.handle({ type: "pen-up", at: 1100 });
  expect(fuser.state().pendingCommitAt).toBe(1900);
  expect(fuser.tick(1899)).toEqual([]);
  expect(fuser.tick(1900)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 0, at: 1900, captureIds: ["id-2"] },
  ]);
});

test("pen-only strokes share the uncommitted idle window and commit just once", () => {
  const fuser = makeFuser();
  expect(fuser.handle({ type: "pen-down", at: 10 })).toEqual([
    { kind: "turn-open", traceId: "id-1", generation: 0, at: 10 },
    { kind: "capture-open", captureId: "id-2", traceId: "id-1", joined: false },
  ]);
  fuser.handle({ type: "pen-up", at: 20 });
  expect(fuser.tick(819)).toEqual([]);
  expect(fuser.handle({ type: "pen-down", at: 820 })).toEqual([
    { kind: "commit", traceId: "id-1", generation: 0, at: 820, captureIds: ["id-2"] },
    { kind: "generation-bump", traceId: "id-1", generation: 1 },
    { kind: "capture-open", captureId: "id-3", traceId: "id-1", joined: true },
  ]);
  fuser.handle({ type: "pen-up", at: 900 });
  expect(fuser.handle({ type: "pen-down", at: 1000 })).toEqual([
    { kind: "capture-open", captureId: "id-4", traceId: "id-1", joined: true },
  ]);
  fuser.handle({ type: "pen-up", at: 1010 });
  expect(fuser.tick(1809)).toEqual([]);
  expect(fuser.tick(1810)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 1, at: 1810, captureIds: ["id-3", "id-4"] },
  ]);
});

test("pen-only turns hold until pen-up and accept interleaved speech", () => {
  const fuser = makeFuser();
  fuser.handle({ type: "pen-down", at: 0 });
  expect(fuser.tick(5000)).toEqual([]);
  expect(fuser.handle({ type: "speech-start", at: 5000 })).toEqual([
    { kind: "floor", event: "speech-start", traceId: "id-1" },
  ]);
  fuser.handle({ type: "pen-up", at: 5100 });
  fuser.handle({ type: "speech-stop", at: 5200 });
  expect(fuser.tick(5899)).toEqual([]);
  expect(fuser.tick(5900)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 0, at: 5900, captureIds: ["id-2"] },
  ]);
});

test("one generation bump per post-commit burst, then a new bump after next commit", () => {
  const fuser = makeFuser();
  fuser.handle({ type: "pen-down", at: 0 });
  fuser.handle({ type: "pen-up", at: 50 });
  expect(fuser.tick(850)).toContainEqual({
    kind: "commit", traceId: "id-1", generation: 0, at: 850, captureIds: ["id-2"],
  });

  expect(fuser.handle({ type: "pen-down", at: 950 })).toEqual([
    { kind: "generation-bump", traceId: "id-1", generation: 1 },
    { kind: "capture-open", captureId: "id-3", traceId: "id-1", joined: true },
  ]);
  fuser.handle({ type: "pen-up", at: 1000 });
  expect(fuser.handle({ type: "pen-down", at: 1200 })).toEqual([
    { kind: "capture-open", captureId: "id-4", traceId: "id-1", joined: true },
  ]);
  fuser.handle({ type: "pen-up", at: 1300 });
  expect(fuser.tick(2100)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 1, at: 2100, captureIds: ["id-3", "id-4"] },
  ]);
  expect(fuser.handle({ type: "speech-start", at: 2200 })).toEqual([
    { kind: "generation-bump", traceId: "id-1", generation: 2 },
    { kind: "floor", event: "speech-start", traceId: "id-1" },
  ]);
  fuser.handle({ type: "speech-stop", at: 2300 });
  expect(fuser.tick(2300)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 2, at: 2300, captureIds: [] },
  ]);
  expect(fuser.handle({ type: "speech-start", at: 4000 })).toEqual([
    { kind: "turn-open", traceId: "id-5", generation: 0, at: 4000 },
    { kind: "floor", event: "speech-start", traceId: "id-5" },
  ]);
});

test("stale events are dropped and counted without altering turn state", () => {
  const fuser = makeFuser();
  fuser.handle({ type: "pen-down", at: 100 });
  const before = fuser.state();
  expect(fuser.handle({ type: "speech-start", at: 99 })).toEqual([]);
  expect(fuser.handle({ type: "pen-up", at: Number.NaN })).toEqual([]);
  expect(fuser.tick(99)).toEqual([]);
  expect(fuser.state()).toEqual({ ...before, ignored: 2 });
  expect(fuser.handle({ type: "pen-up", at: 100 })).toEqual([]);
  expect(fuser.state().lastPenUp).toBe(100);
  expect(fuser.tick(900)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 0, at: 900, captureIds: ["id-2"] },
  ]);
  expect(fuser.handle({ type: "pen-down", at: 899 })).toEqual([]);
  expect(fuser.state().ignored).toBe(3);
});

test("speech events alone control floor outputs, even in deterministic pen fuzzing", () => {
  let seed = 0x1234abcd;
  function next(): number {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  }
  for (let run = 0; run < 120; run++) {
    const fuser = makeFuser();
    let at = 0;
    for (let step = 0; step < 80; step++) {
      at += next() % 47;
      const event = next() % 2 === 0 ? "pen-down" : "pen-up";
      const outputs = fuser.handle({ type: event, at });
      expect(outputs.some(output => output.kind === "floor")).toBe(false);
      if (step % 7 === 0) {
        expect(fuser.tick(at).some(output => output.kind === "floor")).toBe(false);
      }
    }
    expect(fuser.tick(at + 10000).some(output => output.kind === "floor")).toBe(false);
  }
});

test("nested pen-down calls cannot commit while a capture remains down", () => {
  const fuser = makeFuser();
  fuser.handle({ type: "pen-down", at: 0 });
  fuser.handle({ type: "pen-down", at: 1 });
  fuser.handle({ type: "pen-up", at: 2 });
  expect(fuser.state().penDown).toBe(true);
  expect(fuser.tick(10000)).toEqual([]);
  fuser.handle({ type: "pen-up", at: 10001 });
  expect(fuser.tick(10801)).toEqual([
    { kind: "commit", traceId: "id-1", generation: 0, at: 10801, captureIds: ["id-2", "id-3"] },
  ]);
});

test("snapshots and commit capture lists are defensive copies", () => {
  const fuser = makeFuser();
  fuser.handle({ type: "pen-down", at: 0 });
  fuser.handle({ type: "pen-up", at: 10 });
  const snapshot = fuser.state();
  snapshot.captureIds.push("injected");
  expect(fuser.state().captureIds).toEqual(["id-2"]);
  const outputs = fuser.tick(810);
  const commit = outputs.find(output => output.kind === "commit");
  if (commit?.kind !== "commit") throw new Error("Expected commit output");
  commit.captureIds.push("injected");
  expect(fuser.state().captureIds).toEqual(["id-2"]);
});

test("stage labels match existing Flow trace names without importing native tracing", () => {
  const fuser = makeFuser();
  const begin = fuser.handle({ type: "speech-start", at: 0 });
  expect(begin.map(flowStageForFuseOutput)).toEqual([null, "vad.start"]);
  const stop = fuser.handle({ type: "speech-stop", at: 1 });
  expect(stop.map(flowStageForFuseOutput)).toEqual([null]);
  const commit = fuser.tick(1);
  expect(commit.map(flowStageForFuseOutput)).toEqual(["turn.commit"]);
  const ink = fuser.handle({ type: "pen-down", at: 2 });
  expect(ink.map(flowStageForFuseOutput)).toEqual(["gen.bump", "ink.down"]);
  fuser.handle({ type: "pen-up", at: 3 });
  expect(fuser.tick(803).map(flowStageForFuseOutput)).toEqual(["turn.commit"]);
});

test("invalid windows fail immediately instead of producing invalid deadlines", () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => makeFuser({ joinWindowMs: value })).toThrow();
    expect(() => makeFuser({ penIdleMs: value })).toThrow();
  }
  const instant = makeFuser({ penIdleMs: 0 });
  instant.handle({ type: "pen-down", at: 50 });
  instant.handle({ type: "pen-up", at: 60 });
  expect(instant.tick(60)).toContainEqual({
    kind: "commit", traceId: "id-1", generation: 0, at: 60, captureIds: ["id-2"],
  });
});
