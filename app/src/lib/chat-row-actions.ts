import type { BottomActionOption } from "./bottom-action-sheet";
import type { WindowOrigin } from "./chat-window";

export interface RowPressPosition {
  pageY: number;
  locationY: number;
}

/** Tap on a Chats row: open synchronously, using the press coordinates for the window morph when available. */
export function pressRow(position: RowPressPosition, height: number, id: string, onPress: (id: string, origin?: WindowOrigin) => void): void {
  const y = position.pageY - position.locationY;
  onPress(id, Number.isFinite(y) && y >= 0 && Number.isFinite(height) && height > 0 ? { y, height } : undefined);
}

export interface ChatRowDeps {
  select(): void;
  setActive(id: string): void;
  navigate(route: "Chat", params: { window: WindowOrigin }): void;
  confirm(title: string, message: string, action: string, run: () => void): void;
  remove(id: string): void;
}

/** Row actions: open = same conversation/session presented as a window over the list; remove = phone-local, confirmed. */
export function chatRowActions(deps: ChatRowDeps) {
  return {
    open(id: string, origin?: WindowOrigin): void {
      deps.select();
      deps.setActive(id);
      deps.navigate("Chat", { window: origin ?? { y: 0, height: 0 } });
    },
    remove(id: string): void {
      deps.confirm("Delete chat?", "This removes it from this phone only.", "Delete", () => deps.remove(id));
    },
  };
}

/**
 * Long-press on a chat row opens this menu and does nothing else. It used to submit
 * in-app feedback directly (feedback defaults on), which created a "Dash feedback" chat,
 * SENT "Selected chat …" to the agent and navigated into it: a long-press sent a message.
 */
export type ChatRowMenuChoice = "open" | "feedback" | "delete";

export function chatRowMenu(feedbackOn: boolean, title: string): { title: string; options: BottomActionOption[] } {
  const name = title.trim() || "Chat";
  return {
    title: name,
    options: [
      { id: "open", label: "Open", accessibilityLabel: `Open ${name}`, destructive: false },
      ...(feedbackOn ? [{ id: "feedback", label: "Send feedback about this chat", accessibilityLabel: `Send feedback about ${name}`, destructive: false }] : []),
      { id: "delete", label: "Delete from this phone", accessibilityLabel: `Delete ${name} from this phone`, destructive: true },
    ],
  };
}

/** Run one explicit menu choice. Unknown ids (or a dismissed menu) do nothing. */
export function runChatRowMenu(choice: string, id: string, handlers: { open(id: string): void; feedback(id: string): void; remove(id: string): void }): boolean {
  switch (choice) {
    case "open": handlers.open(id); return true;
    case "feedback": handlers.feedback(id); return true;
    case "delete": handlers.remove(id); return true;
    default: return false;
  }
}
