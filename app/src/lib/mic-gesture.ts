/** Composer mic: pure gesture state, picker hit-testing, transcript insertion and recognizer parsing.
 *  Kept free of React Native so it runs under `bun test` and inside nothing but plain JS. */

export type MicChoice = "dictate" | "live";
export type MicPhase = "idle" | "holding" | "picker";

export interface MicState {
  phase: MicPhase;
  /** The option under the finger while the picker is open; null means over the button (release cancels). */
  hover: MicChoice | null;
}

export type MicEvent =
  | { type: "down" }
  | { type: "longPress" }
  | { type: "move"; dy: number }
  | { type: "up" }
  | { type: "cancel" };

/** What a finished gesture asks the component to do. */
export type MicOutcome = { kind: "tap" } | { kind: "choose"; choice: MicChoice } | { kind: "cancel" } | null;

export const MIC_IDLE: MicState = { phase: "idle", hover: null };
/** Vertical travel (px) before an option is selected. Up is negative dy. */
export const PICK_THRESHOLD = 28;

export function hoverFor(dy: number): MicChoice | null {
  if (dy <= -PICK_THRESHOLD) return "live";
  if (dy >= PICK_THRESHOLD) return "dictate";
  return null;
}

export function micStep(state: MicState, event: MicEvent): { state: MicState; outcome: MicOutcome } {
  switch (event.type) {
    case "down":
      return { state: { phase: "holding", hover: null }, outcome: null };
    case "longPress":
      return state.phase === "holding" ? { state: { phase: "picker", hover: null }, outcome: null } : { state, outcome: null };
    case "move":
      return state.phase === "picker" ? { state: { phase: "picker", hover: hoverFor(event.dy) }, outcome: null } : { state, outcome: null };
    case "up":
      if (state.phase === "holding") return { state: MIC_IDLE, outcome: { kind: "tap" } };
      if (state.phase === "picker") return { state: MIC_IDLE, outcome: state.hover ? { kind: "choose", choice: state.hover } : { kind: "cancel" } };
      return { state: MIC_IDLE, outcome: null };
    case "cancel":
      return { state: MIC_IDLE, outcome: state.phase === "idle" ? null : { kind: "cancel" } };
  }
}

/** Remembered tap default. */
export const MIC_DEFAULT_KEY = "dash.mic.default";
export function parseMicChoice(raw: unknown): MicChoice {
  return raw === "live" ? "live" : "dictate";
}

export interface Selection { start: number; end: number }

/** Replace the selection with `insert`, padding with single spaces so repeated dictation appends words cleanly. */
export function insertAtCursor(text: string, selection: Selection | null | undefined, insert: string): { text: string; cursor: number } {
  const clean = insert.trim();
  const len = text.length;
  const start = Math.max(0, Math.min(selection?.start ?? len, len));
  const end = Math.max(start, Math.min(selection?.end ?? start, len));
  if (!clean) return { text, cursor: end };
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const piece = lead + clean + trail;
  return { text: before + piece + after, cursor: start + lead.length + clean.length };
}

export const RECOGNIZE_SPEECH = "android.speech.action.RECOGNIZE_SPEECH";
export const EXTRA_RESULTS = "android.speech.extra.RESULTS";

/** Pull the best transcript from an expo-intent-launcher result. Success is resultCode -1. */
export function parseRecognizerResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const { resultCode, extra } = result as { resultCode?: unknown; extra?: unknown };
  if (resultCode !== -1 || !extra || typeof extra !== "object") return null;
  const raw = (extra as Record<string, unknown>)[EXTRA_RESULTS];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const best = list.find((item): item is string => typeof item === "string" && item.trim().length > 0);
  return best ? best.trim() : null;
}
