/**
 * Pure Flow mode controller. Native stylus, microphone and UI owners may derive
 * behavior from this state without giving any input source implicit mode changes.
 *
 * `previous` records the mode exited by the last real mode transition; changes
 * to the brainstorm pen arm or hardware button latch do not alter it.
 */
export type FlowMode = "normal" | "annotate" | "brainstorm";

export interface FlowModeState {
  mode: FlowMode;
  previous: FlowMode;
  inkArmed: boolean;
  buttonDown: boolean;
  flowEnabled: boolean;
}

export type ModeIntent = "enter-brainstorm" | "exit-brainstorm";

export type FlowModeEvent =
  | { type: "pen-button"; pressed: boolean }
  | { type: "pill-tap" }
  | { type: "pill-long-press" }
  | { type: "voice-intent"; intent: ModeIntent }
  | { type: "back" }
  | { type: "cold-start" };

export type MicPolicy = "continuous" | "per-session";
export type PenRole = "reply-select" | "ink" | "pan";
export type FingerRole = "scroll-pan" | "app";

/** Sessions always start in Normal; stored annotation/brainstorm is never restored. */
export function initialFlowMode(flowEnabled: boolean): FlowModeState {
  return {
    mode: "normal",
    previous: "normal",
    inkArmed: false,
    buttonDown: false,
    flowEnabled,
  };
}

/** Preserve the hardware latch across pill and voice transitions. */
function switchMode(state: FlowModeState, mode: FlowMode, armed = false): FlowModeState {
  const inkArmed = mode === "brainstorm" && armed;
  if (state.mode === mode && state.inkArmed === inkArmed) return state;
  return {
    ...state,
    mode,
    previous: state.mode === mode ? state.previous : state.mode,
    inkArmed,
  };
}

/**
 * Mode changes are explicit. Hardware presses act only on a rising edge,
 * including when a held button spans a UI/voice mode change.
 * Identity-preserving no-ops allow callers to avoid spurious renders.
 */
export function reduceFlowMode(state: FlowModeState, event: FlowModeEvent): FlowModeState {
  switch (event.type) {
    case "pen-button": {
      if (state.buttonDown === event.pressed) return state;
      if (!event.pressed) return { ...state, buttonDown: false };
      const next = state.mode === "brainstorm"
        ? switchMode(state, "brainstorm", !state.inkArmed)
        : switchMode(state, state.mode === "normal" ? "annotate" : "normal");
      return { ...next, buttonDown: true };
    }
    case "pill-tap":
      return switchMode(state, state.mode === "normal" ? "annotate" : "normal");
    case "pill-long-press":
      return state.flowEnabled ? switchMode(state, "brainstorm", true) : state;
    case "voice-intent":
      if (event.intent === "enter-brainstorm") {
        return state.flowEnabled ? switchMode(state, "brainstorm", true) : state;
      }
      return switchMode(state, "normal");
    case "back":
      return switchMode(state, "normal");
    case "cold-start":
      if (state.mode === "normal" && state.previous === "normal" &&
          !state.inkArmed && !state.buttonDown) return state;
      return initialFlowMode(state.flowEnabled);
  }
}

export function micPolicy(state: FlowModeState): MicPolicy {
  return state.mode === "brainstorm" ? "continuous" : "per-session";
}

export function penRole(state: FlowModeState): PenRole {
  if (state.mode === "normal") return "reply-select";
  if (state.mode === "annotate") return "ink";
  return state.inkArmed ? "ink" : "pan";
}

export function fingerRole(state: FlowModeState): FingerRole {
  return state.mode === "normal" ? "app" : "scroll-pan";
}

/**
 * Recognize only explicit mode commands, not arbitrary uses of "brainstorm".
 * Negation wins over both entry and exit, so a spoken "don't stop" is safe.
 */
export function matchModeIntent(transcript: string): ModeIntent | null {
  const words = transcript.toLowerCase()
    .replace(/[’‘'ʼ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!words) return null;

  if (/\b(?:dont|do not|doesnt|didnt|never|no|not|cant|cannot|without)\b(?:\s+[a-z0-9]+){0,5}\s+brainstorm(?:ing)?\b/.test(words)) {
    return null;
  }
  if (/\b(?:stop brainstorming|exit brainstorm|end brainstorm)\b/.test(words)) {
    return "exit-brainstorm";
  }
  if (/\b(?:lets brainstorm|brainstorm mode|start brainstorming)\b/.test(words)) {
    return "enter-brainstorm";
  }
  return null;
}

/** Include the current pen role when Brainstorm is active, so the pill is truthful. */
export function pillLabel(state: FlowModeState, micOn: boolean): string {
  if (state.mode === "normal") return "Normal";
  if (state.mode === "annotate") return "Annotate";
  return "Brainstorm · " + (state.inkArmed ? "ink" : "pan") +
    " · mic " + (micOn ? "on" : "off");
}
