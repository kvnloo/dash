import { describe, expect, test } from "bun:test";
import {
  EMPTY_DRAWING, EMPTY_INK_CARRY, MAX_UNDO, TOOL_CODE, addStroke, bounds, carryInkUntilCommit, clear, eraseAlong, hasVisibleInk, meanPressure, recognizeShape,
  segmentDistance2, strokeHit, strokeOutline, strokeWidth, undo, type Drawing, type StrokePoint,
} from "./strokes";

const pts = (...xy: [number, number, number?][]): StrokePoint[] => xy.map(([x, y, t], i) => ({ x, y, p: 0.5, t: t ?? 1000 + i * 10 }));
const pen = (points: StrokePoint[]) => ({ tool: "pen" as const, color: "accent" as const, pointer: "stylus" as const, points });

describe("ink after S Pen lift", () => {
  const samples = [20, 50, 0.4, 1000, 180, 140, 0.9, 1020];

  test("keeps a lifted preview until its saved stroke is rendered", () => {
    const moving = carryInkUntilCommit(EMPTY_INK_CARRY, samples, 0, "pen");
    expect(moving.samples).toEqual(samples);
    const lifted = carryInkUntilCommit(moving, [], 0, "pen");
    expect(lifted).toBe(moving);
    expect(hasVisibleInk(lifted.samples)).toBe(true);

    const saved = addStroke(EMPTY_DRAWING, pen(pts([0.05, 0.1, 1000], [0.45, 0.3, 1020])));
    expect(saved.strokes).toHaveLength(1);
    expect(saved.strokes[0]?.points).toEqual(pts([0.05, 0.1, 1000], [0.45, 0.3, 1020]));
    const acknowledged = carryInkUntilCommit(lifted, [], saved.strokes[0]?.id ?? 0, "pen");
    expect(acknowledged.samples).toEqual([]);
    expect(saved.strokes[0]?.id).toBe(1);
  });

  test("retains the pressure samples and repeated lift stays stable", () => {
    const moving = carryInkUntilCommit({ samples: [], afterStrokeId: 4 }, samples, 4, "highlighter");
    const held = carryInkUntilCommit(moving, [], 4, "highlighter");
    expect(held.samples[6]).toBe(0.9);
    expect(carryInkUntilCommit(held, [], 4, "highlighter")).toBe(held);
    expect(carryInkUntilCommit(held, [], 5, "highlighter").samples).toEqual([]);
  });

  test("never leaves a ghost for rejected taps or eraser gestures", () => {
    const tap = carryInkUntilCommit(EMPTY_INK_CARRY, [20, 50, 0.5, 1000, 22, 52, 0.5, 1010], 0, "pen");
    expect(hasVisibleInk(tap.samples)).toBe(false);
    expect(carryInkUntilCommit(tap, [], 0, "pen").samples).toEqual([]);
    const down = carryInkUntilCommit(EMPTY_INK_CARRY, [20, 50, 0.5, 1000], 0, "pen");
    expect(carryInkUntilCommit(down, [], 0, "pen").samples).toEqual([]);
    const moving = carryInkUntilCommit(EMPTY_INK_CARRY, samples, 0, "pen");
    expect(carryInkUntilCommit(moving, [], 0, "eraser").samples).toEqual([]);
    expect(carryInkUntilCommit(EMPTY_INK_CARRY, samples, 0, "eraser").samples).toEqual([]);
  });
});

describe("drawing edits", () => {
  test("adds strokes with sequential ids and timestamps from the points", () => {
    const one = addStroke(EMPTY_DRAWING, pen(pts([0, 0, 100], [0.5, 0.5, 250])));
    const two = addStroke(one, pen(pts([0.1, 0.1], [0.2, 0.2])));
    expect(two.strokes.map(s => s.id)).toEqual([1, 2]);
    expect(two.nextId).toBe(3);
    expect(one.strokes[0]?.startedAt).toBe(100);
    expect(one.strokes[0]?.endedAt).toBe(250);
    expect(two.past).toHaveLength(2);
  });

  test("drops taps (fewer than two points)", () => {
    expect(addStroke(EMPTY_DRAWING, pen(pts([0, 0])))).toBe(EMPTY_DRAWING);
    expect(addStroke(EMPTY_DRAWING, pen([]))).toBe(EMPTY_DRAWING);
  });

  test("undo restores the previous snapshot but keeps ids monotonic", () => {
    const d = addStroke(addStroke(EMPTY_DRAWING, pen(pts([0, 0], [1, 1]))), pen(pts([0, 1], [1, 0])));
    const u = undo(d);
    expect(u.strokes.map(s => s.id)).toEqual([1]);
    expect(u.nextId).toBe(3);
    expect(u.past).toHaveLength(1);
    expect(undo(EMPTY_DRAWING)).toBe(EMPTY_DRAWING);
    expect(addStroke(u, pen(pts([0, 0], [1, 1]))).strokes.at(-1)?.id).toBe(3);
  });

  test("clear is undoable and a no-op when empty", () => {
    const d = addStroke(EMPTY_DRAWING, pen(pts([0, 0], [1, 1])));
    const c = clear(d);
    expect(c.strokes).toEqual([]);
    expect(undo(c).strokes).toHaveLength(1);
    expect(clear(EMPTY_DRAWING)).toBe(EMPTY_DRAWING);
  });

  test("undo history is bounded", () => {
    let d: Drawing = EMPTY_DRAWING;
    for (let i = 0; i < MAX_UNDO + 5; i++) d = addStroke(d, pen(pts([0, 0], [1, 1])));
    expect(d.past).toHaveLength(MAX_UNDO);
    expect(MAX_UNDO).toBe(50);
  });

  test("eraser removes only strokes it touches, as one undo step", () => {
    let d = addStroke(EMPTY_DRAWING, pen(pts([0.1, 0.1], [0.3, 0.1])));
    d = addStroke(d, pen(pts([0.1, 0.8], [0.3, 0.8])));
    const e = eraseAlong(d, [{ x: 0.2, y: 0.11 }]);
    expect(e.strokes.map(s => s.id)).toEqual([2]);
    expect(undo(e).strokes).toHaveLength(2);
    expect(eraseAlong(d, [{ x: 0.9, y: 0.5 }])).toBe(d);
    expect(eraseAlong(d, [{ x: 0.2, y: 0.14 }], 0.05).strokes).toHaveLength(1);
    expect(eraseAlong(d, [{ x: 0.2, y: 0.14 }], 0.02).strokes).toHaveLength(2);
  });
});

describe("geometry", () => {
  test("segment distance clamps to the endpoints", () => {
    expect(segmentDistance2(0.5, 1, 0, 0, 1, 0)).toBeCloseTo(1);
    expect(segmentDistance2(-1, 0, 0, 0, 1, 0)).toBeCloseTo(1);
    expect(segmentDistance2(3, 0, 0, 0, 1, 0)).toBeCloseTo(4);
    expect(segmentDistance2(2, 2, 1, 1, 1, 1)).toBeCloseTo(2);
    expect(segmentDistance2(0.25, -2, 0, 0, 1, 0)).toBeCloseTo(4);
  });

  test("arrow is a shaft plus a two-sided head at the end", () => {
    const [shaft, head] = strokeOutline("arrow", [0, 50, 100], [0, 0, 0]);
    expect(shaft).toEqual([0, 0, 100, 0]);
    expect(head).toHaveLength(6);
    expect(head?.[2]).toBe(100);
    expect(head?.[0]).toBeLessThan(100);
    expect(head?.[1]).toBeCloseTo(-(head?.[5] ?? 0));
    expect(Math.hypot((head?.[0] ?? 0) - 100, head?.[1] ?? 0)).toBeCloseTo(18);
    const short = strokeOutline("arrow", [0, 10], [0, 0])[1];
    expect(Math.hypot((short?.[0] ?? 0) - 10, short?.[1] ?? 0)).toBeCloseTo(3.5);
  });

  test("box and circle use first and last points", () => {
    expect(strokeOutline("box", [0, 5, 10], [0, 9, 20])).toEqual([[0, 0, 10, 0, 10, 20, 0, 20, 0, 0]]);
    const ring = strokeOutline("circle", [0, 10], [0, 20])[0] ?? [];
    expect(ring).toHaveLength(66);
    expect(ring[0]).toBeCloseTo(10);
    expect(ring[1]).toBeCloseTo(10);
    expect(ring[17]).toBeCloseTo(20);
    expect(ring[16]).toBeCloseTo(5);
  });

  test("freehand keeps every point; empty input has no outline", () => {
    expect(strokeOutline("pen", [1, 2, 3], [4, 5, 6])).toEqual([[1, 4, 2, 5, 3, 6]]);
    expect(strokeOutline("highlighter", [1, 2], [4])).toEqual([[1, 4]]);
    expect(strokeOutline("pen", [], [])).toEqual([]);
  });

  test("hit test follows shapes, not raw points", () => {
    const d = addStroke(EMPTY_DRAWING, { ...pen(pts([0, 0], [0.05, 0.5], [0.5, 0.5])), tool: "box" });
    const box = d.strokes[0];
    if (!box) throw new Error("missing");
    expect(strokeHit(box, 0.5, 0.25, 0.01)).toBe(true);
    expect(strokeHit(box, 0.25, 0.25, 0.01)).toBe(false);
    const dot = { ...box, tool: "pen" as const, points: pts([0.3, 0.3]) };
    expect(strokeHit(dot, 0.3, 0.305, 0.01)).toBe(true);
    expect(strokeHit(dot, 0.3, 0.35, 0.01)).toBe(false);
  });

  test("pressure drives pen width only", () => {
    expect(strokeWidth("pen", 0)).toBe(1.5);
    expect(strokeWidth("pen", 1)).toBe(5.5);
    expect(strokeWidth("pen", 0.5)).toBe(3.5);
    expect(strokeWidth("pen", 3)).toBe(5.5);
    expect(strokeWidth("pen", -1)).toBe(1.5);
    expect(strokeWidth("highlighter", 1)).toBe(18);
    expect(strokeWidth("arrow", 1)).toBe(3);
    expect(meanPressure([])).toBe(0.5);
    expect(meanPressure([{ x: 0, y: 0, p: 0.2, t: 0 }, { x: 0, y: 0, p: 0.6, t: 0 }])).toBeCloseTo(0.4);
  });

  test("bounds and tool codes", () => {
    expect(bounds([{ x: 0.2, y: 0.9 }, { x: 0.1, y: 0.3 }])).toEqual([0.1, 0.3, 0.2, 0.9]);
    expect(bounds([])).toEqual([0, 0, 0, 0]);
    expect(TOOL_CODE).toEqual({ pen: 0, highlighter: 1, arrow: 2, box: 3, circle: 4, eraser: 5 });
  });
});

describe("shape recognition", () => {
  const loop = (fn: (a: number) => [number, number], n = 24) => Array.from({ length: n + 1 }, (_, i) => { const [x, y] = fn((i / n) * Math.PI * 2); return { x, y }; });
  test("a rough closed oval becomes a circle with its bounding box", () => {
    const r = recognizeShape(loop(a => [0.5 + 0.2 * Math.cos(a), 0.5 + 0.1 * Math.sin(a)]));
    expect(r?.tool).toBe("circle");
    expect(r?.from.x).toBeCloseTo(0.3);
    expect(r?.to.y).toBeCloseTo(0.6);
  });
  test("a closed rectangle becomes a box", () => {
    const sq = [[0.2, 0.2], [0.4, 0.2], [0.6, 0.2], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.2, 0.6], [0.2, 0.4], [0.21, 0.21]].map(([x, y]) => ({ x: x ?? 0, y: y ?? 0 }));
    expect(recognizeShape(sq)?.tool).toBe("box");
  });
  test("open, tiny or short strokes stay freehand", () => {
    expect(recognizeShape(loop(a => [0.5 + 0.2 * Math.cos(a / 2), 0.5 + 0.2 * Math.sin(a / 2)]))).toBeNull();
    expect(recognizeShape(loop(a => [0.5 + 0.01 * Math.cos(a), 0.5 + 0.01 * Math.sin(a)]))).toBeNull();
    expect(recognizeShape(loop(a => [Math.cos(a), Math.sin(a)], 6))).toBeNull();
  });
});
