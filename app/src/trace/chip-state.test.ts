import { describe, expect, test } from "bun:test";
import { canUndo, CHIP_REORDER_MS, CHIP_UNDO_MS, orderChips, restoreChip, transitionChip } from "./chip-state";
import { swipeDecision } from "./model";
import { thumbLayout } from "../lib/handedness";

describe("chip resolution", () => {
  test("idle → dragging → resolved → undo; settled gestures cannot overwrite a decision", () => {
    const idle = restoreChip();
    expect(idle).toEqual({ phase: "idle", decision: null, at: 0 });
    const drag = transitionChip(idle, { type: "drag" });
    expect(drag.phase).toBe("dragging");
    const done = transitionChip(drag, { type: "release", dx: 170, vx: 0, width: 400, now: 100 });
    expect(done).toEqual({ phase: "resolved", decision: "do", at: 100 });
    expect(transitionChip(done, { type: "drag" })).toEqual(done);
    expect(transitionChip(done, { type: "commit", decision: "not_now", now: 200 })).toEqual(done);
    expect(transitionChip(done, { type: "undo", now: 5099 })).toEqual(idle);
    expect(transitionChip(done, { type: "undo", now: 5100 })).toEqual(done);
    expect(transitionChip(idle, { type: "undo", now: 1 })).toEqual(idle);
  });
  test("short drags/cancellation return to idle; explicit buttons use the same resolved state", () => {
    const drag = transitionChip(restoreChip(), { type: "drag" });
    expect(transitionChip(drag, { type: "cancel" })).toEqual(restoreChip());
    expect(transitionChip(drag, { type: "release", dx: 159, vx: 0, width: 400, now: 100 })).toEqual(restoreChip());
    expect(transitionChip(drag, { type: "release", dx: -170, vx: 0, width: 400, now: 100 })).toEqual(restoreChip("not_now", 100));
    expect(transitionChip(restoreChip(), { type: "commit", decision: "not_now", now: 200 })).toEqual(restoreChip("not_now", 200));
  });
  test("undo uses persisted time, never a new five-second window on remount", () => {
    expect(CHIP_UNDO_MS).toBe(5000);
    for (const value of ["do", "not_now"] as const) {
      const restored = restoreChip(value, 100);
      expect(restored.phase).toBe("resolved");
      expect(restored.decision).toBe(value);
      expect(canUndo(restored, 5099)).toBe(true);
      expect(canUndo(restored, 5100)).toBe(false);
    }
    for (const value of [undefined, "undo", "arbitrary"]) {
      expect(restoreChip(value, 99)).toEqual(restoreChip());
      expect(canUndo(restoreChip(value, 99), 100)).toBe(false);
    }
  });
  test("40% distance and directional flick boundaries", () => {
    for (const sign of [-1, 1]) {
      const decision = sign === 1 ? "do" : "not_now";
      expect(swipeDecision(sign * 160, 0, 400)).toBeNull();
      expect(swipeDecision(sign * 161, 0, 400)).toBe(decision);
      expect(swipeDecision(sign * 25, sign * 801, 400)).toBe(decision);
      expect(swipeDecision(sign * 24, sign * 801, 400)).toBeNull();
      expect(swipeDecision(sign * 25, sign * 800, 400)).toBeNull();
      expect(swipeDecision(sign * 25, sign * -801, 400)).toBeNull();
    }
  });
  test("left handed coordinates mirror both distance and velocity", () => {
    for (const side of ["left", "right"] as const) {
      const { offset } = thumbLayout(side);
      expect(swipeDecision(offset(offset(170)), 0, 400)).toBe("do");
      expect(swipeDecision(offset(offset(-25)), offset(offset(-801)), 400)).toBe("not_now");
    }
  });
  test("stable partition waits one second, preserves full evidence and restores order on undo", () => {
    expect(CHIP_REORDER_MS).toBe(1000);
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const stateFor = (id: string) => restoreChip(id === "a" ? "do" : id === "b" ? "not_now" : undefined, 100);
    expect(orderChips(items, stateFor, 1099)).toEqual(items);
    expect(orderChips(items, stateFor, 1100)).toEqual([{ id: "c" }, { id: "a" }, { id: "b" }]);
    expect(orderChips(items, () => restoreChip(), 2000)).toEqual(items);
    expect(items.map(i => i.id)).toEqual(["a", "b", "c"]);
  });
});
