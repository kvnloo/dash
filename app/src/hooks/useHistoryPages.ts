import { useCallback, useEffect } from "react";
import type { Conversation } from "../model";
import { applyHistoryPage, store } from "../store/app";
import { chatIndexStore } from "../store/chat-index-store";
import { dropHistory, fillOlder, historyPages, loadNewest, loadOlder as loadOlderPage, primeCursor, type HistoryPagesState } from "../store/history-pages";

const NONE: HistoryPagesState = { older: [], unlisted: [], before: undefined, loading: false };
/** Let the newest page paint before the rest of the chat is paged in behind it. */
const FILL_DELAY_MS = 400;

/**
 * Older-page loading for the open chat. The newest page comes from the ws history reply (or, for
 * view-only chats, the first /chats/history call); scrolling up fetches `before` pages.
 *
 * The rest of the chat is also paged in behind the newest page (`unlisted`), for the prompt rail alone:
 * those rows are not in the list, so the paging never moves what the reader is looking at.
 */
export function useHistoryPages(conversation: Conversation | undefined): HistoryPagesState & { loadOlder(): void; canLoadOlder: boolean } {
  const id = conversation?.id;
  const state = historyPages.use(all => (id ? all[id] : undefined)) ?? NONE;
  const chats = chatIndexStore.use(s => s.mode === "chats");
  // The websocket serves catalog chats it still lists; view-only and ended chats read over HTTP.
  const httpOnly = conversation?.viewOnly === true || (chats && conversation?.stale === true);
  const empty = (conversation?.messages.length ?? 0) === 0;
  useEffect(() => {
    if (!conversation || !httpOnly || !empty) return;
    void loadNewest(conversation, messages => applyHistoryPage(conversation.id, messages));
    // Only on open: a view-only chat is loaded once per visit.
  }, [id, httpOnly]);
  const hasCursor = state.before !== undefined;
  const settled = !empty && Boolean(conversation?.sessionId);
  useEffect(() => {
    // Opened from its cached window (no ws reply this visit): find where older pages start.
    if (!chats || hasCursor || !settled || !conversation) return;
    const timer = setTimeout(() => void primeCursor(conversation), 600);
    return () => clearTimeout(timer);
  }, [id, chats, hasCursor, settled]);
  // The prompt rail stands for the whole chat: once the newest page is up and the older cursor is known,
  // page the rest in behind it (the rail's bars come from every loaded prompt). It starts again when the
  // bridge comes back after it gave up on a failing page.
  const paged = typeof state.before === "string";
  const online = store.use(s => s.connection.status === "online");
  useEffect(() => {
    if (!conversation || !paged) return;
    let open = true;
    const timer = setTimeout(() => void fillOlder(conversation, () => open), FILL_DELAY_MS);
    return () => { open = false; clearTimeout(timer); };
  }, [id, paged, online]);
  // Older pages are memory only; leaving a chat for another frees them.
  useEffect(() => () => { if (id) dropHistory(id); }, [id]);
  const loadOlder = useCallback(() => { if (conversation) void loadOlderPage(conversation); }, [conversation]);
  return { ...state, loadOlder, canLoadOlder: state.unlisted.length > 0 || typeof state.before === "string" };
}
