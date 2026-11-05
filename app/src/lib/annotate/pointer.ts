// Which pointer draws. Runs inside Gesture Handler callbacks on the UI thread.
import type { PointerKind } from "./strokes";

/** Gesture Handler's PointerType enum values (TOUCH 0, STYLUS 1, MOUSE 2). */
export function pointerKind(pointerType: number): PointerKind {
  "worklet";
  return pointerType === 0 ? "touch" : pointerType === 1 ? "stylus" : pointerType === 2 ? "mouse" : "other";
}

export type Route = "draw" | "pass";

/**
 * Pen mode is palm rejection: only the stylus draws and fingers fall through to
 * scroll the content. Without pen mode, one finger (or a mouse or a pen) draws;
 * two fingers never draw.
 */
export function routePointer(kind: PointerKind, penMode: boolean, pointers: number): Route {
  "worklet";
  if (pointers > 1) return "pass";
  if (penMode) return kind === "stylus" ? "draw" : "pass";
  return kind === "other" ? "pass" : "draw";
}

/** Contact alone never enters Annotate, even when S Pen-only drawing is enabled. */
export function stylusEnters(_kind: PointerKind, _penMode: boolean, _active: boolean): boolean {
  "worklet";
  return false;
}

/** Gesture Handler reports pressure only for styluses; others draw at mid pressure. */
export function pressureOf(kind: PointerKind, pressure: number | undefined): number {
  "worklet";
  if (kind !== "stylus" || pressure === undefined || !Number.isFinite(pressure) || pressure <= 0) return 0.5;
  return Math.min(1, pressure);
}

/** Raw touch coordinates are already local DIP, not pixels or font-scaled text units. */
export function appendInkSample(flat: readonly number[], x: number, y: number, p: number, t: number): number[] {
  "worklet";
  if (!Number.isFinite(x) || !Number.isFinite(y)) return flat.slice();
  if (flat.length >= 4 && flat[flat.length - 4] === x && flat[flat.length - 3] === y) {
    const next = flat.slice(); next[next.length - 2] = p; return next;
  }
  return [...flat, x, y, p, t];
}
