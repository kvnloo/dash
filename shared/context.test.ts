import { describe, expect, test } from "bun:test";
import { compactionResult, contextTone, parseContext, parsePlan, tokenLabel, type ContextSnapshot } from "./context";
export function contextFixture(patch: Partial<ContextSnapshot> = {}): ContextSnapshot {
  return { sessionId: "scratch", model: "test", used: 600_000, maximum: 1_000_000, threshold: 850_000, estimated: true, source: "local estimate", categories: [{ id: "messages", label: "Messages", tokens: 600_000, estimated: true, details: [] }], revision: "before", notes: [], ...patch };
}
describe("context display math and boundary", () => {
  test("uses trigger before warning colour; exact boundaries", () => {
    expect(contextTone(contextFixture({ used: 800_000 }))).toBe("normal");
    expect(contextTone(contextFixture({ used: 800_001 }))).toBe("amber");
    expect(contextTone(contextFixture({ used: 850_000 }))).toBe("red");
    expect(contextTone(contextFixture({ threshold: 500_000 }))).toBe("red");
    expect(contextTone(contextFixture({ maximum: 0, threshold: 0 }))).toBe("normal");
  });
  test("only verified compaction changes report savings", () => {
    const before = contextFixture();
    expect(compactionResult(before, contextFixture({ used: 80_000, revision: "summary-1" }))).toBe(520_000);
    expect(compactionResult(before, contextFixture({ used: 80_000 }))).toBeUndefined();
    expect(compactionResult(before, contextFixture({ used: 600_000, revision: "new" }))).toBeUndefined();
    expect(compactionResult(before, contextFixture({ used: 900_000, revision: "new" }))).toBeUndefined();
  });
  test("round-trips explicit projections, rejects malformed counts", () => {
    expect(parseContext(contextFixture())).toEqual(contextFixture());
    expect(parseContext({ ...contextFixture(), provider: "anthropic", parentSessionId: "root" })).toEqual({ ...contextFixture(), provider: "anthropic", parentSessionId: "root" });
    expect(parseContext({ ...contextFixture(), provider: "", parentSessionId: null })).toEqual(contextFixture());
    expect(parseContext({ ...contextFixture(), provider: 3, parentSessionId: 4 })).toEqual(contextFixture());
    for (const bad of [null, {}, { ...contextFixture(), used: -1 }, { ...contextFixture(), maximum: Infinity }, { ...contextFixture(), notes: [3] }, { ...contextFixture(), categories: [{ id: "x", tokens: 2 }] }]) expect(parseContext(bad)).toBeUndefined();
    expect(parsePlan({ provider: "claude", windows: [{ label: "Weekly", percent: 24, resetsAt: "later" }] })?.windows[0]?.percent).toBe(24);
    expect(parsePlan({ provider: "codex", windows: [{ label: "Weekly", percent: 101 }] })).toBeUndefined();
  });
  test("compact labels", () => {
    expect(tokenLabel(999)).toBe("999"); expect(tokenLabel(1000)).toBe("1.0k"); expect(tokenLabel(604100)).toBe("604.1k"); expect(tokenLabel(1_000_000)).toBe("1.0M");
  });
});

describe("compaction availability", () => {
  test("only the explicit 501 unavailable answer marks the host as not carrying compaction", async () => {
    const { compactionUnavailable } = await import("./context");
    expect(compactionUnavailable(501, { ok: false, code: "unavailable", error: "Compaction is not available on this host" })).toBe(true);
    for (const [status, value] of [[409, { ok: false, code: "unavailable" }], [501, { ok: true, code: "unavailable" }], [501, { ok: false, code: "outcome_unknown" }], [501, null], [404, { error: "not found" }], [200, { ok: true, code: "committed" }]] as const) {
      expect(compactionUnavailable(status, value)).toBe(false);
    }
  });
});
