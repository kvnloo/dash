export interface NotificationToggleInput {
  readonly available: boolean;
  readonly enabled: boolean;
  readonly permission: string;
}

export function notificationToggleAccessibility(state: NotificationToggleInput) {
  const permission = state.permission.trim() || "unknown";
  const disabled = !state.available || permission === "unavailable" || permission === "unknown";
  // An enabled preference without a granted OS permission does not deliver notifications.
  const checked = !disabled && state.enabled && permission === "granted";

  return {
    visible: state.available,
    disabled,
    checked,
    actionLabel: disabled ? "Notifications unavailable" : checked ? "Disable notifications" : "Enable notifications",
    label: disabled
      ? `Notifications unavailable. Android permission: ${permission}.`
      : `Notifications ${checked ? "on" : "off"}. Android permission: ${permission}.`,
    hint: disabled
      ? "Notification controls are unavailable."
      : checked
        ? "Double tap to disable notifications."
        : "Double tap to enable notifications.",
    permissionLabel: `Android permission: ${permission}`,
  };
}
