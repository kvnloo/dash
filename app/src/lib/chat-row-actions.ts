import type { WindowOrigin } from "./chat-window";

/** Anything with React Native's `measureInWindow` (a row's host View). */
export interface MeasurableRow {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
}

/** Tap on a Chats row: measure it once (the window morphs from it), then open. An unmeasurable row still opens. */
export function pressRow(node: MeasurableRow | null, id: string, onPress: (id: string, origin?: WindowOrigin) => void): void {
  if (!node) { onPress(id); return; }
  node.measureInWindow((_x, y, _width, height) => onPress(id, Number.isFinite(y) && height > 0 ? { y, height } : undefined));
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

/** Long-press: in-app feedback selection when enabled, otherwise delete. */
export function rowLongPress<T>(feedbackOn: boolean, onFeedback: T, remove: T): T {
  return feedbackOn ? onFeedback : remove;
}
