import type { SendMode } from "./composer-mode";

/** The single composer primary target selects one action for every render. */
export interface ComposerPrimaryInput {
  readonly editingQueue: boolean;
  readonly streaming: boolean;
  readonly steerBusy: boolean;
  readonly canSend: boolean;
  readonly sendMode: {
    readonly mode: SendMode;
    readonly label: string;
    readonly action: string;
  };
}

export type ComposerPrimaryActionState =
  | {
      readonly kind: "save-queue";
      readonly label: "Save queued merge";
      readonly hint: "Keep this merged message queued for the next turn";
      readonly disabled: boolean;
    }
  | {
      readonly kind: "stop";
      readonly label: "Stop";
      readonly hint: "Stop the running turn";
      readonly disabled: false;
    }
  | {
      readonly kind: "submit";
      readonly label: string;
      readonly hint: string;
      readonly disabled: boolean;
      readonly glyph: "arrow-up" | "corner-up-right";
    };

/**
 * Matches the live Composer's priority order:
 * preview save > running-and-empty Stop > send/steer/queue.
 * A sendable draft during a running turn retains the existing steer/queue path.
 */
export function selectComposerPrimaryAction(input: ComposerPrimaryInput): ComposerPrimaryActionState {
  if (input.editingQueue) {
    return {
      kind: "save-queue",
      label: "Save queued merge",
      hint: "Keep this merged message queued for the next turn",
      disabled: !input.canSend,
    };
  }
  if ((input.streaming || input.steerBusy) && !input.canSend) {
    return {
      kind: "stop",
      label: "Stop",
      hint: "Stop the running turn",
      disabled: false,
    };
  }
  return {
    kind: "submit",
    label: input.streaming && !input.steerBusy ? "Queue" : input.sendMode.action,
    hint: input.sendMode.label,
    disabled: !input.canSend,
    glyph: input.sendMode.mode === "steer" ? "corner-up-right" : "arrow-up",
  };
}

/** No side effects for disabled actions; exactly one callback for an enabled press. */
export function activateComposerPrimaryAction(
  action: ComposerPrimaryActionState,
  onSubmit: () => void,
  onStop: () => void,
): "submitted" | "stopped" | "disabled" {
  if (action.disabled) return "disabled";
  if (action.kind === "stop") {
    onStop();
    return "stopped";
  }
  onSubmit();
  return "submitted";
}
