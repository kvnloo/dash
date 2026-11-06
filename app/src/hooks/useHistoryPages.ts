import { useCallback, useEffect, useLayoutEffect } from "react";
import type { HistoryMessage } from "../../../shared/protocol";
import { useIsFocused } from "@react-navigation/native";
import type { Conversation } from "../model";
import { historyToMessages } from "../lib/live-sessions";
import { applyHistoryPage, store } from "../store/app";
import { chatIndexStore } from "../store/chat-index-store";
import { beginHistoryVisit, endHistoryVisit, fillOlder, historyPages, loadNewest, loadOlder as loadOlderPage, primeCursor, type HistoryPagesState } from "../store/history-pages";

const NONE: HistoryPagesState = { older: [], unlisted: [], before: undefined, loading: false };
/** Let the newest page paint before the rest of the chat is paged in behind it. */
const FILL_DELAY_MS = 400;

/** Native ids are stable when Hermes rewrites content in place; refresh the phone's
 * cached window too, not only older/rail-only pages. Keep a full expansion only if
 * the freshly truncated prefix still matches it.
 */
function refreshNativeWindow(conversation: Conversation, rows: HistoryMessage[]): void {
  if (conversation.harness !== "hermes" || rows.length === 0) return;
  const byId = new Map(historyToMessages(rows, conversation.id, true).map(message => [message.id, message]));
  store.set(state => {
    if (state.settings?.address !== conversation.endpointAddress) return state;
    const current = state.conversations.find(chat => chat.id === conversation.id);
    if (!current || current.endpointAddress !== conversation.endpointAddress ||
      current.harness !== conversation.harness || current.sessionId !== conversation.sessionId ||
      current.profileId !== conversation.profileId || current.targetHostId !== conversation.targetHostId) return state;
    let changed = false;
    const messages = current.messages.map(message => {
      const fresh = byId.get(message.id);
      if (!fresh || fresh.role !== message.role ||
        (fresh.truncated && !message.truncated && message.text.startsWith(fresh.text))) return message;
      if (fresh.text === message.text && fresh.truncated === message.truncated) return message;
      changed = true;
      return { ...message, text: fresh.text, truncated: fresh.truncated };
    });
    return changed ? {
      ...state,
      conversations: state.conversations.map(chat => chat.id === current.id ? { ...current, messages } : chat),
    } : state;
  });
}

/**
 * Older-page loading for the open chat. The newest page comes from the ws history reply (or, for
 * view-only chats, the first /chats/history call); scrolling up fetches `before` pages.
 *
 * The rest of the chat is also paged in behind the newest page (`unlisted`), for the prompt rail alone:
 * those rows are not in the list, so the paging never moves what the reader is looking at.
 */
export function useHistoryPages(conversation: Conversation | undefined): HistoryPagesState & { loadOlder(): void; canLoadOlder: boolean } {
  // Navigation can keep ChatScreen mounted after closing its window. Treat blur as the end
  // of the history visit even when the same conversation id is reopened later.
  const focused = useIsFocused();
  const id = focused ? conversation?.id : undefined;
  const state = historyPages.use(all => (id ? all[id] : undefined)) ?? NONE;
  // Refresh before the rail paints. A delayed cleanup from a popped screen may
  // only revoke its own visit, never a reopened screen with the same chat id.
  useLayoutEffect(() => {
    if (!id) return;
    const visit = beginHistoryVisit(id);
    return () => endHistoryVisit(id, visit);
  }, [id]);
  const chats = chatIndexStore.use(s => s.mode === "chats");
  // The websocket serves catalog chats it still lists; view-only and ended chats read over HTTP.
  const httpOnly = conversation?.viewOnly === true || (chats && conversation?.stale === true);
  const empty = (conversation?.messages.length ?? 0) === 0;
  // The native Hermes window may be cached locally with the same message ids and
  // cursor as rewritten host source. Ask the authenticated bridge every visit.
  const nativeRefresh = conversation?.harness === "hermes" && Boolean(conversation.sessionId && conversation.targetHostId);
  useEffect(() => {
    if (!id || !conversation || (!nativeRefresh && !(httpOnly && empty))) return;
    void loadNewest(conversation, messages => applyHistoryPage(conversation.id, messages),
      messages => refreshNativeWindow(conversation, messages));
  }, [id, httpOnly, empty, nativeRefresh]);
  const hasCursor = state.before !== undefined;
  const settled = !empty && Boolean(conversation?.sessionId);
  useEffect(() => {
    // Opened from its cached window (no ws reply this visit): find where older pages start.
    if (!id || !chats || hasCursor || !settled || !conversation) return;
    const timer = setTimeout(() => void primeCursor(conversation,
      messages => refreshNativeWindow(conversation, messages)), 600);
    return () => clearTimeout(timer);
  }, [id, chats, hasCursor, settled]);
  // The prompt rail stands for the whole chat: once the newest page is up and the older cursor is known,
  // page the rest in behind it (the rail's bars come from every loaded prompt). It starts again when the
  // bridge comes back after it gave up on a failing page.
  const paged = typeof state.before === "string";
  const online = store.use(s => s.connection.status === "online");
  useEffect(() => {
    if (!id || !conversation || !paged) return;
    let open = true;
    const timer = setTimeout(() => void fillOlder(conversation, () => open,
      messages => refreshNativeWindow(conversation, messages)), FILL_DELAY_MS);
    return () => { open = false; clearTimeout(timer); };
  }, [id, paged, online]);
  const loadOlder = useCallback(() => {
    if (id && conversation) void loadOlderPage(conversation,
      messages => refreshNativeWindow(conversation, messages));
  }, [id, conversation]);
  return { ...state, loadOlder, canLoadOlder: state.unlisted.length > 0 || typeof state.before === "string" };
}
