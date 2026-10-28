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
  /** Messages older than the conversation's own window, chronological: the rows the list shows above it. */
  older: Message[];
  /**
   * Messages older than `older`, chronological, paged in behind the newest page for the prompt rail
   * alone. They are not list rows: rows added above a reader who has scrolled up move what they are
   * reading (the list keeps their place by estimated row heights, which drift over thousands of
   * unmeasured rows). They join `older` a page at a time when the reader scrolls to the top, and at
   * once when they jump to one of their prompts.
   */
  unlisted: Message[];
  /**
   * Cursor for the next older page, beyond `unlisted` when there is any; null = start of chat;
   * undefined = paging unavailable (old bridge).
   */
  before: string | null | undefined;
  loading: boolean;
  error?: string;
  /**
   * `before` came with the page at the front of `older` (or `unlisted`), so the next page continues it
   * exactly (server keyset: AV ordinal, Hermes (timestamp, id)) and joins by id alone.
   */
  chained?: boolean;
}

export const historyPages = createStore<Readonly<Record<string, HistoryPagesState>>>({});
export const HISTORY_PAGE = 50;
/** The page size of the background fill below; GET /chats/history serves up to 200. */
export const HISTORY_FILL_PAGE = 200;
/** The fill retries a failed page after 1 s, 2 s, 4 s ... (30 s at most) and gives up after this many in a row. */
export const FILL_RETRIES = 7;
const FILL_RETRY_MAX_MS = 30_000;
/** The fill looks again this often while the owner's own page (scroll-up) is in flight. */
const FILL_WAIT_MS = 150;
/** Older messages kept in memory per chat, listed or not. */
export const OLDER_MAX = 2000;
const EMPTY: HistoryPagesState = { older: [], unlisted: [], before: undefined, loading: false };

export function historyState(conversationId: string): HistoryPagesState {
  return historyPages.get()[conversationId] ?? EMPTY;
}

/** Older messages loaded for the chat, listed or not. */
export function olderLoaded(state: HistoryPagesState): number {
  return state.older.length + state.unlisted.length;
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
  patch(conversationId, s => olderLoaded(s) > 0 || s.before === before ? s : { ...s, before, chained: false, error: undefined });
}

export function dropHistory(conversationId: string): void {
  historyPages.set(all => {
    if (!(conversationId in all)) return all;
    const rest: Record<string, HistoryPagesState> = {};
    for (const [id, state] of Object.entries(all)) if (id !== conversationId) rest[id] = state;
    return rest;
  });
}

/** Keep OLDER_MAX messages: the oldest go first, the unlisted before the listed. */
function capOlder(older: Message[], unlisted: Message[]): Pick<HistoryPagesState, "older" | "unlisted"> {
  const excess = older.length + unlisted.length - OLDER_MAX;
  if (excess <= 0) return { older, unlisted };
  const fromUnlisted = Math.min(excess, unlisted.length);
  return { unlisted: unlisted.slice(fromUnlisted), older: older.slice(excess - fromUnlisted) };
}

/** Fresh messages of a page: ids not already loaded or shown. */
function freshOf(state: HistoryPagesState, page: readonly Message[], shown: ReadonlySet<string>): Message[] {
  const known = new Set([...state.unlisted, ...state.older].map(m => m.id));
  return page.filter(m => !known.has(m.id) && !shown.has(m.id));
}

/** Prepend one older page to the list, dropping ids already shown. */
export function prependOlder(state: HistoryPagesState, page: readonly Message[], shown: ReadonlySet<string>, before: string | null): HistoryPagesState {
  return { ...state, ...capOlder([...freshOf(state, page, shown), ...state.older], state.unlisted), before, chained: true, loading: false, error: undefined };
}

/** Prepend one older page behind the list, for the prompt rail alone. */
export function prependUnlisted(state: HistoryPagesState, page: readonly Message[], shown: ReadonlySet<string>, before: string | null): HistoryPagesState {
  return { ...state, ...capOlder(state.older, [...freshOf(state, page, shown), ...state.unlisted]), before, chained: true, error: undefined };
}

/** The unlisted messages from the one with id `firstId` on join the list. */
export function listUnlisted(conversationId: string, firstId: string): void {
  patch(conversationId, s => {
    const at = s.unlisted.findIndex(m => m.id === firstId);
    if (at < 0) return s;
    return { ...s, older: [...s.unlisted.slice(at), ...s.older], unlisted: s.unlisted.slice(0, at) };
  });
}

export interface HistoryDeps {
  api: ChatsApi;
  settings: () => ApiSettings | null;
  /** The chat as it is now: a page lands seconds after it was asked for, and the chat's window moves meanwhile. */
  conversation: (id: string) => Conversation | undefined;
}
let deps: HistoryDeps = { api: chatsApi, settings: () => null, conversation: () => undefined };
export function configureHistoryPages(next: Partial<HistoryDeps>): void { deps = { ...deps, ...next }; }

type PageOutcome = "landed" | "failed" | "skipped";
/** The background fill's page in flight per chat, so the owner's own scroll-up can wait for it. */
const fillPages = new Map<string, Promise<PageOutcome>>();

/**
 * Fetch the next older page. `listed`: it is the owner's own scroll-up (a skeleton is drawn for it and
 * the page joins the list); otherwise it is the background fill's, which joins the unlisted rows.
 */
async function fetchOlder(conversation: Conversation, limit: number, listed: boolean): Promise<PageOutcome> {
  const state = historyState(conversation.id);
  const settings = deps.settings();
  if (!settings || state.loading || typeof state.before !== "string") return "skipped";
  const before = state.before;
  if (listed) patch(conversation.id, s => ({ ...s, loading: true, error: undefined }));
  const result = await deps.api.history(settings, { key: conversationKey(conversation), before, limit });
  if (!result.ok) {
    if (listed) patch(conversation.id, s => ({ ...s, loading: false, error: result.notModified || result.aborted ? undefined : "Could not load older messages." }));
    return "failed";
  }
  const current = deps.conversation(conversation.id) ?? conversation;
  const shown = new Set(current.messages.map(m => m.id));
  const page = alignToShown(historyToMessages(result.value.messages, conversation.id, conversation.harness === "hermes"), current, historyState(conversation.id));
  patch(conversation.id, s => s.before !== before ? (listed ? { ...s, loading: false } : s)
    : listed ? prependOlder(s, page, shown, result.value.before) : prependUnlisted(s, page, shown, result.value.before));
  return "landed";
}

/**
 * The reader reached the top of the list: the next page joins it. Rows the fill already paged in
 * join first, with no request; otherwise it is fetched. No-op while loading or when nothing is older.
 */
export async function loadOlder(conversation: Conversation): Promise<void> {
  // A background page is in flight: let it land (it joins the unlisted rows), then take from them.
  await fillPages.get(conversation.id);
  const unlisted = historyState(conversation.id).unlisted;
  const next = unlisted[Math.max(0, unlisted.length - HISTORY_PAGE)];
  if (next) { listUnlisted(conversation.id, next.id); return; }
  await fetchOlder(conversation, HISTORY_PAGE, true);
}

/**
 * Page the rest of an open chat in behind the newest page (up to OLDER_MAX), so the prompt rail
 * stands for the whole chat instead of only the rows loaded so far. Tool-heavy chats spend dozens of
 * rows per prompt, so the newest page alone holds a handful of them.
 *
 * The pages join the unlisted rows, never the list: the fill therefore cannot move what the owner
 * is reading, wherever they are in the chat. A failed page is retried with backoff, so a network
 * blip does not leave the rail partial; the caller starts the fill again when the bridge comes back
 * after it gave up. It runs until `open()` turns false, the chat starts, or OLDER_MAX rows are loaded.
 */
export async function fillOlder(conversation: Conversation, open: () => boolean): Promise<void> {
  let failures = 0;
  while (open()) {
    const state = historyState(conversation.id);
    if (typeof state.before !== "string" || olderLoaded(state) >= OLDER_MAX) return;
    // The owner's own page (scroll-up) is in flight: let it land, then carry on behind it.
    if (state.loading) { await sleep(FILL_WAIT_MS); continue; }
    const before = state.before;
    const page = fetchOlder(conversation, HISTORY_FILL_PAGE, false);
    fillPages.set(conversation.id, page);
    let outcome: PageOutcome;
    try { outcome = await page; } finally { if (fillPages.get(conversation.id) === page) fillPages.delete(conversation.id); }
    if (outcome === "landed" && historyState(conversation.id).before !== before) { failures = 0; continue; }
    if (++failures > FILL_RETRIES) return;
    await sleep(Math.min(FILL_RETRY_MAX_MS, 1000 * 2 ** (failures - 1)));
  }
}
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The messages of an older page that may join the scrollback. A page that continues `older`
 * (chained) is exact: ids dedupe it, and messages with no timestamp (at 0) or with a timestamp
 * shared across the page boundary are kept. The first page after a cursor that came with the shown
 * window is aligned by time, because ids alone do not dedupe chats whose shown messages carry phone
 * ids (Dash-started chats): it keeps messages at or before the oldest shown time that do not repeat
 * a shown message.
 */
function alignToShown(page: Message[], conversation: Conversation, state: HistoryPagesState): Message[] {
  if (state.chained) return page;
  const oldest = oldestShown(conversation, state);
  const shown = new Set(conversation.messages.map(signature));
  return page.filter(m => m.at <= oldest && !shown.has(signature(m)));
}

function signature(m: Message): string {
  return `${m.at}\u0000${m.text.slice(0, 200)}`;
}

/** Oldest timestamp on screen. A message without one (at 0) cannot pin it to the epoch. */
function oldestShown(conversation: Conversation, state: HistoryPagesState): number {
  let oldest = Infinity;
  for (const m of conversation.messages) if (m.at > 0 && m.at < oldest) oldest = m.at;
  for (const m of state.older) if (m.at > 0 && m.at < oldest) oldest = m.at;
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
 * Only messages at or before everything shown join `older`, so a stale cache never misorders.
 */
export async function primeCursor(conversation: Conversation): Promise<void> {
  const state = historyState(conversation.id);
  const settings = deps.settings();
  if (!settings || state.loading || state.before !== undefined || !conversation.sessionId || !conversation.targetHostId) return;
  patch(conversation.id, s => ({ ...s, loading: true }));
  const shown = new Set(conversation.messages.map(m => m.id));
  // The cached window (up to 80) can be longer than one page: walk back until a page reaches past
  // it, so the stored cursor never points inside what is already on screen.
  let before: string | undefined;
  for (let n = 0; n < PRIME_MAX_PAGES; n++) {
    const result = await deps.api.history(settings, { key: conversationKey(conversation), limit: HISTORY_PAGE, ...(before ? { before } : {}) });
    if (!result.ok) { patch(conversation.id, s => ({ ...s, loading: false })); return; }
    const page = alignToShown(historyToMessages(result.value.messages, conversation.id, conversation.harness === "hermes"), conversation, state);
    const next = result.value.before;
    if (page.length > 0 || next === null || n === PRIME_MAX_PAGES - 1) {
      patch(conversation.id, s => s.before !== undefined ? { ...s, loading: false } : prependOlder(s, page, shown, next));
      return;
    }
    before = next;
  }
}
