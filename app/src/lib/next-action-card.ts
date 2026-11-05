import type { NextAction } from "./next-action";

export type NextActionCardButtonId = "do" | "later" | "skip" | "why";

export interface NextActionCardButton {
  id: NextActionCardButtonId;
  label: string;
  accessibilityLabel: string;
  accessibilityHint: string;
}

export interface NextActionCardModel {
  title: string;
  detail: string;
  buttons: readonly NextActionCardButton[];
  whyText: string | null;
}

export interface NextActionCardHandlers {
  onDo: (action: NextAction) => void;
  onLater: (action: NextAction) => void;
  onSkip: (action: NextAction) => void;
}

/** The caller owns persistence and the one-hour snooze deadline. */
export const NEXT_ACTION_LATER_MS = 60 * 60 * 1000;

/** Pure projection: no clock, storage, transport, or side effects. */
export function cardModel(action: NextAction, options: { expandedWhy: boolean }): NextActionCardModel {
  const subject = action.title.trim() || "suggested action";
  return {
    title: action.title,
    detail: action.detail,
    buttons: [
      {
        id: "do",
        label: "Open",
        accessibilityLabel: "Open next action: " + subject,
        accessibilityHint: "Open this conversation without taking the suggested action.",
      },
      {
        id: "later",
        label: "Later",
        accessibilityLabel: "Snooze for one hour: " + subject,
        accessibilityHint: "Hide this suggestion for one hour in the app. No notification is sent.",
      },
      {
        id: "skip",
        label: "Skip",
        accessibilityLabel: "Skip next action: " + subject,
        accessibilityHint: "Dismiss this suggestion without performing it.",
      },
      {
        id: "why",
        label: "Why?",
        accessibilityLabel: (options.expandedWhy ? "Hide reason for: " : "Show reason for: ") + subject,
        accessibilityHint: "Expand or collapse why this action was suggested.",
      },
    ],
    whyText: options.expandedWhy ? action.why : null,
  };
}

/** Dispatch only an intent. Navigation, snooze, and dismissal belong to the caller. */
export function dispatchCardAction(
  id: Exclude<NextActionCardButtonId, "why">,
  action: NextAction,
  handlers: NextActionCardHandlers,
): void {
  switch (id) {
    case "do":
      handlers.onDo(action);
      return;
    case "later":
      handlers.onLater(action);
      return;
    case "skip":
      handlers.onSkip(action);
      return;
  }
}
