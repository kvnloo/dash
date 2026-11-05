// Annotation stroke model. Pure and dependency-free so Bun can test it and the
// geometry helpers can run as Reanimated worklets on the UI thread.
//
// Coordinates are normalized to the captured screen (0..1 on each axis) so a stroke
// means the same thing at any resolution. Times are epoch milliseconds.

export type DrawTool = "pen" | "highlighter" | "arrow" | "box" | "circle";
export type Tool = DrawTool | "eraser";
export type InkColor = "accent" | "red";
export type PointerKind = "stylus" | "touch" | "mouse" | "other";

export interface StrokePoint {
  x: number;
  y: number;
  /** Pressure 0..1. Fingers and mice report 0.5. */
  p: number;
  t: number;
}

export interface Stroke {
  /** 1-based, stable for the life of the drawing; the transcript refers to it. */
  id: number;
  tool: DrawTool;
  color: InkColor;
  pointer: PointerKind;
  points: StrokePoint[];
  startedAt: number;
  endedAt: number;
  /** Component ids under the stroke, from a cheap hit-test. */
  targets?: string[];
}

export interface Drawing {
  strokes: Stroke[];
  nextId: number;
  /** Snapshots for undo; every edit (add, erase, clear) pushes one. */
  past: Stroke[][];
}

export const EMPTY_DRAWING: Drawing = { strokes: [], nextId: 1, past: [] };
export const MAX_UNDO = 50;

export const TOOL_CODE: Record<Tool, number> = { pen: 0, highlighter: 1, arrow: 2, box: 3, circle: 4, eraser: 5 };

/** Live samples that stay painted between a pointer lift and the JS stroke commit. */
export interface InkCarry {
  samples: readonly number[];
  /** ID of the last saved stroke when these samples were captured. */
  afterStrokeId: number;
}

export const EMPTY_INK_CARRY: InkCarry = { samples: [], afterStrokeId: 0 };

/** Match the annotation gesture's six-point tap filter; rejected taps leave no ghost. */
export function hasVisibleInk(flat: readonly number[]): boolean {
  "worklet";
  if (flat.length < 8) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const x = flat[i] ?? Number.NaN, y = flat[i + 1] ?? Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return maxX - minX >= 6 || maxY - minY >= 6;
}

/**
 * A Pan finalizes on the UI thread before runOnJS(finish) saves its stroke.
 * Keep the last valid preview until a new committed ID appears, then let
 * InkCanvas show the saved stroke instead. Erasing never leaves preview ink.
 */
export function carryInkUntilCommit(previous: InkCarry, live: readonly number[], latestStrokeId: number, tool: Tool): InkCarry {
  "worklet";
  if (latestStrokeId !== previous.afterStrokeId) return { samples: [], afterStrokeId: latestStrokeId };
  if (tool === "eraser") return previous.samples.length ? { samples: [], afterStrokeId: latestStrokeId } : previous;
  if (live.length > 0) return { samples: live, afterStrokeId: latestStrokeId };
  if (!previous.samples.length) return previous;
  return hasVisibleInk(previous.samples) ? previous : { samples: [], afterStrokeId: latestStrokeId };
}

function commit(drawing: Drawing, strokes: Stroke[], nextId = drawing.nextId): Drawing {
  return { strokes, nextId, past: [...drawing.past, drawing.strokes].slice(-MAX_UNDO) };
}

/** Add a finished stroke. Fewer than two points is a tap, not a mark, and is dropped. */
export function addStroke(drawing: Drawing, input: Omit<Stroke, "id" | "startedAt" | "endedAt">): Drawing {
  const first = input.points[0];
  const last = input.points.at(-1);
  if (!first || !last || input.points.length < 2) return drawing;
  const stroke: Stroke = { ...input, id: drawing.nextId, startedAt: first.t, endedAt: last.t };
  return commit(drawing, [...drawing.strokes, stroke], drawing.nextId + 1);
}

export function undo(drawing: Drawing): Drawing {
  const previous = drawing.past.at(-1);
  if (!previous) return drawing;
  return { strokes: previous, nextId: drawing.nextId, past: drawing.past.slice(0, -1) };
}

export function clear(drawing: Drawing): Drawing {
  if (drawing.strokes.length === 0) return drawing;
  return commit(drawing, []);
}

/** Squared distance from point to segment, in the same units as the inputs. */
export function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  "worklet";
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + k * dx - px;
  const cy = ay + k * dy - py;
  return cx * cx + cy * cy;
}

/** The polylines a stroke renders as. Shapes use the first and last point. */
export function strokeOutline(tool: DrawTool, xs: readonly number[], ys: readonly number[]): number[][] {
  "worklet";
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return [];
  const x0 = xs[0] ?? 0, y0 = ys[0] ?? 0, x1 = xs[n - 1] ?? 0, y1 = ys[n - 1] ?? 0;
  if (tool === "arrow") {
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = Math.min(18, Math.hypot(x1 - x0, y1 - y0) * 0.35);
    const spread = Math.PI / 7;
    return [
      [x0, y0, x1, y1],
      [x1 - head * Math.cos(angle - spread), y1 - head * Math.sin(angle - spread), x1, y1, x1 - head * Math.cos(angle + spread), y1 - head * Math.sin(angle + spread)],
    ];
  }
  if (tool === "box") return [[x0, y0, x1, y0, x1, y1, x0, y1, x0, y0]];
  if (tool === "circle") {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    const ring: number[] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      ring.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    }
    return [ring];
  }
  const line: number[] = [];
  for (let i = 0; i < n; i++) line.push(xs[i] ?? 0, ys[i] ?? 0);
  return [line];
}

/** Does this stroke pass within `radius` of (x, y)? Normalized units. */
export function strokeHit(stroke: Stroke, x: number, y: number, radius: number): boolean {
  const lines = strokeOutline(stroke.tool, stroke.points.map(p => p.x), stroke.points.map(p => p.y));
  const r2 = radius * radius;
  for (const line of lines) {
    if (line.length === 2 && segmentDistance2(x, y, line[0] ?? 0, line[1] ?? 0, line[0] ?? 0, line[1] ?? 0) <= r2) return true;
    for (let i = 2; i < line.length; i += 2) {
      if (segmentDistance2(x, y, line[i - 2] ?? 0, line[i - 1] ?? 0, line[i] ?? 0, line[i + 1] ?? 0) <= r2) return true;
    }
  }
  return false;
}

/** Remove every stroke an eraser path touched. One undo step. */
export function eraseAlong(drawing: Drawing, path: readonly { x: number; y: number }[], radius = 0.02): Drawing {
  const kept = drawing.strokes.filter(stroke => !path.some(p => strokeHit(stroke, p.x, p.y, radius)));
  return kept.length === drawing.strokes.length ? drawing : commit(drawing, kept);
}

/** Stroke width in screen points. Pressure only modulates the pen. */
export function strokeWidth(tool: DrawTool, pressure: number): number {
  "worklet";
  if (tool === "highlighter") return 18;
  if (tool !== "pen") return 3;
  const p = Math.max(0, Math.min(1, pressure));
  return 1.5 + p * 4;
}

export function meanPressure(points: readonly StrokePoint[]): number {
  if (points.length === 0) return 0.5;
  return points.reduce((sum, p) => sum + p.p, 0) / points.length;
}

/** Normalized bounding box [minX, minY, maxX, maxY]. */
export function bounds(points: readonly { x: number; y: number }[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return points.length ? [minX, minY, maxX, maxY] : [0, 0, 0, 0];
}

/**
 * Stretch goal: a rough closed pen loop becomes a circle or a box. Returns null for
 * open or tiny strokes, which stay freehand.
 */
export function recognizeShape(points: readonly { x: number; y: number }[]): { tool: "box" | "circle"; from: { x: number; y: number }; to: { x: number; y: number } } | null {
  if (points.length < 8) return null;
  const [minX, minY, maxX, maxY] = bounds(points);
  const w = maxX - minX, h = maxY - minY;
  const diagonal = Math.hypot(w, h);
  if (diagonal < 0.05) return null;
  const first = points[0], last = points.at(-1);
  if (!first || !last || Math.hypot(last.x - first.x, last.y - first.y) > diagonal * 0.2) return null;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rx = w / 2 || 1e-6, ry = h / 2 || 1e-6;
  const residual = points.reduce((sum, p) => sum + Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1), 0) / points.length;
  const from = { x: minX, y: minY }, to = { x: maxX, y: maxY };
  return { tool: residual < 0.08 ? "circle" : "box", from, to };
}
