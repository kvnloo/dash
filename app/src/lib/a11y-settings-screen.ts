import type { Handedness } from "./handedness";

export interface SettingsConnectA11yInput {
  firstRun: boolean;
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  hasAddress: boolean;
  hasCredential: boolean;
}

/** Copy and state for the existing connect action; never guesses that a connection succeeded. */
export function settingsConnectA11y(input: SettingsConnectA11yInput) {
  const label = input.saving
    ? "Connecting…"
    : input.firstRun
      ? "Connect"
      : input.dirty
        ? "Save and reconnect"
        : "Reconnect";

  let accessibilityHint: string;
  if (input.saving) {
    accessibilityHint = "Connection in progress";
  } else if (!input.hasAddress) {
    accessibilityHint = "Enter a bridge address to connect";
  } else if (!input.hasCredential) {
    accessibilityHint = "Enter a token or pair a bridge to connect";
  } else if (!input.canSave) {
    accessibilityHint = "Already connected; change a setting to reconnect";
  } else if (input.firstRun) {
    accessibilityHint = "Connect to the bridge using these settings";
  } else if (input.dirty) {
    accessibilityHint = "Save bridge settings and reconnect";
  } else {
    accessibilityHint = "Reconnect to the saved bridge";
  }

  return {
    label,
    accessibilityHint,
    accessibilityState: { disabled: !input.canSave, busy: input.saving },
  };
}

/** One toggle for both touch and accessibility activation; state mirrors panel mounting. */
export function settingsModelsA11y(expanded: boolean) {
  return {
    accessibilityLabel: "Models",
    accessibilityHint: expanded ? "Collapse model assignments" : "Expand model assignments",
    accessibilityState: { expanded },
  };
}

/** Radio semantics reflect persisted settings eligibility, not merely visual selection. */
export function settingsThumbA11y(choice: Handedness, preference: Handedness, enabled: boolean) {
  const side = choice === "auto" ? "Automatic" : choice === "left" ? "Left" : "Right";
  return {
    accessibilityLabel: side + " thumb side",
    accessibilityHint: !enabled
      ? "Pair a bridge to change thumb side"
      : choice === "auto"
        ? "Follow system preference when available, otherwise right"
        : "Use the " + choice + " thumb side",
    accessibilityState: { checked: choice === preference, disabled: !enabled },
  };
}

/** Group harness name and status so a color-only dot is never the sole indicator. */
export function settingsHarnessA11y(name: string, available: boolean): string {
  return (name.trim() || "Unnamed harness") + ", " + (available ? "installed" : "not found");
}
