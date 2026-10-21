import { parseReplyParts } from "../../../shared/reply-parts";
import type { ReplyPart } from "../../../shared/protocol";
import { useCallback, useSyncExternalStore } from "react";

// Streaming tokens arrive dozens of times a second per model. Each reply gets
// its own subscription, and notifications are coalesced to one per frame, so a
// token only ever re-renders the bubble it belongs to.

export interface KeyedStore {
  get(id: string): string;
  set(id: string, value: string): void;
  append(id: string, delta: string): void;
  clear(id: string): void;
  subscribe(id: string, listener: () => void): () => void;
}

export function createKeyedStore(): KeyedStore {
  const values = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  const dirty = new Set<string>();
  let scheduled = false;

  const flush = (): void => {
    scheduled = false;
    const ids = Array.from(dirty);
    dirty.clear();
    for (const id of ids) {
      const set = listeners.get(id);
      if (set) for (const listener of set) listener();
    }
  };

  const mark = (id: string): void => {
    dirty.add(id);
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };

  return {
    get: (id) => values.get(id) ?? "",
    set(id, value) {
      values.set(id, value);
      mark(id);
    },
    append(id, delta) {
      values.set(id, (values.get(id) ?? "") + delta);
      mark(id);
    },
    clear(id) {
      if (values.delete(id)) mark(id);
    },
    subscribe(id, listener) {
      const existing = listeners.get(id);
      const set = existing ?? new Set<() => void>();
      if (!existing) listeners.set(id, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(id);
      };
    },
  };
}

/** Live text of a reply while it streams. */
export const replyText = createKeyedStore();
/** One-line activity from an agent ("$ bun test", "read_file src/x.ts"). */
export const replyStatus = createKeyedStore();
export const replyParts = createKeyedStore();
export function partsFor(id: string): ReplyPart[] { try { return parseReplyParts(JSON.parse(replyParts.get(id) || "[]")) ?? []; } catch { return []; } }
export function appendReplyPart(id: string, part: ReplyPart): void {
  const parts = partsFor(id);
  const index = parts.findIndex(item => part.kind === "reasoning" ? item.kind === "reasoning" : "callId" in item && "callId" in part && item.callId === part.callId && (item.kind === part.kind || (part.kind === "tool_detail" && item.kind === "tool_output")));
  const previous = index >= 0 ? parts[index] : undefined;
  if (part.kind === "reasoning" && previous?.kind === "reasoning") parts[index] = { kind: "reasoning", text: (previous.text + part.text).slice(-131072) };
  else if (part.kind === "tool_output" && previous?.kind === "tool_output") parts[index] = { ...part, text: (previous.text + part.text).slice(-1048576), truncated: part.truncated || previous.truncated };
  else if (part.kind === "tool_detail") {
    // A detail is a replacement snapshot, not another copy of the output. Keep later deltas after it.
    for (let i = parts.length - 1; i >= 0; i--) { const item = parts[i]; if (item && "callId" in item && item.callId === part.callId && (item.kind === "tool_output" || item.kind === "tool_detail")) parts.splice(i, 1); }
    parts.push(part);
  } else if (index >= 0) parts[index] = part;
  else parts.push(part);
  replyParts.set(id, JSON.stringify(parts));
}

export function useKeyed(store: KeyedStore, id: string): string {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(id, listener),
    [store, id],
  );
  const read = useCallback(() => store.get(id), [store, id]);
  return useSyncExternalStore(subscribe, read, read);
}
