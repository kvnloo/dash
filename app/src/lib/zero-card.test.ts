import { describe, expect, test } from "bun:test";
import { FLING, LIP, traceNow, tuckProgress, tuckSnap, tuckTransform } from "./zero-card";
import type { TraceSnapshot } from "../trace/model";

describe("zero card tuck", () => {
  test("constants", () => { expect([LIP, FLING]).toEqual([18, 500]); });
  test("velocity wins on a fling, otherwise the nearer state", () => {
    expect(tuckSnap(0.9, 501)).toBe(false);
    expect(tuckSnap(0.1, -501)).toBe(true);
    expect(tuckSnap(0.5, 500)).toBe(true);
    expect(tuckSnap(0.49, 0)).toBe(false);
    expect(tuckSnap(0.5, -500)).toBe(true);
  });
  test("drag progress: down tucks, up shows, clamped", () => {
    expect(tuckProgress(1, 50, 100)).toBe(0.5);
    expect(tuckProgress(0, -50, 100)).toBe(0.5);
    expect(tuckProgress(1, 500, 100)).toBe(0);
    expect(tuckProgress(0, -500, 100)).toBe(1);
    expect(tuckProgress(0.3, 10, 0)).toBe(0.3);
  });
  test("tucked slides down behind the bar leaving the lip, and shrinks", () => {
    expect(tuckTransform(1, 200)).toEqual({ translateY: 0, scale: 1 });
    expect(tuckTransform(0, 200)).toEqual({ translateY: 182, scale: 0.9 });
    expect(tuckTransform(0, 5)).toEqual({ translateY: 0, scale: 0.9 });
  });
});

describe("trace now", () => {
  const w = (id: string, status: string, s: number, e: number, model = "m") => ({ id, model, status, s, e, calls: 0, errors: 0, asks: [], resumed: false, isResume: false, density: [], fails: [], stalls: [] });
  const snap = (rows: unknown[]): TraceSnapshot => JSON.parse(JSON.stringify({ t0: "2026-10-21T00:00:00Z", now: 1000, bucketS: 60, read: "", actions: [], stats: { workers: 3, live: 1, cut: 0, resumed: 0, asks: 0, calls: 0, errors: 0, claudeUsed: 0, claudeResetH: 0, codexUsed: 0 }, owner: [], rows }));
  test("newest running worker is the current step; elapsed runs to now", () => {
    const s = snap([
      { key: "a", project: "Dash", goal: "old done", group: "earlier", workers: [w("1", "done", 0, 900)] },
      { key: "b", project: "Dash", goal: "live old", group: "live", workers: [w("2", "running", 100, 1000)] },
      { key: "c", project: "Zero", goal: "live new", group: "live", workers: [w("3", "running", 400, 1000, "opus")] },
    ]);
    expect(traceNow(s)).toEqual({ step: "live new", project: "Zero", model: "opus", elapsedS: 600, live: 1, workers: 3 });
  });
  test("with nothing running, the most recently ended worker; empty says so", () => {
    const s = snap([{ key: "a", project: "P", goal: "first", group: "earlier", workers: [w("1", "done", 0, 300), w("2", "interrupted", 100, 700)] }]);
    expect(traceNow(s)).toMatchObject({ step: "first", elapsedS: 600 });
    expect(traceNow(snap([]))).toMatchObject({ step: "No agent work reported", elapsedS: 0 });
  });
  test("order does not matter: newest running wins, and running beats a later-ended worker", () => {
    const newestFirst = snap([
      { key: "c", project: "Zero", goal: "live new", group: "live", workers: [w("3", "running", 400, 1000)] },
      { key: "b", project: "Dash", goal: "live old", group: "live", workers: [w("2", "running", 100, 1000)] },
    ]);
    expect(traceNow(newestFirst).step).toBe("live new");
    const runningFirst = snap([
      { key: "r", project: "P", goal: "running", group: "live", workers: [w("1", "running", 100, 500)] },
      { key: "d", project: "P", goal: "done later", group: "earlier", workers: [w("2", "done", 0, 800)] },
    ]);
    expect(traceNow(runningFirst)).toMatchObject({ step: "running", elapsedS: 900 });
  });
});
