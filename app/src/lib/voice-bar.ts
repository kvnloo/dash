import type { EdgeInsets } from "react-native-safe-area-context";
import type { VoiceState } from "./continuous-voice";

/** Min height of the app-wide voice pill's row (44 pt controls + 1 pt borders), used until it is measured. */
export const VOICE_BAR_ROW = 46;

/**
 * Insets the app below the voice root sees. While the pill is visible (including an error or
 * an idle call that can restart), it OWNS a band below the status bar. Every screen that already
 * respects the top safe-area inset then lays out below it. The device insets are never mutated.
 */
export function appInsets(device: EdgeInsets, visible: boolean, measuredRow = 0): EdgeInsets {
  if (!visible) return device;
  const row = Number.isFinite(measuredRow) && measuredRow > 0 ? measuredRow : VOICE_BAR_ROW;
  return { ...device, top: device.top + row };
}

/** Only keep idle Start in the pill after the user has initiated voice at least once. */
export function voiceBarVisible(phase: VoiceState["phase"], attempted: boolean): boolean {
  return attempted || phase !== "idle";
}

/** One home for controls: full-screen chat's dock, otherwise the app-wide pill. */
export function voiceControlHome(visible: boolean, windowOpen: boolean): "none" | "bar" | "window" {
  return !visible ? "none" : windowOpen ? "window" : "bar";
}

/** Stable native accessibility labels for coordinate-free Android voice journeys. */
export function voiceStatusAccessibilityLabel(state: Pick<VoiceState, "phase" | "muted" | "note">): string {
  if (state.note && state.phase !== "idle" && state.phase !== "error") return `Voice status: ${state.phase}. ${state.note}`;
  if (state.muted && state.phase !== "idle" && state.phase !== "error" && state.phase !== "connecting") {
    return "Voice status: muted";
  }
  return `Voice status: ${state.phase}`;
}

/** The Mute control describes its next action after each toggle. */
export function voiceMuteAccessibilityLabel(muted: boolean): "Mute voice" | "Unmute voice" {
  return muted ? "Unmute voice" : "Mute voice";
}

export type VoiceBarPresentation =
  | {
      phase: "idle" | "error";
      label: string;
      detail?: string;
      action: "start";
      primaryText: "Start" | "Retry";
      primaryLabel: string;
    }
  | {
      phase: "connecting" | "live" | "muted";
      label: string;
      action: "end";
      primaryText: "Cancel" | "End";
      primaryLabel: string;
      muteText: "Mute" | "Unmute";
    };

/**
 * Derive the whole control set from the actual call phase. "Muted" only claims that the
 * microphone is muted, not that reply audio or a connecting session has stopped.
 */
export function voiceBarPresentation(state: Pick<VoiceState, "phase" | "muted" | "note">): VoiceBarPresentation {
  if (state.phase === "error") {
    return {
      phase: "error",
      label: "Voice error",
      detail: state.note,
      action: "start",
      primaryText: "Retry",
      primaryLabel: "Start voice",
    };
  }
  if (state.phase === "idle") {
    return {
      phase: "idle",
      label: "Voice idle",
      action: "start",
      primaryText: "Start",
      primaryLabel: "Start voice",
    };
  }
  if (state.phase === "connecting") {
    return {
      phase: "connecting",
      label: state.muted ? "Voice connecting · mic muted" : "Voice connecting",
      action: "end",
      primaryText: "Cancel",
      primaryLabel: "End voice",
      muteText: state.muted ? "Unmute" : "Mute",
    };
  }
  if (state.muted) {
    return {
      phase: "muted",
      label: state.note ?? "Voice live · mic muted",
      action: "end",
      primaryText: "End",
      primaryLabel: "End voice",
      muteText: "Unmute",
    };
  }
  return {
    phase: "live",
    label: state.note ?? "Voice live · " + state.phase,
    action: "end",
    primaryText: "End",
    primaryLabel: "End voice",
    muteText: "Mute",
  };
}
