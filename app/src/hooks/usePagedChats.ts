import { useCallback, useEffect, useMemo } from "react";
import { AppState as RNAppState } from "react-native";
import type { ChatSummary } from "../../../shared/protocol";
import { listRows } from "../lib/chat-index";
import { chatIndexStore, HEAD_TTL_MS, listState, loadMore as loadMorePage, queryKey, refreshHead, seedFromSnapshot, type ChatQuery, type ListStatus } from "../store/chat-index-store";

const NO_ROWS: ChatSummary[] = [];

export interface PagedChats {
  rows: ChatSummary[];
  status: ListStatus;
  loadingMore: boolean;
  exhausted: boolean;
  error?: string;
  /** False on a bridge without chats.v1: callers show phone conversations only. */
  enabled: boolean;
  loadMore(): void;
  refresh(): void;
}

/**
 * Cursor-driven infinite list for one query. Page 1 paints from the persisted snapshot, then a
 * conditional GET replaces it. The head refreshes on foreground, on reconnect, and every 30 s only
 * while `focused` (the Chats page is on screen).
 */
export function usePagedChats(query: ChatQuery = {}, opts: { focused?: boolean; online?: boolean } = {}): PagedChats {
  const key = queryKey(query);
  const mode = chatIndexStore.use(s => s.mode);
  const state = chatIndexStore.use(s => s.lists[key]);
  const enabled = mode === "chats";
  // Before hello, a persisted head (only ever written by a chats.v1 bridge) still paints at once.
  const shown = enabled || (mode === "unknown" && state?.seeded === true);
  const kinds = query.kinds?.join(","), hosts = query.hosts?.join(",");
  // Stable for the effects below while the filter text is the same.
  const stableQuery = useMemo((): ChatQuery => ({ ...(kinds ? { kinds: kinds.split(",") } : {}), ...(hosts ? { hosts: hosts.split(",") } : {}) }), [kinds, hosts]);

  useEffect(() => { void seedFromSnapshot(); }, []);
  useEffect(() => {
    if (enabled && opts.online !== false) void refreshHead(stableQuery);
  }, [enabled, opts.online, stableQuery]);
  useEffect(() => {
    if (!enabled) return;
    const sub = RNAppState.addEventListener("change", next => { if (next === "active") void refreshHead(stableQuery); });
    return () => sub.remove();
  }, [enabled, stableQuery]);
  useEffect(() => {
    if (!enabled || !opts.focused) return;
    const fetchedAt = listState(key).fetchedAt;
    if (fetchedAt === undefined || Date.now() - fetchedAt > HEAD_TTL_MS) void refreshHead(stableQuery);
    const timer = setInterval(() => { if (RNAppState.currentState === "active") void refreshHead(stableQuery); }, HEAD_TTL_MS);
    return () => clearInterval(timer);
  }, [enabled, opts.focused, key, stableQuery]);

  const loadMore = useCallback(() => { void loadMorePage(stableQuery); }, [stableQuery]);
  const refresh = useCallback(() => { void refreshHead(stableQuery, { force: true }); }, [stableQuery]);
  const list = state?.list;
  const rows = useMemo(() => (list && shown ? listRows(list) : NO_ROWS), [list, shown]);
  return {
    rows,
    status: state?.status ?? "idle",
    loadingMore: state?.loadingMore ?? false,
    exhausted: !shown || (state?.list.exhausted ?? false),
    ...(state?.error ? { error: state.error } : {}),
    enabled: shown,
    loadMore,
    refresh,
  };
}
