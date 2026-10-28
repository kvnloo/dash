/**
 * Standalone DF-115 presentation model.
 * NextAction is a structural copy of the selector contract in issue #444.
 * Keep the two shapes aligned when Hermes connects the components.
 */
export type NextActionKind = "approve" | "retry-send" | "read-reply" | "unstick" | "continue";

export interface NextAction {
  id: string;
  kind: NextActionKind;
  conversationId: string;
  title: string;
  detail: string;
  estimateSec: number;
  why: string;
}

export type NextActionCardButtonId = "do" | "later" | "skip" | "edit" | "why";

export interface NextActionCardButton {
  id: NextActionCardButtonId;
  label: string;
  accessibilityLabel: string;
  accessibilityHint: string;
}

export interface NextActionCardModel {
  title: string;
  detail: string;
  timeChip: string;
  buttons: readonly NextActionCardButton[];
  whyText: string | null;
}

export interface NextActionCardHandlers {
  onDo: (action: NextAction) => void;
  onLater: (action: NextAction) => void;
  onSkip: (action: NextAction) => void;
  onEdit: (action: NextAction) => void;
}

/** The caller owns persistence and the one-hour snooze deadline. */
export const NEXT_ACTION_LATER_MS = 60 * 60 * 1000;

export function formatActionTimeChip(estimateSec: number): string {
  if (!Number.isFinite(estimateSec) || estimateSec <= 0) return "Time varies";
  if (estimateSec < 60) return "~" + Math.ceil(estimateSec) + " sec";
  return "~" + Math.ceil(estimateSec / 60) + " min";
}

/** Pure projection: no clock, storage, transport, or side effects. */
export function cardModel(action: NextAction, options: { expandedWhy: boolean }): NextActionCardModel {
  const subject = action.title.trim() || "suggested action";
  return {
    title: action.title,
    detail: action.detail,
    timeChip: formatActionTimeChip(action.estimateSec),
    buttons: [
      {
        id: "do",
        label: "Do",
        accessibilityLabel: "Do next action: " + subject,
        accessibilityHint: "Open the conversation to handle this action.",
      },
      {
        id: "later",
        label: "Later",
        accessibilityLabel: "Snooze for one hour: " + subject,
        accessibilityHint: "Tell the app to remind you about this suggestion in one hour.",
      },
      {
        id: "skip",
        label: "Skip",
        accessibilityLabel: "Skip next action: " + subject,
        accessibilityHint: "Dismiss this suggestion without performing it.",
      },
      {
        id: "edit",
        label: "Edit",
        accessibilityLabel: "Edit next action: " + subject,
        accessibilityHint: "Open the conversation to revise this suggestion.",
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

/** Dispatch only an intent. Permission, execution, snooze, and dismissal belong to the caller. */
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
    case "edit":
      handlers.onEdit(action);
      return;
  }
}
