import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { DraftAttachment } from "../lib/attachments";
import { createStore } from "./createStore";

export interface ComposerDraft { text: string; attachments: DraftAttachment[] }
/** Keyed by conversation id. Never keyed by host-global/latest session or copied to another chat. */
export const composerDrafts = createStore<Record<string, ComposerDraft>>({});
export function updateComposerDraft(id: string, seed: ComposerDraft, update: (draft: ComposerDraft) => ComposerDraft): void {
  composerDrafts.set(all => ({ ...all, [id]: update(all[id] ?? seed) }));
}

/**
 * Draft text survives an app restart, a Metro reload or a crash: it is written to device storage
 * shortly after each keystroke and immediately when the app leaves the foreground, then restored on
 * launch. Only text is kept; attachments refer to transient local files/uploads and are not restored.
 */
const KEY = "dash.composerDrafts.v1";
const WRITE_DELAY_MS = 250;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
type Saved = Record<string, { text: string; at: number }>;

let saved: Saved = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function snapshot(): Saved {
  const now = Date.now(), next: Saved = {};
  for (const [id, draft] of Object.entries(composerDrafts.get())) {
    const prev = saved[id];
    if (draft.text.trim()) next[id] = { text: draft.text, at: prev && prev.text === draft.text ? prev.at : now };
  }
  return next;
}

// One storage write at a time: a newer snapshot waits for the in-flight write, so completion
// order can never let an older draft land after a newer one. Only the latest snapshot is queued.
let writing = false;
let rewrite = false;
function persist(): void {
  if (writing) { rewrite = true; return; }
  writing = true;
  const done = (): void => {
    writing = false;
    if (rewrite) { rewrite = false; persist(); }
  };
  AsyncStorage.setItem(KEY, JSON.stringify(saved)).then(done, done);
}

function flush(): void {
  if (timer) { clearTimeout(timer); timer = undefined; }
  saved = snapshot();
  persist();
}

export const draftsRestored: Promise<void> = AsyncStorage.getItem(KEY).then(raw => {
  if (!raw) return;
  const parsed = JSON.parse(raw) as Saved;
  const cutoff = Date.now() - MAX_AGE_MS;
  saved = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v && typeof v.text === "string" && v.at > cutoff));
  // Never overwrite something typed in the moments before storage answered.
  composerDrafts.set(all => {
    const next = { ...all };
    for (const [id, v] of Object.entries(saved)) if (!next[id]?.text) next[id] = { text: v.text, attachments: next[id]?.attachments ?? [] };
    return next;
  });
}).catch(() => undefined).finally(() => {
  composerDrafts.subscribe(() => { if (timer) clearTimeout(timer); timer = setTimeout(flush, WRITE_DELAY_MS); });
  AppState.addEventListener("change", state => { if (state !== "active") flush(); });
});
