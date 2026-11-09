/** Pure dialog accessibility and dismissal decisions. No native imports. */
export interface DashDialogButton {
  id: string;
  label: string;
  role: "default" | "cancel" | "destructive";
}

export interface DashDialogRequest {
  title: string;
  message?: string;
  buttons: readonly DashDialogButton[];
}

/** Trap the VoiceOver accessibility traversal inside the visible dialog. */
export const dialogModalA11y = { accessibilityViewIsModal: true };
export const dialogTitleRole = "header";

/** Cancel belongs on the left in a two-action row, regardless of input order. */
export function dialogButtonOrder(buttons: readonly DashDialogButton[]): DashDialogButton[] {
  return [
    ...buttons.filter((button) => button.role === "cancel"),
    ...buttons.filter((button) => button.role !== "cancel"),
  ];
}

/**
 * The width is usable action-row width in DIP (scaled down by the host when
 * the user's font scale is greater than one). Err toward a vertical stack
 * rather than clip action labels. 44 DIP remains the minimum hit size.
 */
export function dialogButtonLayout(
  buttons: readonly DashDialogButton[],
  width: number,
): "row" | "column" {
  if (buttons.length !== 2 || !Number.isFinite(width) || width < 176) return "column";
  const estimatedWidth = buttons.reduce(
    (sum, button) => sum + Math.max(44, [...button.label].length * 9 + 32),
    8, // gap between two actions
  );
  return estimatedWidth <= width ? "row" : "column";
}

/** Destructive dialogs put the safest action under initial accessibility focus. */
export function dialogFirstFocusButtonId(buttons: readonly DashDialogButton[]): string | null {
  if (buttons.some((button) => button.role === "destructive")) {
    return buttons.find((button) => button.role === "cancel")?.id
      ?? buttons.find((button) => button.role === "default")?.id
      ?? buttons[0]?.id
      ?? null;
  }
  return buttons[0]?.id ?? null;
}

/**
 * Native Back / VoiceOver escape resolves with the cancel action, if present,
 * otherwise null. A backdrop tap must only call the resolver when non-null.
 */
export function dismissResult(buttons: readonly DashDialogButton[]): string | null {
  return buttons.find((button) => button.role === "cancel")?.id ?? null;
}
