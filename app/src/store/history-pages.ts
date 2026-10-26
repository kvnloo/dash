import type { HistoryMessage } from "../../../shared/protocol";
import { conversationKey } from "../lib/chat-index";
import { historyToMessages } from "../lib/live-sessions";
import type { Conversation, Message } from "../model";
import { chatsApi, type ApiSettings, type ChatsApi } from "../net/chats-api";
import { createStore } from "./createStore";

/**
 * Older transcript pages of open chats. In memory only: the cache file keeps the newest 80
 * messages as before, and scrolling up pages the rest in from the bridge.
 */
export interface HistoryPagesState {
  /** Messages older than the conversation's own window, chronological. */
  older: Message[];
  /** Cursor for the next older page; null = start of chat; undefined = paging unavailable (old bridge). */
  before: string | null | undefined;
  loading: boolean;
  error?: string;
}

export const historyPages = createStore<Readonly<Record<string, HistoryPagesState>>>({});
export const HISTORY_PAGE = 50;
/** Older messages kept in memory per chat. */
export const OLDER_MAX = 2000;
const EMPTY: HistoryPagesState = { older: [], before: undefined, loading: false };

export function historyState(conversationId: string): HistoryPagesState {
  return historyPages.get()[conversationId] ?? EMPTY;
}

function patch(conversationId: string, fn: (s: HistoryPagesState) => HistoryPagesState): void {
  historyPages.set(all => {
    const current = all[conversationId] ?? EMPTY;
    const next = fn(current);
    return next === current ? all : { ...all, [conversationId]: next };
  });
}

/** The newest page arrived (ws reply or first HTTP page): remember where older pages start. */
export function setHistoryCursor(conversationId: string, before: string | null | undefined): void {
  // Once older pages are loaded their cursor is further back; a refreshed newest page keeps it.
  patch(conversationId, s => s.older.length > 0 || s.before === before ? s : { ...s, before, error: undefined });
}

export function dropHistory(conversationId: string): void {
  historyPages.set(all => {
    if (!(conversationId in all)) return all;
    const rest: Record<string, HistoryPagesState> = {};
    for (const [id, state] of Object.entries(all)) if (id !== conversationId) rest[id] = state;
    return rest;
  });
}

/** Prepend one older page, dropping ids already shown. */
export function prependOlder(state: HistoryPagesState, page: readonly Message[], shown: ReadonlySet<string>, before: string | null): HistoryPagesState {
  const known = new Set(state.older.map(m => m.id));
  const fresh = page.filter(m => !known.has(m.id) && !shown.has(m.id));
  const older = [...fresh, ...state.older];
  return { ...state, older: older.length > OLDER_MAX ? older.slice(older.length - OLDER_MAX) : older, before, loading: false, error: undefined };
}

export interface HistoryDeps { api: ChatsApi; settings: () => ApiSettings | null }
let deps: HistoryDeps = { api: chatsApi, settings: () => null };
export function configureHistoryPages(next: Partial<HistoryDeps>): void { deps = { ...deps, ...next }; }

/** Fetch the next older page for an open chat. No-op while loading or when no cursor exists. */
export async function loadOlder(conversation: Conversation): Promise<void> {
  const state = historyState(conversation.id);
  const settings = deps.settings();
  if (!settings || state.loading || typeof state.before !== "string") return;
  const before = state.before;
  patch(conversation.id, s => ({ ...s, loading: true, error: undefined }));
  const result = await deps.api.history(settings, { key: conversationKey(conversation), before, limit: HISTORY_PAGE });
  if (!result.ok) {
    patch(conversation.id, s => ({ ...s, loading: false, error: result.notModified || result.aborted ? undefined : "Could not load older messages." }));
    return;
  }
  const shown = new Set(conversation.messages.map(m => m.id));
  // Ids alone do not dedupe chats whose shown messages carry phone ids (Dash-started chats): only
  // messages older than everything already shown join the scrollback.
  const oldest = oldestShown(conversation, historyState(conversation.id));
  const page = historyToMessages(result.value.messages, conversation.id).filter(m => m.at < oldest);
  patch(conversation.id, s => s.before !== before ? { ...s, loading: false } : prependOlder(s, page, shown, result.value.before));
}

function oldestShown(conversation: Conversation, state: HistoryPagesState): number {
  let oldest = Infinity;
  for (const m of conversation.messages) if (m.at < oldest) oldest = m.at;
  for (const m of state.older) if (m.at < oldest) oldest = m.at;
  return oldest;
}

/** Pages primeCursor walks back, at most, to get past the cached window. */
export const PRIME_MAX_PAGES = 4;

/** The first page for a chat the websocket cannot serve (view-only kinds). */
export async function loadNewest(conversation: Conversation, apply: (messages: HistoryMessage[]) => void): Promise<void> {
  const state = historyState(conversation.id);
  const settings = deps.settings();
  if (!settings || state.loading) return;
  patch(conversation.id, s => ({ ...s, loading: true, error: undefined }));
  const result = await deps.api.history(settings, { key: conversationKey(conversation), limit: HISTORY_PAGE });
  if (!result.ok) {
    patch(conversation.id, s => ({ ...s, loading: false, error: result.notModified || result.aborted ? undefined : "Could not load this chat from the bridge." }));
    return;
  }
  apply(result.value.messages);
  patch(conversation.id, s => ({ ...s, loading: false, before: result.value.before }));
}

/** Replace a truncated message's text with the full text from the bridge. */
export async function fetchFullText(conversation: Conversation, messageId: string): Promise<string | undefined> {
  const settings = deps.settings();
  if (!settings) return undefined;
  const result = await deps.api.message(settings, { key: conversationKey(conversation), id: messageId });
  if (!result.ok) return undefined;
  const text = result.value.text;
  patch(conversation.id, s => s.older.some(m => m.id === messageId)
    ? { ...s, older: s.older.map(m => m.id === messageId ? { ...m, text, truncated: undefined } : m) } : s);
  return text;
}

/**
 * Find the older-page cursor for a chat opened from its cached window (no ws reply this visit).
 * Only messages older than everything shown join `older`, so a stale cache never misorders.
 */
export async function primeCursor(conversation: Conversation): Promise<void> {
  const state = historyState(conversation.id);
  const settings = deps.settings();
  if (!settings || state.loading || state.before !== undefined || !conversation.sessionId || !conversation.targetHostId) return;
  patch(conversation.id, s => ({ ...s, loading: true }));
  const shown = new Set(conversation.messages.map(m => m.id));
  const oldest = oldestShown(conversation, state);
  // The cached window (up to 80) can be longer than one page: walk back until a page reaches past
  // it, so the stored cursor never points inside what is already on screen.
  let before: string | undefined;
  for (let n = 0; n < PRIME_MAX_PAGES; n++) {
    const result = await deps.api.history(settings, { key: conversationKey(conversation), limit: HISTORY_PAGE, ...(before ? { before } : {}) });
    if (!result.ok) { patch(conversation.id, s => ({ ...s, loading: false })); return; }
    const page = historyToMessages(result.value.messages, conversation.id).filter(m => m.at < oldest);
    const next = result.value.before;
    if (page.length > 0 || next === null || n === PRIME_MAX_PAGES - 1) {
      patch(conversation.id, s => s.before !== undefined ? { ...s, loading: false } : prependOlder(s, page, shown, next));
      return;
    }
    before = next;
  }
}
