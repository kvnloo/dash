import { describe, expect, test } from "bun:test";
import { DWELL_MS, FORCE_ARM, HOLD_MS, HOLD_SLOP, IDLE, PX_PER_LEVEL, ROW_BUTTON, ROW_NONE, SCRUB_SLOP, dwellProgress, isTerminal, pxPerLevel, scrubIndex, step, transitionHaptic, type GestureEvent, type GestureState } from "./filter-gesture";

function run(events: GestureEvent[], from: GestureState = IDLE): GestureState[] {
  const out: GestureState[] = [];
  let s = from;
  for (const e of events) { s = step(s, e); out.push(s); }
  return out;
}
const last = (xs: GestureState[]) => xs[xs.length - 1] ?? IDLE;

describe("filter gesture state machine", () => {
  test("idle state is all zeroes with one value", () => {
    expect(IDLE).toEqual({ phase: "idle", row: -1, since: 0, downX: 0, downY: 0, x: 0, startX: 0, startIndex: 0, index: 0, count: 1, left: false });
  });
  test("pins the timing and travel constants", () => {
    expect([HOLD_MS, DWELL_MS, PX_PER_LEVEL, FORCE_ARM, HOLD_SLOP, SCRUB_SLOP, ROW_NONE, ROW_BUTTON]).toEqual([250, 350, 40, 0.5, 12, 4, -1, -2]);
  });

  test("idle → holding → open → hovering → armed → scrubbing → committed", () => {
    const states = run([
      { type: "down", t: 0, x: 100, y: 800 },
      { type: "tick", t: 249 },
      { type: "tick", t: 250 },
      { type: "move", t: 300, x: 100, y: 760, row: 1 },
      { type: "rowInfo", index: 2, count: 5 },
      { type: "tick", t: 649 },
      { type: "tick", t: 650 },
      { type: "move", t: 700, x: 103, y: 760, row: 1 },
      { type: "move", t: 720, x: 120, y: 760, row: 1 },
      { type: "move", t: 760, x: 181, y: 760, row: 1 },
      { type: "up", t: 800 },
    ]);
    expect(states.map(s => s.phase)).toEqual(["holding", "holding", "open", "hovering", "hovering", "hovering", "armed", "armed", "scrubbing", "scrubbing", "committed"]);
    expect(states[6]?.startX).toBe(100);
    expect(states[8]?.index).toBe(3);
    expect(last(states)).toMatchObject({ row: 1, index: 4, startIndex: 2 });
  });

  test("lifting before the hold is a tap; moving first cancels (it was a scroll)", () => {
    expect(last(run([{ type: "down", t: 0, x: 0, y: 0 }, { type: "up", t: 100 }])).phase).toBe("tapped");
    expect(last(run([{ type: "down", t: 0, x: 0, y: 0 }, { type: "move", t: 50, x: 12, y: 0, row: ROW_NONE }])).phase).toBe("holding");
    expect(last(run([{ type: "down", t: 0, x: 0, y: 0 }, { type: "move", t: 50, x: 13, y: 0, row: ROW_NONE }])).phase).toBe("cancelled");
  });

  const opened: GestureEvent[] = [{ type: "down", t: 0, x: 50, y: 500 }, { type: "tick", t: 250 }];

  test("release before arming closes without change", () => {
    expect(last(run([...opened, { type: "up", t: 300 }])).phase).toBe("cancelled");
    expect(last(run([...opened, { type: "move", t: 300, x: 50, y: 450, row: 0 }, { type: "up", t: 400 }])).phase).toBe("cancelled");
  });

  test("moving inside the button before leaving it does not cancel", () => {
    const s = run([...opened, { type: "move", t: 260, x: 50, y: 495, row: ROW_BUTTON }, { type: "move", t: 270, x: 50, y: 470, row: ROW_NONE }, { type: "move", t: 280, x: 50, y: 495, row: ROW_BUTTON }]);
    expect(s.map(x => x.phase).slice(-3)).toEqual(["open", "open", "cancelled"]);
    expect(s[2]?.left).toBe(false);
    expect(s[3]?.left).toBe(true);
  });

  test("sliding back onto the button cancels, even while scrubbing", () => {
    const hover = run([...opened, { type: "move", t: 300, x: 50, y: 450, row: 0 }, { type: "move", t: 320, x: 50, y: 505, row: ROW_BUTTON }]);
    expect(last(hover).phase).toBe("cancelled");
    const scrub = run([...opened, { type: "move", t: 300, x: 50, y: 450, row: 0 }, { type: "rowInfo", index: 0, count: 3 }, { type: "tick", t: 650 }, { type: "move", t: 700, x: 90, y: 450, row: 0 }, { type: "move", t: 720, x: 90, y: 520, row: ROW_BUTTON }]);
    expect(scrub.map(s => s.phase).slice(-3)).toEqual(["armed", "scrubbing", "cancelled"]);
    expect(last(scrub).startIndex).toBe(0);
  });

  test("changing rows restarts the dwell; leaving all rows returns to open", () => {
    const s = run([...opened, { type: "move", t: 300, x: 0, y: 0, row: 0 }, { type: "move", t: 500, x: 0, y: 0, row: 1 }, { type: "tick", t: 700 }, { type: "tick", t: 850 }]);
    expect(s.map(x => x.phase)).toEqual(["holding", "open", "hovering", "hovering", "hovering", "armed"]);
    expect(s[3]?.since).toBe(500);
    expect(last(run([...opened, { type: "move", t: 300, x: 0, y: 0, row: 0 }, { type: "move", t: 310, x: 0, y: 0, row: ROW_NONE }])).phase).toBe("open");
    const same = run([...opened, { type: "move", t: 300, x: 0, y: 0, row: 0 }, { type: "move", t: 400, x: 1, y: 0, row: 0 }]);
    expect(last(same).since).toBe(300);
  });

  test("force press arms immediately; light pressure does not", () => {
    const base = [...opened, { type: "move", t: 300, x: 0, y: 0, row: 2 } as const];
    expect(last(run([...base, { type: "force", t: 310, pressure: 0.49 }])).phase).toBe("hovering");
    expect(last(run([...base, { type: "force", t: 310, pressure: 0.5 }])).phase).toBe("armed");
    expect(last(run([...opened, { type: "force", t: 260, pressure: 1 }])).phase).toBe("open");
  });

  test("terminal states ignore further input until the next down", () => {
    for (const phase of ["committed", "cancelled", "tapped", "idle"] as const) {
      const s = { ...IDLE, phase };
      expect(isTerminal(phase)).toBe(true);
      expect(step(s, { type: "tick", t: 9999 })).toBe(s);
      expect(step(s, { type: "down", t: 1, x: 2, y: 3 }).phase).toBe("holding");
    }
    for (const phase of ["holding", "open", "hovering", "armed", "scrubbing"] as const) expect(isTerminal(phase)).toBe(false);
  });

  test("rowInfo clamps the start index into range", () => {
    expect(step({ ...IDLE, phase: "hovering" }, { type: "rowInfo", index: 9, count: 3 })).toMatchObject({ index: 2, startIndex: 2, count: 3 });
    expect(step({ ...IDLE, phase: "hovering" }, { type: "rowInfo", index: -4, count: 0 })).toMatchObject({ index: 0, count: 1 });
  });
});

describe("scrub feel", () => {
  test("40 px per level when slow, down to ~27 px on a fast flick", () => {
    expect(pxPerLevel(0)).toBe(40);
    expect(pxPerLevel(600)).toBe(32);
    expect(pxPerLevel(-1200)).toBeCloseTo(26.667, 2);
    expect(pxPerLevel(5000)).toBeCloseTo(26.667, 2);
  });
  test("index snaps by rounding and clamps to the row's range", () => {
    expect([0, 19, 20, 59, 60, 400, -400].map(dx => scrubIndex(2, dx, 5))).toEqual([2, 2, 3, 3, 4, 4, 0]);
    expect(scrubIndex(0, 27, 5, 1200)).toBe(1);
  });
  test("dwell progress fills over 350 ms and stays full once armed", () => {
    const h = { ...IDLE, phase: "hovering" as const, since: 100 };
    expect([100, 275, 450, 900].map(t => dwellProgress(h, t))).toEqual([0, 0.5, 1, 1]);
    expect(dwellProgress({ ...h, phase: "armed" }, 0)).toBe(1);
    expect(dwellProgress({ ...h, phase: "scrubbing" }, 0)).toBe(1);
    expect(dwellProgress({ ...h, phase: "open" }, 999)).toBe(0);
  });
});

describe("haptics per transition", () => {
  const s = (phase: GestureState["phase"], row = 0, index = 0): GestureState => ({ ...IDLE, phase, row, index });
  test("open, tick on row entry, stronger arm, tick per level, commit", () => {
    expect(transitionHaptic(s("holding"), s("open"))).toBe("open");
    expect(transitionHaptic(s("open"), s("hovering", 1))).toBe("tick");
    expect(transitionHaptic(s("hovering", 1), s("hovering", 2))).toBe("tick");
    expect(transitionHaptic(s("hovering", 1), s("hovering", 1))).toBeNull();
    expect(transitionHaptic(s("hovering"), s("armed"))).toBe("arm");
    expect(transitionHaptic(s("armed", 0, 1), s("scrubbing", 0, 2))).toBe("tick");
    expect(transitionHaptic(s("scrubbing", 0, 2), s("scrubbing", 0, 2))).toBeNull();
    expect(transitionHaptic(s("scrubbing"), s("committed"))).toBe("commit");
    expect(transitionHaptic(s("committed"), s("committed"))).toBeNull();
    expect(transitionHaptic(s("open"), s("cancelled"))).toBeNull();
  });
});
