import type { Connection } from "../model";

export interface ConnectionPillPresentation {
  readonly text: string;
  readonly accessibilityLabel: string;
  readonly accessibilityRole: "button" | "text";
  readonly accessibilityState: { readonly disabled: boolean; readonly busy: boolean };
  readonly canRetry: boolean;
}

/** A connection attempt is status text, never an actionable retry button. */
export function connectionPillPresentation(
  connection: Pick<Connection, "status" | "error">,
): ConnectionPillPresentation | null {
  switch (connection.status) {
    case "idle":
    case "online":
      return null;
    case "connecting":
      return {
        text: "Connecting to bridge…",
        accessibilityLabel: "Connecting to bridge",
        accessibilityRole: "text",
        accessibilityState: { disabled: true, busy: true },
        canRetry: false,
      };
    case "offline": {
      const error = connection.error?.trim();
      return {
        text: (error || "Offline") + " · Retry connection",
        accessibilityLabel: error
          ? "Bridge offline: " + error + ". Retry connection"
          : "Bridge offline. Retry connection",
        accessibilityRole: "button",
        accessibilityState: { disabled: false, busy: false },
        canRetry: true,
      };
    }
  }
}

/** Touch and screen-reader activation both use this guarded retry action. */
export function retryConnectionFromPill(
  presentation: ConnectionPillPresentation | null,
  retry: () => void,
): boolean {
  if (!presentation?.canRetry) return false;
  retry();
  return true;
}
