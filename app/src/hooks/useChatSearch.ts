import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ChatSearchHit, ChatSearchPage, HarnessInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { conversationEntries } from "../lib/chat-index";
import { localRowModel, mergeSearch, reuseRows, searchLocal, searchTerms, type SearchRowModel } from "../lib/chat-search";
import { LRU } from "../lib/lru";
import { createRequestGuard } from "../lib/request-guard";
import { chatsApi } from "../net/chats-api";
import { store } from "../store/app";
import { chatIndexStore, queryKey, type ChatQuery } from "../store/chat-index-store";

export const SEARCH_DEBOUNCE_MS = 200;
/** A partial page with fewer hits than this keeps scanning on its own. */
const MIN_FILL = 8;
const MAX_CHAINED = 3;

/** Remote pages per query. A cache hit renders at once, without the debounce. */
const searchCache = new LRU<ChatSearchPage[]>({ maxEntries: 16, ttlMs: 60_000 });

export interface ChatSearchState {
  rows: SearchRowModel[];
  /** Local matches only (already on the phone). */
  localCount: number;
  status: "idle" | "loading" | "ready" | "error";
  partial: boolean;
  hasMore: boolean;
  /** False on a bridge without chats.v1: results come from opened chats only. */
  remoteEnabled: boolean;
  loadMore(): void;
}

const NO_PAGES: ChatSearchPage[] = [];
const NO_CONVERSATIONS: readonly Conversation[] = [];
const NO_HARNESSES: readonly HarnessInfo[] = [];

interface RemoteState { key: string; pages: ChatSearchPage[]; status: ChatSearchState["status"] }

/**
 * Local-first chat search. Local hits filter precomputed haystacks of opened chats on a deferred
 * value (they never block typing); remote hits come from the bridge index after a 200 ms pause,
 * latest request wins.
 */
export function useChatSearch(query: string, opts: { enabled: boolean; filters?: ChatQuery; localLimit?: number; remoteLimit?: number; minRemoteChars?: number }): ChatSearchState {
  const { enabled } = opts;
  const deferred = useDeferredValue(query);
  // Idle search subscribes to nothing that changes per turn event: MainScreen calls this hook on
  // every render, and a live subscription would re-render the whole pager on each tool event.
  const conversations = store.use(s => (enabled ? s.conversations : NO_CONVERSATIONS));
  const harnesses = store.use(s => (enabled ? s.connection.harnesses : NO_HARNESSES));
  const settings = store.use(s => s.settings);
  const mode = chatIndexStore.use(s => s.mode);
  const remoteEnabled = mode === "chats" && Boolean(settings);
  const harnessName = useCallback((id: string) => harnesses.find(h => h.id === id)?.name ?? id, [harnesses]);

  const entries = useMemo(() => (enabled ? conversationEntries(conversations) : []), [enabled, conversations]);
  const terms = useMemo(() => searchTerms(deferred), [deferred]);
  const local = useMemo(() => {
    if (!enabled) return [];
    return searchLocal(entries, deferred, harnessName, opts.localLimit).map(row => localRowModel(row, terms));
  }, [enabled, entries, deferred, harnessName, opts.localLimit, terms]);

  const text = query.trim();
  const filters = opts.filters;
  const cacheKey = `${text.toLowerCase()}|${queryKey(filters)}`;
  const wantsRemote = enabled && remoteEnabled && text.length >= (opts.minRemoteChars ?? 1) && text.length <= 200;
  const [remote, setRemote] = useState<RemoteState>({ key: "", pages: [], status: "idle" });
  const guard = useRef(createRequestGuard());
  const loaded = useRef<{ key: string; pages: ChatSearchPage[] }>({ key: "", pages: [] });

  const run = useCallback((key: string, cursor: string | null, chained: number) => {
    const current = store.get().settings;
    if (!current) return;
    const ticket = guard.current.next();
    setRemote(prev => prev.key === key ? { ...prev, status: "loading" } : { key, pages: [], status: "loading" });
    void chatsApi.search(current, { q: text, limit: opts.remoteLimit ?? 20, cursor, kinds: filters?.kinds, hosts: filters?.hosts }, { signal: ticket.signal }).then(result => {
      if (!ticket.isCurrent()) return;
      if (!result.ok) {
        if (!result.notModified && result.aborted) return;
        setRemote(prev => ({ ...prev, key, status: "error" }));
        return;
      }
      const page = result.value;
      const prior = loaded.current.key === key && cursor ? loaded.current.pages : [];
      const pages = [...prior, page];
      loaded.current = { key, pages };
      setRemote({ key, pages, status: "ready" });
      searchCache.set(key, pages);
      const hits = pages.reduce((n, p) => n + p.hits.length, 0);
      if (page.partial && page.next && hits < MIN_FILL && chained < MAX_CHAINED) run(key, page.next, chained + 1);
    });
  }, [text, filters?.kinds, filters?.hosts, opts.remoteLimit]);

  useEffect(() => {
    if (!wantsRemote) {
      guard.current.cancel();
      setRemote(prev => prev.key === "" && prev.status === "idle" ? prev : { key: "", pages: [], status: "idle" });
      return;
    }
    const cached = searchCache.get(cacheKey);
    if (cached) {
      guard.current.cancel();
      loaded.current = { key: cacheKey, pages: cached };
      setRemote({ key: cacheKey, pages: cached, status: "ready" });
      return;
    }
    const timer = setTimeout(() => run(cacheKey, null, 0), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [wantsRemote, cacheKey, run]);

  useEffect(() => () => guard.current.cancel(), []);

  const remotePages = remote.key === cacheKey ? remote.pages : NO_PAGES;
  const lastPage = remotePages.at(-1);
  const loadMore = useCallback(() => {
    if (!wantsRemote || remote.status === "loading" || remote.key !== cacheKey) return;
    const next = remote.pages.at(-1)?.next;
    if (next) run(cacheKey, next, MAX_CHAINED);
  }, [wantsRemote, remote, cacheKey, run]);

  const previous = useRef(new Map<string, SearchRowModel>());
  const rows = useMemo(() => {
    const hits: ChatSearchHit[] = [];
    for (const page of remotePages) hits.push(...page.hits);
    const merged = reuseRows(previous.current, mergeSearch(local, hits, harnessName));
    previous.current = merged.byKey;
    return merged.rows;
  }, [local, remotePages, harnessName]);

  return {
    rows,
    localCount: local.length,
    status: wantsRemote ? (remote.key === cacheKey ? remote.status : "loading") : "idle",
    partial: lastPage?.partial ?? false,
    hasMore: Boolean(lastPage?.next),
    remoteEnabled,
    loadMore,
  };
}
