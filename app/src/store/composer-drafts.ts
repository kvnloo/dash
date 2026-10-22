import type { DraftAttachment } from "../lib/attachments";
import { createStore } from "./createStore";

export interface ComposerDraft { text: string; attachments: DraftAttachment[] }
/** Navigation lifetime only. Never keyed by host-global/latest session or copied to another chat. */
export const composerDrafts = createStore<Record<string, ComposerDraft>>({});
export function updateComposerDraft(id: string, seed: ComposerDraft, update: (draft: ComposerDraft) => ComposerDraft): void {
  composerDrafts.set(all => ({ ...all, [id]: update(all[id] ?? seed) }));
}
