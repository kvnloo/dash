/**
 * Screen-reader contract for the composer action menu.
 * This module has no native dependencies so disabled/loading/selection and
 * action routing can be checked before TalkBack or keyboard device passes.
 */
export type ComposerA11yState = {
  expanded?: boolean;
  disabled?: boolean;
  busy?: boolean;
  selected?: boolean;
};

export type ComposerA11yAction = {
  name: "activate" | "longpress";
  label: string;
};

export type ComposerA11yFlags = {
  disabled?: boolean;
  loading?: boolean;
  selected?: boolean;
};

export type ComposerA11yRow = ComposerA11yFlags & {
  label: string;
  value: string;
  run(): void;
};

export type ComposerA11yChoice = ComposerA11yFlags & {
  label: string;
  run(): void;
};

export type ComposerRowCallbacks = {
  dismiss(): void;
  showOptions(): void;
};

const named = (label: string, fallback: string): string => label.trim() || fallback;

export function composerMenuUnavailable(flags: ComposerA11yFlags): boolean {
  return flags.disabled === true || flags.loading === true;
}

function accessibilityState(
  flags: ComposerA11yFlags,
  expanded?: boolean,
  allowDismiss = false,
): ComposerA11yState {
  const state: ComposerA11yState = {};
  if (expanded !== undefined) state.expanded = expanded;
  if (flags.disabled !== undefined || flags.loading !== undefined) {
    state.disabled = !allowDismiss && composerMenuUnavailable(flags);
    if (flags.loading !== undefined) state.busy = flags.loading;
  }
  if (flags.selected !== undefined) state.selected = flags.selected;
  return state;
}

/** A closed, disabled menu cannot open; an already-open menu can still close. */
export function describeComposerMenuTrigger(label: string, open: boolean, flags: ComposerA11yFlags = {}) {
  const name = named(label, "Composer actions");
  const blocked = !open && composerMenuUnavailable(flags);
  return {
    label: name,
    hint: open
      ? "Activate to close the menu."
      : blocked ? "Menu unavailable." : "Activate to open. Hold and slide to choose a row.",
    state: accessibilityState(flags, open, open),
    actions: blocked ? [] : [{ name: "activate", label: open ? `Close ${name}` : `Open ${name}` }],
  };
}

/** The row's value is separate from its name; absent values are not fabricated. */
export function describeComposerMenuRow(row: ComposerA11yRow, expanded: boolean) {
  const name = named(row.label, "Unnamed menu action");
  const value = row.value.trim();
  const blocked = composerMenuUnavailable(row);
  const actions: ComposerA11yAction[] = blocked ? [] : [
    { name: "activate", label: `Activate ${name}` },
    { name: "longpress", label: `Show ${name} options` },
  ];
  return {
    label: name,
    value: value ? { text: value } : undefined,
    hint: blocked
      ? row.loading ? "Action in progress." : "Action unavailable."
      : value ? "Activate to run. Long press for options."
        : "Current value unavailable. Activate to run or hold for options.",
    state: accessibilityState(row, expanded),
    actions,
  };
}

/** Choice selection is reported only when a real choice supplies that state. */
export function describeComposerMenuChoice(choice: ComposerA11yChoice) {
  const name = named(choice.label, "Unnamed option");
  const blocked = composerMenuUnavailable(choice);
  return {
    label: name,
    hint: blocked ? choice.loading ? "Option in progress." : "Option unavailable." : undefined,
    state: accessibilityState(choice),
    actions: blocked ? [] : [{ name: "activate", label: `Select ${name}` }],
  };
}

/**
 * Route BOTH a tap and a screen-reader activate action through this function:
 * same close-then-run ordering, same target, no hidden extra selection.
 */
export function dispatchComposerMenuRowAction(
  row: ComposerA11yRow,
  actionName: string,
  callbacks: ComposerRowCallbacks,
): boolean {
  if (composerMenuUnavailable(row)) return false;
  if (actionName === "activate") {
    callbacks.dismiss();
    row.run();
    return true;
  }
  if (actionName === "longpress") {
    callbacks.showOptions();
    return true;
  }
  return false;
}

/** A selected option invokes its own real callback, never an inferred index. */
export function dispatchComposerMenuChoiceAction(
  choice: ComposerA11yChoice,
  actionName: string,
  dismiss: () => void,
): boolean {
  if (actionName !== "activate" || composerMenuUnavailable(choice)) return false;
  dismiss();
  choice.run();
  return true;
}

/** Restore trigger focus after explicit dismissal, not after navigation/selection. */
export function shouldRestoreComposerMenuFocus(
  wasOpen: boolean,
  isOpen: boolean,
  dismissedWithoutSelection: boolean,
): boolean {
  return wasOpen && !isOpen && dismissedWithoutSelection;
}
