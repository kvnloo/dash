import { createStore } from "./createStore";

/** Search is a temporary view, not a detach or a different send target. */
export const attachedUi = createStore({ search: false });
export function showAttachedSearch(search: boolean): void {
  attachedUi.set(() => ({ search }));
}
