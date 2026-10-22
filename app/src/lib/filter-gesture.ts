/**
 * The filter-button gesture as a pure state machine. Runs as a worklet on the UI thread and as
 * plain TypeScript in tests. One touch: hold -> rows bloom -> slide to a row -> dwell or force
 * press arms it -> left/right scrubs the level -> release commits.
 */

export const HOLD_MS = 250;
export const DWELL_MS = 350;
export const PX_PER_LEVEL = 40;
/** Pressure (0..1) that arms a row immediately where the platform reports it. */
export const FORCE_ARM = 0.5;
/** Finger travel that cancels a hold before the menu opens (it was a scroll or a tap). */
export const HOLD_SLOP = 12;
/** Horizontal travel that turns an armed row into an active scrub. */
export const SCRUB_SLOP = 4;

/** Row hit results from the caller's layout. */
export const ROW_NONE = -1;
export const ROW_BUTTON = -2;

export type GesturePhase = "idle" | "holding" | "open" | "hovering" | "armed" | "scrubbing" | "committed" | "cancelled" | "tapped";

export interface GestureState {
  phase: GesturePhase;
  row: number;
  /** When the current phase's timer started (hold or dwell), ms. */
  since: number;
  downX: number;
  downY: number;
  x: number;
  /** Scrub origin and value range for the armed row. */
  startX: number;
  startIndex: number;
  index: number;
  count: number;
  /** The finger has left the button since the menu opened; only then does returning to it cancel. */
  left: boolean;
}

export type GestureEvent =
  | { type: "down"; t: number; x: number; y: number }
  | { type: "tick"; t: number }
  | { type: "move"; t: number; x: number; y: number; row: number; vx?: number }
  | { type: "force"; t: number; pressure: number }
  /** The caller tells the machine the current value and range of the row being armed. */
  | { type: "rowInfo"; index: number; count: number }
  | { type: "up"; t: number };

export const IDLE: GestureState = { phase: "idle", row: ROW_NONE, since: 0, downX: 0, downY: 0, x: 0, startX: 0, startIndex: 0, index: 0, count: 1, left: false };

/** Velocity-aware step: a fast flick needs less travel per level (40 px slow, ~27 px fast). */
export function pxPerLevel(vx: number): number {
  "worklet";
  return PX_PER_LEVEL / (1 + 0.5 * Math.min(1, Math.abs(vx) / 1200));
}

export function scrubIndex(startIndex: number, dx: number, count: number, vx = 0): number {
  "worklet";
  const raw = startIndex + Math.round(dx / pxPerLevel(vx));
  return Math.max(0, Math.min(count - 1, raw));
}

/** Dwell progress 0..1 for the fill ring. */
export function dwellProgress(state: GestureState, t: number): number {
  "worklet";
  if (state.phase !== "hovering") return state.phase === "armed" || state.phase === "scrubbing" ? 1 : 0;
  return Math.max(0, Math.min(1, (t - state.since) / DWELL_MS));
}

export function isTerminal(phase: GesturePhase): boolean {
  "worklet";
  return phase === "committed" || phase === "cancelled" || phase === "tapped" || phase === "idle";
}

export function step(state: GestureState, event: GestureEvent): GestureState {
  "worklet";
  if (event.type === "down") return { ...IDLE, phase: "holding", since: event.t, downX: event.x, downY: event.y, x: event.x };
  const p = state.phase;
  if (isTerminal(p)) return state;

  if (event.type === "rowInfo") {
    const count = Math.max(1, event.count);
    const index = Math.max(0, Math.min(count - 1, event.index));
    return { ...state, count, index, startIndex: index };
  }

  if (event.type === "up") {
    if (p === "holding") return { ...state, phase: "tapped" };
    if (p === "armed" || p === "scrubbing") return { ...state, phase: "committed" };
    return { ...state, phase: "cancelled" };
  }

  if (event.type === "tick") {
    if (p === "holding" && event.t - state.since >= HOLD_MS) return { ...state, phase: "open", since: event.t };
    if (p === "hovering" && event.t - state.since >= DWELL_MS) return { ...state, phase: "armed", since: event.t, startX: state.x };
    return state;
  }

  if (event.type === "force") {
    if (p === "hovering" && event.pressure >= FORCE_ARM) return { ...state, phase: "armed", since: event.t, startX: state.x };
    return state;
  }

  // move
  const moved = { ...state, x: event.x };
  if (p === "holding") {
    return Math.hypot(event.x - state.downX, event.y - state.downY) > HOLD_SLOP ? { ...moved, phase: "cancelled" } : moved;
  }
  if (event.row === ROW_BUTTON) return state.left ? { ...moved, phase: "cancelled" } : moved;
  if (!state.left) moved.left = true;
  if (p === "open") return event.row >= 0 ? { ...moved, phase: "hovering", row: event.row, since: event.t } : moved;
  if (p === "hovering") {
    if (event.row === state.row) return moved;
    if (event.row < 0) return { ...moved, phase: "open", row: ROW_NONE, since: event.t };
    return { ...moved, row: event.row, since: event.t };
  }
  // armed or scrubbing: horizontal travel only.
  const dx = event.x - state.startX;
  const phase: GesturePhase = p === "armed" && Math.abs(dx) < SCRUB_SLOP ? "armed" : "scrubbing";
  return { ...moved, phase, index: scrubIndex(state.startIndex, dx, state.count, event.vx ?? 0) };
}

/** Haptic the caller plays for a transition, or null. */
export function transitionHaptic(prev: GestureState, next: GestureState): "tick" | "arm" | "commit" | "open" | null {
  "worklet";
  if (prev.phase === "holding" && next.phase === "open") return "open";
  if (next.phase === "hovering" && (prev.phase !== "hovering" || prev.row !== next.row)) return "tick";
  if (next.phase === "armed" && prev.phase === "hovering") return "arm";
  if ((next.phase === "scrubbing" || next.phase === "armed") && prev.index !== next.index) return "tick";
  if (next.phase === "committed" && prev.phase !== "committed") return "commit";
  return null;
}
