import { swipeDecision, type SwipeDecision } from "./model";

export const CHIP_UNDO_MS = 5000;
export const CHIP_REORDER_MS = 1000;
export type ChipDecision = Exclude<SwipeDecision, null>;
export type ChipState = { phase: "idle" | "dragging" | "resolved"; decision: SwipeDecision; at: number };
export type ChipEvent =
  | { type: "drag" }
  | { type: "release"; dx: number; vx: number; width: number; now: number }
  | { type: "commit"; decision: ChipDecision; now: number }
  | { type: "undo"; now: number }
  | { type: "cancel" };

export function restoreChip(decision?: string, at = 0): ChipState {
  "worklet";
  return decision === "do" || decision === "not_now"
    ? { phase: "resolved", decision, at }
    : { phase: "idle", decision: null, at: 0 };
}

export function canUndo(state: ChipState, now: number): boolean {
  "worklet";
  return state.phase === "resolved" && now - state.at < CHIP_UNDO_MS;
}

/** Same state machine on the gesture thread and in unit tests. Coordinates are handedness-normalized. */
export function transitionChip(state: ChipState, event: ChipEvent): ChipState {
  "worklet";
  if (event.type === "undo") return canUndo(state, event.now) ? restoreChip() : state;
  if (state.phase === "resolved") return state;
  if (event.type === "drag") return { ...state, phase: "dragging" };
  if (event.type === "cancel") return restoreChip();
  const decision = event.type === "commit" ? event.decision : swipeDecision(event.dx, event.vx, event.width);
  return decision ? restoreChip(decision, event.now) : restoreChip();
}

/** Stable partition: retain the full evidence, but put settled decisions behind unresolved work. */
export function orderChips<T extends { id: string }>(items: readonly T[], stateFor: (id: string) => ChipState, now: number): T[] {
  const settled = (id: string) => {
    const state = stateFor(id);
    return state.phase === "resolved" && now - state.at >= CHIP_REORDER_MS;
  };
  return [...items.filter(item => !settled(item.id)), ...items.filter(item => settled(item.id))];
}
