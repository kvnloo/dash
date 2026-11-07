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
  patch(conversationId, s => olderLoaded(s) > 0 || s.before === before ? s : { ...s, before, error: undefined });
}

export function dropHistory(conversationId: string): void {
  loadingOwners.delete(conversationId);
  visitOwners.delete(conversationId);
  fillPages.delete(conversationId);
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
  return { ...state, ...capOlder([...freshOf(state, page, shown), ...state.older], state.unlisted), before, loading: false, error: undefined };
}

/** Prepend one older page behind the list, for the prompt rail alone. */
export function prependUnlisted(state: HistoryPagesState, page: readonly Message[], shown: ReadonlySet<string>, before: string | null): HistoryPagesState {
  return { ...state, ...capOlder(state.older, [...freshOf(state, page, shown), ...state.unlisted]), before, error: undefined };
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

function ownsHistoryRequest(conversation: Conversation, settings: ApiSettings): boolean {
  return deps.settings() === settings && conversation.endpointAddress === settings.address
    && deps.conversation(conversation.id)?.endpointAddress === settings.address;
}

// A cursor refresh may replace list state without replacing its in-flight loader.
// A closed visit, however, must revoke that loader before another one can start.
const loadingOwners = new Map<string, symbol>();
function beginLoading(id: string): symbol {
  const owner = Symbol();
  loadingOwners.set(id, owner);
  patch(id, s => ({ ...s, loading: true, error: undefined }));
  return owner;
}
function releaseLoading(id: string, owner: symbol): boolean {
  if (loadingOwners.get(id) !== owner) return false;
  loadingOwners.delete(id);
  return true;
}

// Background pages do not hold the visible loading flag, but still belong to one
// open visit. A cursor or endpoint reused after close cannot revive that visit.
const visitOwners = new Map<string, symbol>();
function historyVisit(id: string): symbol {
  let owner = visitOwners.get(id);
  if (!owner) { owner = Symbol(); visitOwners.set(id, owner); }
  return owner;
}

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
  if (!ownsHistoryRequest(conversation, settings)) return "skipped";
  const before = state.before;
  const visit = historyVisit(conversation.id);
  const pending = listed ? beginLoading(conversation.id) : undefined;
  const result = await deps.api.history(settings, { key: conversationKey(conversation), before, limit });
  if (visitOwners.get(conversation.id) !== visit) return "skipped";
  if (pending && !releaseLoading(conversation.id, pending)) return "skipped";
  if (!ownsHistoryRequest(conversation, settings)) {
    if (listed) patch(conversation.id, s => ({ ...s, loading: false }));
    return "skipped";
  }
  if (!result.ok) {
    if (listed) patch(conversation.id, s => ({ ...s, loading: false, error: result.notModified || result.aborted ? undefined : "Could not load older messages." }));
    return "failed";
  }
  const current = deps.conversation(conversation.id) ?? conversation;
  const shown = new Set(current.messages.map(m => m.id));
  const page = historyToMessages(result.value.messages, conversation.id, conversation.harness === "hermes");
  patch(conversation.id, s => s.before !== before ? (listed ? { ...s, loading: false } : s)
    : listed ? prependOlder(s, page, shown, result.value.before) : prependUnlisted(s, page, shown, result.value.before));
  return "landed";
}

/**
 * The reader reached the top of the list: the next page joins it. Rows the fill already paged in
 * join first, with no request; otherwise it is fetched. No-op while loading or when nothing is older.
 */
export async function loadOlder(conversation: Conversation): Promise<void> {
  const visit = historyVisit(conversation.id);
  // A background page is in flight: let it land (it joins the unlisted rows), then take from them.
  await fillPages.get(conversation.id);
  if (visitOwners.get(conversation.id) !== visit) return;
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
  const visit = historyVisit(conversation.id);
  let failures = 0;
  while (open() && visitOwners.get(conversation.id) === visit) {
    if (!conversation.endpointAddress || conversation.endpointAddress !== deps.settings()?.address) return;
    const state = historyState(conversation.id);
    if (typeof state.before !== "string" || olderLoaded(state) >= OLDER_MAX) return;
    // The owner's own page (scroll-up) is in flight: let it land, then carry on behind it.
    if (state.loading) { await sleep(FILL_WAIT_MS); continue; }
    const before = state.before;
    const page = fetchOlder(conversation, HISTORY_FILL_PAGE, false);
    fillPages.set(conversation.id, page);
    let outcome: PageOutcome;
    try { outcome = await page; } finally { if (fillPages.get(conversation.id) === page) fillPages.delete(conversation.id); }
    if (visitOwners.get(conversation.id) !== visit) return;
    if (outcome === "landed" && historyState(conversation.id).before !== before) { failures = 0; continue; }
    if (++failures > FILL_RETRIES) return;
    await sleep(Math.min(FILL_RETRY_MAX_MS, 1000 * 2 ** (failures - 1)));
  }
}
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));


/** Pages primeCursor walks back, at most, to get past the cached window. */
export const PRIME_MAX_PAGES = 4;

/** The first page for a chat the websocket cannot serve (view-only kinds). */
export async function loadNewest(conversation: Conversation, apply: (messages: HistoryMessage[]) => void): Promise<void> {
  const state = historyState(conversation.id);
  const settings = deps.settings();
  if (!settings || state.loading) return;
  if (!ownsHistoryRequest(conversation, settings)) return;
  const pending = beginLoading(conversation.id);
  const result = await deps.api.history(settings, { key: conversationKey(conversation), limit: HISTORY_PAGE });
  if (!releaseLoading(conversation.id, pending)) return;
  if (!ownsHistoryRequest(conversation, settings)) {
    patch(conversation.id, s => ({ ...s, loading: false }));
    return;
  }
  if (!result.ok) {
    patch(conversation.id, s => ({ ...s, loading: false, error: result.notModified || result.aborted ? undefined : "Could not load this chat from the bridge." }));
    return;
  }
  const current = deps.conversation(conversation.id);
  if (current?.messages === conversation.messages) {
    apply(result.value.messages);
    patch(conversation.id, s => ({ ...s, loading: false, before: result.value.before }));
  } else patch(conversation.id, s => ({ ...s, loading: false }));
}

/** Replace a truncated message's text with the full text from the bridge. */
export async function fetchFullText(conversation: Conversation, messageId: string): Promise<string | undefined> {
  const settings = deps.settings();
  if (!settings) return undefined;
  if (!ownsHistoryRequest(conversation, settings)) return undefined;
  const visit = historyVisit(conversation.id);
  const result = await deps.api.message(settings, { key: conversationKey(conversation), id: messageId });
  if (visitOwners.get(conversation.id) !== visit || !ownsHistoryRequest(conversation, settings)) return undefined;
  if (!result.ok) return undefined;
  const text = result.value.text;
  patch(conversation.id, s => s.older.some(m => m.id === messageId)
    ? { ...s, older: s.older.map(m => m.id === messageId ? { ...m, text, truncated: undefined } : m) } : s);
  return text;
}

/**
 * Find the older-page cursor for a chat opened from its cached window (no ws reply this visit).
 * Server keysets and native ids determine membership; retained phone clocks cannot discard a page.
 */
export async function primeCursor(conversation: Conversation): Promise<void> {
  const state = historyState(conversation.id);
  const settings = deps.settings();
  if (!settings || state.loading || state.before !== undefined || !conversation.sessionId || !conversation.targetHostId) return;
  if (!ownsHistoryRequest(conversation, settings)) return;
  const pending = beginLoading(conversation.id);
  const shown = new Set(conversation.messages.map(m => m.id));
  // The cached window (up to 80) can be longer than one page: walk back until a page reaches past
  // it, so the stored cursor never points inside what is already on screen.
  let before: string | undefined;
  for (let n = 0; n < PRIME_MAX_PAGES; n++) {
    const result = await deps.api.history(settings, { key: conversationKey(conversation), limit: HISTORY_PAGE, ...(before ? { before } : {}) });
    if (loadingOwners.get(conversation.id) !== pending) return;
    if (!ownsHistoryRequest(conversation, settings)) {
      releaseLoading(conversation.id, pending);
      patch(conversation.id, s => ({ ...s, loading: false }));
      return;
    }
    if (!result.ok) {
      releaseLoading(conversation.id, pending);
      patch(conversation.id, s => ({ ...s, loading: false }));
      return;
    }
    const page = historyToMessages(result.value.messages, conversation.id, conversation.harness === "hermes").filter(message => !shown.has(message.id));
    const next = result.value.before;
    if (page.length > 0 || next === null || n === PRIME_MAX_PAGES - 1) {
      releaseLoading(conversation.id, pending);
      patch(conversation.id, s => s.before !== undefined ? { ...s, loading: false } : prependOlder(s, page, shown, next));
      return;
    }
    before = next;
  }
}
