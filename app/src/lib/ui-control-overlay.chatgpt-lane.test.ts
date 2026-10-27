import { describe, expect, test } from "bun:test";
import {
  createOverlayState,
  reduceOverlay,
  DISMISS_COOLDOWN_MS,
  MAX_OVERLAY_ITEMS,
  MAX_OVERLAY_LOG,
  type OverlayState,
  type UiControlCommandShape,
} from "./ui-control-overlay";

function point(id: string, ttlMs = 1_000): UiControlCommandShape {
  return { type: "point", id, target: { x: 0.25, y: 0.75 }, ttlMs };
}

function put(state: OverlayState, command: UiControlCommandShape, at: number): OverlayState {
  return reduceOverlay(state, { type: "command", command, at });
}

describe("agent overlay state reducer", () => {
  test("starts enabled and adds point, highlight, and drawn marks with visible receipts", () => {
    let state = createOverlayState();
    expect(state).toEqual({ enabled: true, items: [], log: [] });

    state = put(state, { type: "point", id: "p", target: { testID: "send_btn" }, label: "Tap here", ttlMs: 250 }, 100);
    state = put(state, { type: "highlight", id: "h", testID: "chat_row", ttlMs: 1_000 }, 101);
    state = put(state, { type: "draw", id: "d", color: "gold", strokes: [{ points: [[0, 0], [1, 1]] }], ttlMs: 500 }, 102);

    expect(state.items).toEqual([
      { kind: "point", id: "p", target: { testID: "send_btn" }, label: "Tap here", createdAt: 100, ttlMs: 250 },
      { kind: "highlight", id: "h", testID: "chat_row", createdAt: 101, ttlMs: 1_000 },
      { kind: "draw", id: "d", color: "gold", strokes: [{ points: [[0, 0], [1, 1]] }], createdAt: 102, ttlMs: 500 },
    ]);
    expect(state.log).toEqual([
      { id: "p", kind: "point", at: 100 },
      { id: "h", kind: "highlight", at: 101 },
      { id: "d", kind: "draw", at: 102 },
    ]);
    expect(state.pendingNavigate).toBeUndefined();
  });

  test("tick expires at the exact inclusive TTL boundary and keeps newer items", () => {
    let state = put(createOverlayState(), point("short", 250), 100);
    state = put(state, point("long", 500), 101);
    state = reduceOverlay(state, { type: "tick", at: 349 });
    expect(state.items.map((item) => item.id)).toEqual(["short", "long"]);

    state = reduceOverlay(state, { type: "tick", at: 350 });
    expect(state.items.map((item) => item.id)).toEqual(["long"]);
    expect(state.log.at(-1)).toEqual({ id: "short", kind: "expired", at: 350 });

    state = reduceOverlay(state, { type: "tick", at: 601 });
    expect(state.items).toEqual([]);
    expect(state.log.at(-1)).toEqual({ id: "long", kind: "expired", at: 601 });
  });

  test("new commands prune expired marks before enforcing an eight-item cap", () => {
    let state = createOverlayState();
    for (let n = 0; n < MAX_OVERLAY_ITEMS; n++) {
      state = put(state, point(`mark-${n}`, 300), n);
    }
    expect(state.items.length).toBe(8);

    state = put(state, point("ninth", 300), 100);
    expect(state.items.map((item) => item.id)).toEqual([
      "mark-1", "mark-2", "mark-3", "mark-4", "mark-5", "mark-6", "mark-7", "ninth",
    ]);
    expect(state.log).toContainEqual({ id: "mark-0", kind: "evicted", at: 100 });

    state = put(state, point("fresh", 300), 303);
    expect(state.items.map((item) => item.id)).toEqual(["mark-4", "mark-5", "mark-6", "mark-7", "ninth", "fresh"]);
    expect(state.log).toContainEqual({ id: "mark-1", kind: "expired", at: 303 });
    expect(state.log).not.toContainEqual({ id: "mark-4", kind: "evicted", at: 303 });
  });

  test("clear one leaves the other marks; clear all also clears pending navigation", () => {
    let state = put(createOverlayState(), point("a"), 1);
    state = put(state, { type: "highlight", id: "b", testID: "preview", ttlMs: 1_000 }, 2);
    state = put(state, { type: "clear", id: "a" }, 3);
    expect(state.items.map((item) => item.id)).toEqual(["b"]);
    expect(state.log.at(-1)).toEqual({ id: "a", kind: "clear", at: 3 });

    state = put(state, { type: "navigate", id: "go", route: "Trace" }, 4);
    expect(state.pendingNavigate?.id).toBe("go");
    state = put(state, { type: "clear", id: "go" }, 5);
    expect(state.pendingNavigate).toBeUndefined();
    expect(state.items.map((item) => item.id)).toEqual(["b"]);

    state = put(state, { type: "navigate", id: "go-again", route: "Chat", conversationId: "conv" }, 6);
    state = put(state, { type: "clear" }, 7);
    expect(state.items).toEqual([]);
    expect(state.pendingNavigate).toBeUndefined();
    expect(state.log.at(-1)).toEqual({ id: "__all__", kind: "clear", at: 7 });
  });

  test("navigate remains pending until a matching acknowledgement, without navigating in reducer", () => {
    const original = createOverlayState();
    const pending = put(original, { type: "navigate", id: "nav", route: "Chat", conversationId: "conversation-1" }, 100);
    expect(pending.items).toEqual([]);
    expect(pending.pendingNavigate).toEqual({
      id: "nav", route: "Chat", conversationId: "conversation-1", requestedAt: 100,
    });
    expect(reduceOverlay(pending, { type: "navigated", id: "different" })).toBe(pending);

    const conflicting = put(pending, { type: "navigate", id: "second", route: "Settings" }, 101);
    expect(conflicting.pendingNavigate?.id).toBe("nav");
    expect(conflicting.log.at(-1)).toEqual({ id: "second", kind: "dropped", at: 101 });

    const acked = reduceOverlay(conflicting, { type: "navigated", id: "nav" });
    expect(acked.pendingNavigate).toBeUndefined();
    expect(acked.log.at(-1)).toEqual({ id: "nav", kind: "navigated", at: 101 });
    expect(reduceOverlay(acked, { type: "navigated", id: "nav" })).toBe(acked);
    expect(put(acked, { type: "navigate", id: "next", route: "Bots" }, 102).pendingNavigate?.id).toBe("next");
  });

  test("user dismissal clears marks and pending navigation, then drops commands for exactly ten seconds", () => {
    let state = put(createOverlayState(), point("before"), 100);
    state = put(state, { type: "navigate", id: "nav", route: "Lab" }, 101);
    state = reduceOverlay(state, { type: "user-dismiss", at: 150 });
    expect(state.items).toEqual([]);
    expect(state.pendingNavigate).toBeUndefined();
    expect(state.dismissedUntil).toBe(150 + DISMISS_COOLDOWN_MS);
    expect(state.log.at(-1)).toEqual({ id: "user", kind: "dismissed", at: 150 });

    state = put(state, point("blocked"), 150 + DISMISS_COOLDOWN_MS - 1);
    expect(state.items).toEqual([]);
    expect(state.log.at(-1)).toEqual({ id: "blocked", kind: "dropped", at: 10_149 });

    state = reduceOverlay(state, { type: "tick", at: 10_150 });
    expect(state.dismissedUntil).toBeUndefined();
    state = put(state, point("allowed"), 10_150);
    expect(state.items.map((item) => item.id)).toEqual(["allowed"]);
  });

  test("bare dismiss uses the last injected timestamp without reading Date.now", () => {
    const state = put(createOverlayState(), point("old"), 500);
    const dismissed = reduceOverlay(state, { type: "user-dismiss" });
    expect(dismissed.dismissedUntil).toBe(500 + DISMISS_COOLDOWN_MS);
    expect(put(dismissed, point("blocked"), 501).items).toEqual([]);
    expect(put(dismissed, point("later"), 10_500).items.map((item) => item.id)).toEqual(["later"]);
  });

  test("disable clears active and pending UI; commands drop until explicitly enabled", () => {
    let state = put(createOverlayState(), point("visible"), 100);
    state = put(state, { type: "navigate", id: "pending", route: "Orchestra" }, 101);
    state = reduceOverlay(state, { type: "disable" });
    expect(state.enabled).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.pendingNavigate).toBeUndefined();
    expect(reduceOverlay(state, { type: "disable" })).toBe(state);

    state = put(state, point("denied"), 102);
    expect(state.items).toEqual([]);
    expect(state.log.at(-1)).toEqual({ id: "denied", kind: "dropped", at: 102 });
    state = reduceOverlay(state, { type: "enable" });
    expect(state.enabled).toBe(true);
    expect(reduceOverlay(state, { type: "enable" })).toBe(state);

    state = put(state, point("fresh"), 103);
    expect(state.items.map((item) => item.id)).toEqual(["fresh"]);
  });

  test("reenabling does not bypass an active user override", () => {
    let state = put(createOverlayState(), point("a"), 50);
    state = reduceOverlay(state, { type: "user-dismiss", at: 60 });
    state = reduceOverlay(state, { type: "disable" });
    state = reduceOverlay(state, { type: "enable" });
    state = put(state, point("b"), 61);
    expect(state.items).toEqual([]);
    expect(state.log.at(-1)?.kind).toBe("dropped");
  });

  test("duplicate live ID does not reset TTL or displace the original", () => {
    let state = put(createOverlayState(), point("same", 250), 100);
    state = put(state, point("same", 30_000), 200);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.createdAt).toBe(100);
    expect(state.items[0]?.ttlMs).toBe(250);
    expect(state.log.at(-1)).toEqual({ id: "same", kind: "dropped", at: 200 });
    state = reduceOverlay(state, { type: "tick", at: 350 });
    expect(state.items).toEqual([]);
    expect(put(state, point("same"), 351).items.map((item) => item.id)).toEqual(["same"]);
  });

  test("receipt log retains only the newest 50 entries, including drops and evictions", () => {
    let state = createOverlayState();
    for (let n = 0; n < 64; n++) {
      state = put(state, point(`id-${n}`, 30_000), n);
    }
    expect(state.items).toHaveLength(MAX_OVERLAY_ITEMS);
    expect(state.log).toHaveLength(MAX_OVERLAY_LOG);
    expect(state.log.at(-1)).toEqual({ id: "id-63", kind: "point", at: 63 });
    expect(state.log.some((entry) => entry.id === "id-0")).toBe(false);
    expect(state.log.some((entry) => entry.kind === "evicted")).toBe(true);
  });

  test("never mutates a deep-frozen prior state or aliases a mutable draw command", () => {
    const strokes: { points: [number, number][] }[] = [{ points: [[0.1, 0.2], [0.3, 0.4]] }];
    const first = put(createOverlayState(), { type: "draw", id: "ink", strokes, color: "cream", ttlMs: 1_000 }, 100);
    const mutablePair = strokes[0]?.points[0];
    if (mutablePair === undefined) throw new Error("missing test fixture coordinate");
    mutablePair[0] = 0.9;
    expect(first.items[0]?.kind).toBe("draw");
    if (first.items[0]?.kind !== "draw") throw new Error("expected drawing");
    expect(first.items[0].strokes[0]?.points[0]?.[0]).toBe(0.1);

    for (const item of first.items) {
      if (item.kind === "draw") {
        for (const stroke of item.strokes) {
          for (const pair of stroke.points) Object.freeze(pair);
          Object.freeze(stroke.points);
          Object.freeze(stroke);
        }
        Object.freeze(item.strokes);
      }
      Object.freeze(item);
    }
    for (const receipt of first.log) Object.freeze(receipt);
    Object.freeze(first.items);
    Object.freeze(first.log);
    Object.freeze(first);

    const next = put(first, point("second"), 150);
    expect(next.items.map((item) => item.id)).toEqual(["ink", "second"]);
    expect(first.items.map((item) => item.id)).toEqual(["ink"]);
    expect(first.log).toHaveLength(1);
    expect(next.log).toHaveLength(2);
  });

  test("stale or invalid clock input cannot resurrect marks or bypass dismissal", () => {
    let state = put(createOverlayState(), point("p"), 100);
    for (const at of [NaN, Infinity, -1, 99]) {
      expect(reduceOverlay(state, { type: "tick", at })).toBe(state);
      expect(put(state, point("invalid"), at)).toBe(state);
    }

    state = reduceOverlay(state, { type: "user-dismiss", at: 110 });
    expect(reduceOverlay(state, { type: "user-dismiss", at: 109 })).toBe(state);
    expect(put(state, point("old"), 105)).toBe(state);
    expect(put(state, point("new"), 111).items).toEqual([]);
  });
});
