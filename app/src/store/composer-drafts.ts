import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import type { DraftAttachment } from "../lib/attachments";
import { createStore, type Store } from "./createStore";

export interface ComposerDraft { text: string; attachments: DraftAttachment[] }

type DraftStore = Store<Record<string, ComposerDraft>>;
interface DraftRuntime { store: DraftStore; restored: Promise<void> }

// Fast Refresh re-evaluates modules without restarting the JavaScript runtime.
// Keep the store AND its storage lifecycle together so neither in-memory edits
// nor the pending debounce are lost, and reloads cannot install duplicate listeners.
declare global {
  var __dashComposerDraftsRuntime: DraftRuntime | undefined;
}

/**
 * Draft text survives an app restart, a Metro reload or a crash: it is written to device storage
 * shortly after each keystroke and immediately when the app leaves the foreground, then restored on
 * launch. Only text is kept; attachments refer to transient local files/uploads and are not restored
 * after a full restart.
 */
const KEY = "dash.composerDrafts.v1";
const WRITE_DELAY_MS = 250;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
type Saved = Record<string, { text: string; at: number }>;

function parseSaved(raw: string): Saved {
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const cutoff = Date.now() - MAX_AGE_MS;
  const next: Saved = {};
  for (const id of Object.keys(parsed)) {
    const candidate: unknown = Reflect.get(parsed, id);
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const text: unknown = Reflect.get(candidate, "text");
    const at: unknown = Reflect.get(candidate, "at");
    if (typeof text === "string" && typeof at === "number" && Number.isFinite(at) && at > cutoff) {
      next[id] = { text, at };
    }
  }
  return next;
}

function createDraftRuntime(): DraftRuntime {
  const store = createStore<Record<string, ComposerDraft>>({});
  let saved: Saved = {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = false;
  let rewrite = false;

  function snapshot(): Saved {
    const now = Date.now(), next: Saved = {};
    for (const [id, draft] of Object.entries(store.get())) {
      const prev = saved[id];
      if (draft.text.trim()) next[id] = { text: draft.text, at: prev && prev.text === draft.text ? prev.at : now };
    }
    return next;
  }

  // Serialize writes: a newer snapshot waits for an in-flight write.
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

  const restored: Promise<void> = AsyncStorage.getItem(KEY).then(raw => {
    if (!raw) return;
    saved = parseSaved(raw);
    // A storage read must not overwrite text typed before it completed.
    store.set(all => {
      const next = { ...all };
      for (const [id, draft] of Object.entries(saved)) {
        if (!next[id]?.text) next[id] = { text: draft.text, attachments: next[id]?.attachments ?? [] };
      }
      return next;
    });
  }).catch(() => undefined).finally(() => {
    store.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, WRITE_DELAY_MS);
    });
    AppState.addEventListener("change", state => { if (state !== "active") flush(); });
  });

  return { store, restored };
}

// A new JS runtime restores from AsyncStorage; Fast Refresh retains this singleton
// and its pending write even if this module and its consumers are re-evaluated.
const runtime = globalThis.__dashComposerDraftsRuntime ??= createDraftRuntime();

/** Keyed by conversation id. Never keyed by host-global/latest session or copied to another chat. */
export const composerDrafts = runtime.store;
export const draftsRestored = runtime.restored;

export function updateComposerDraft(id: string, seed: ComposerDraft, update: (draft: ComposerDraft) => ComposerDraft): void {
  composerDrafts.set(all => ({ ...all, [id]: update(all[id] ?? seed) }));
}
