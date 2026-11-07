import { createStore } from "./createStore";
import type { IncomingShare } from "../lib/incoming-share";
export const sharedDrafts = createStore<Record<string, IncomingShare | undefined>>({});
export function stageSharedDraft(chatId: string, share: IncomingShare): boolean {
  if (sharedDrafts.get()[chatId]) return false;
  sharedDrafts.set(s => ({ ...s, [chatId]: share }));
  return true;
}
export function consumeSharedDraft(chatId: string, id: string): void {
  if (sharedDrafts.get()[chatId]?.id !== id) return;
  sharedDrafts.set(s => { const next = { ...s }; delete next[chatId]; return next; });
}
