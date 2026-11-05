import { CHATS_FEATURE, type ChatPage, type ChatSummary } from "../../../shared/protocol";
import { applyHead, emptyList, findInList, mergePage, type PagedList } from "../lib/chat-index";
import { LRU } from "../lib/lru";
import { chatsApi, type ApiSettings, type ChatsApi } from "../net/chats-api";
import { loadHeadSnapshot, saveHeadSnapshot, type SnapshotStorage } from "./chat-index-snapshot";
import { createStore } from "./createStore";

/**
 * The phone's window onto the bridge chat index. Holds only loaded pages (an LRU of queries);
 * the bridge holds the full index. Separate from the app store so list paging never re-renders
 * chat screens.
 */

export type ChatsMode = "unknown" | "legacy" | "chats";
export type ListStatus = "idle" | "loading" | "ready" | "error";

export interface ChatQuery { kinds?: readonly string[]; hosts?: readonly string[] }

export interface ListState {
  list: PagedList;
  status: ListStatus;
  loadingMore: boolean;
  error?: string;
  etag?: string;
  /** Rows came from the persisted snapshot; the first network page replaces them in place. */
  seeded?: boolean;
  /** The bridge is still building its index (cold start fallback). */
  building?: boolean;
  fetchedAt?: number;
}

export interface ChatIndexState {
  mode: ChatsMode;
  lists: Readonly<Record<string, ListState>>;
}

export const chatIndexStore = createStore<ChatIndexState>({ mode: "unknown", lists: {} });

export function queryKey(query: ChatQuery = {}): string {
  const kinds = [...(query.kinds ?? [])].sort().join(",");
  const hosts = [...(query.hosts ?? [])].sort().join(",");
  return `k=${kinds}|h=${hosts}`;
}
export const DEFAULT_QUERY = queryKey();
export const PAGE_SIZE = 50;
/** A head older than this is refreshed on the next look. */
export const HEAD_TTL_MS = 30_000;

interface Deps {
  api: ChatsApi;
  settings: () => ApiSettings | null;
  storage?: SnapshotStorage;
  now: () => number;
}

let deps: Deps = { api: chatsApi, settings: () => null, now: () => Date.now() };

/** Wire the store to the app (settings source, storage) or to fakes in tests. */
export function configureChatIndex(next: Partial<Deps>): void {
  deps = { ...deps, ...next };
}

const lists = new LRU<true>({
  maxEntries: 8,
  onEvict: key => chatIndexStore.set(s => {
    if (!(key in s.lists) || key === DEFAULT_QUERY) return s;
    const rest: Record<string, ListState> = {};
    for (const [k, v] of Object.entries(s.lists)) if (k !== key) rest[k] = v;
    return { ...s, lists: rest };
  }),
});

function idle(): ListState { return { list: emptyList(), status: "idle", loadingMore: false }; }

export function listState(key: string): ListState {
  return chatIndexStore.get().lists[key] ?? idle();
}

function patchList(key: string, fn: (current: ListState) => ListState): void {
  lists.set(key, true);
  chatIndexStore.set(s => {
    const current = s.lists[key] ?? idle();
    const next = fn(current);
    return next === current ? s : { ...s, lists: { ...s.lists, [key]: next } };
  });
}

/** Feature detection from hello. A bridge without chats.v1 keeps the app in legacy mode. */
export function setChatsFeatures(features: readonly string[] | undefined): void {
  const mode: ChatsMode = features?.includes(CHATS_FEATURE) ? "chats" : "legacy";
  chatIndexStore.set(s => s.mode === mode ? s : { ...s, mode });
}

export function chatsMode(): ChatsMode { return chatIndexStore.get().mode; }

let snapshotRead: Promise<void> | undefined;
/** Seed the default list from the persisted head once, before the first network page. */
export function seedFromSnapshot(): Promise<void> {
  const storage = deps.storage;
  if (!storage) return Promise.resolve();
  snapshotRead ??= loadHeadSnapshot(storage).then(snapshot => {
    if (!snapshot || listState(DEFAULT_QUERY).list.version > 0) return;
    patchList(DEFAULT_QUERY, current => current.list.version > 0 ? current : {
      ...current, seeded: true, status: "ready", etag: snapshot.etag,
      list: { ...mergePage(emptyList(), { items: snapshot.items, next: snapshot.next, rev: snapshot.rev }), exhausted: false },
    });
  });
  return snapshotRead;
}

const inflight = new Map<string, Promise<void>>();
function once(id: string, run: () => Promise<void>): Promise<void> {
  const running = inflight.get(id);
  if (running) return running;
  const promise = run().finally(() => { inflight.delete(id); });
  inflight.set(id, promise);
  return promise;
}

function errorText(code: string): string {
  if (code === "busy") return "The bridge is busy. Retrying.";
  if (code === "not_found") return "Update the paired bridge to list every chat.";
  if (code === "network") return "Can't reach the bridge.";
  return "Could not load chats.";
}

/** Fetch page 1 (ETag-aware). A 304 keeps every loaded row as it is. */
export function refreshHead(query: ChatQuery = {}, opts: { force?: boolean } = {}): Promise<void> {
  const key = queryKey(query);
  return once(`head:${key}`, async () => {
    const settings = deps.settings();
    if (!settings || chatsMode() !== "chats") return;
    const before = listState(key);
    if (!opts.force && before.fetchedAt !== undefined && deps.now() - before.fetchedAt < 1000) return;
    patchList(key, s => s.list.version === 0 ? { ...s, status: "loading", error: undefined } : s);
    const result = await deps.api.list(settings, { limit: PAGE_SIZE, kinds: query.kinds, hosts: query.hosts }, { etag: before.list.version > 0 ? before.etag : undefined });
    const fetchedAt = deps.now();
    if (!result.ok) {
      if (result.notModified) { patchList(key, s => ({ ...s, status: "ready", seeded: false, fetchedAt })); return; }
      if (result.aborted) return;
      patchList(key, s => ({ ...s, status: s.list.version > 0 ? "ready" : "error", error: errorText(result.code), fetchedAt }));
      return;
    }
    const page = result.value;
    patchList(key, s => {
      const fresh = s.list.version === 0;
      const list = fresh ? mergePage(s.list, page) : withNext(applyHead(s.list, page), s.seeded ? page : undefined);
      return { ...s, list, status: "ready", error: undefined, etag: result.etag, seeded: false, building: result.building === true, fetchedAt };
    });
    if (key === DEFAULT_QUERY && deps.storage && !result.building) {
      void saveHeadSnapshot(deps.storage, { items: page.items, next: page.next, rev: page.rev, ...(result.etag ? { etag: result.etag } : {}) });
    }
  });
}

/** A seeded list takes the live cursor from its first real page. */
function withNext(list: PagedList, page: ChatPage | undefined): PagedList {
  if (!page) return list;
  return { ...list, next: page.next, exhausted: page.next === null && list.rows.length <= page.items.length };
}

/** Fetch the next page for a query unless one is already loading for it. */
export function loadMore(query: ChatQuery = {}): Promise<void> {
  const key = queryKey(query);
  return once(`more:${key}`, async () => {
    const settings = deps.settings();
    const current = listState(key);
    if (!settings || chatsMode() !== "chats" || current.seeded || current.list.version === 0 || current.list.exhausted || !current.list.next) return;
    const cursor = current.list.next;
    patchList(key, s => ({ ...s, loadingMore: true, error: undefined }));
    const result = await deps.api.list(settings, { limit: PAGE_SIZE, cursor, kinds: query.kinds, hosts: query.hosts });
    if (!result.ok) {
      if (!result.notModified && result.code === "bad_cursor") {
        // The index changed shape under the cursor: start over from page 1.
        patchList(key, () => idle());
        await refreshHead(query, { force: true });
        return;
      }
      patchList(key, s => ({ ...s, loadingMore: false, error: result.notModified || result.aborted ? s.error : errorText(result.code) }));
      return;
    }
    patchList(key, s => s.list.next !== cursor ? { ...s, loadingMore: false } : { ...s, loadingMore: false, list: mergePage(s.list, result.value) });
  });
}

/** Any loaded summary by key (search hits and roster rows carry their own). */
export function summaryByKey(key: string): ChatSummary | undefined {
  for (const state of Object.values(chatIndexStore.get().lists)) {
    const found = findInList(state.list, key);
    if (found) return found;
  }
  return undefined;
}

/** Forget every loaded page (unpair / forget everything). */
export function resetChatIndex(): void {
  lists.clear();
  inflight.clear();
  snapshotRead = undefined;
  chatIndexStore.set({ mode: "unknown", lists: {} });
}
