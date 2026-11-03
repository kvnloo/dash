import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConversationPersistence, hasHostHistory, uniqueConversationIds } from "./conversation-persistence";
import { conversationFiles, conversationIndex } from "./conversation-files";
import { hostDisplayName } from "../../../shared/host-display";
import { appendReplyPart, partsFor, replyParts } from "./text";
import type { DetailMode } from "../lib/reply-details";
import { CHATS_FEATURE, type ChatAttachment, type ChatSummary, type ClientMessage, type HistoryMessage, type TurnEvent } from "../../../shared/protocol";
import { isCatalogHarness } from "../../../shared/catalog";
import {
  newId,
  parseConversation,
  parseSettings,
  titleFrom,
  type AssistantMessage,
  type Connection,
  type Conversation,
  type Message,
  type Settings,
} from "../model";
import { adoptSummary, hydrateLiveConversation, mergeHistoryWindow, mergeLiveConversations, mergeTranscriptMessages, resumableWithoutRoster, shouldRequestHistory } from "../lib/live-sessions";
import { historyState, olderLoaded, setHistoryCursor } from "./history-pages";
import { conversationKey } from "../lib/chat-index";
import { pruneArchive } from "./prune-archive";
import { createStore } from "./createStore";
import { bindChatIndex, sameChatEndpoint } from "./chat-index-store";
import { dequeue, enqueue, notifyTurnSettled } from "./queue";
import { nextPendingSend, parkMessage } from "./offline-send";
import { clearNextActionPreferences } from "./next-action-preferences";
import { combineQueued, mergedQueue, queuedParts, reorderQueued, queueMergeError } from "../lib/pending-queue";
import { replyText, replySummaries, replyStatus } from "./text";
import { appendActivity } from "../lib/message-details";
import type { AgentTarget } from "../mock/agents";
import { chatKind } from "../lib/roster";

const liveSequences = new Map<string, number>();

/** Streaming stores own only the working copy; the conversation owns checkpointed history. */
function releaseReply(message: Message): void {
  if (message.role !== "assistant") return;
  replyText.clear(message.turnId);
  replyParts.clear(message.turnId);
  replyStatus.clear(message.turnId);
  replySummaries.clearPrefix(`${message.turnId}:`);
  liveSequences.delete(message.turnId);
}

function releaseSettledReply(conversationId: string, messageId: string): void {
  const message = store.get().conversations.find(c => c.id === conversationId)?.messages.find(m => m.id === messageId);
  // A stale done event must not discard a newer, still-streaming working copy.
  if (message?.role === "assistant" && message.state !== "streaming" && message.state !== "pending") releaseReply(message);
}

export interface AppState {
  hydrated: boolean;
  settings: Settings | null;
  connection: Connection;
  /** Newest first. */
  conversations: Conversation[];
  activeId: string | null;
}

const KEYS = {
  settings: "dash.settings.v1",
  conversations: "dash.conversations.v1",
  activeId: "dash.activeId.v1",
} as const;

export const store = createStore<AppState>({
  hydrated: false,
  settings: null,
  connection: { status: "idle", harnesses: [], hosts: [] },
  conversations: [],
  activeId: null,
});

// ---- persistence -----------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const persistence = new ConversationPersistence(conversationFiles, conversationIndex);
let lastActiveId: string | null | undefined;

function persistenceFailure(): void {
  console.error("[dash.persistence] storage_operation_failed");
}
function saveConversations(): void {
  saveTimer = undefined;
  const { conversations, activeId } = store.get();
  // View-only chats are transient: they are read from the bridge and never written to the phone.
  const snapshots = conversations.filter(chat => !chat.viewOnly).map(chat => !hasHostHistory(chat) && chat.messages.some(message => message.role === "assistant" && message.state === "streaming")
    ? { ...chat, messages: chat.messages.map(message => message.role === "assistant" && message.state === "streaming"
      ? { ...message, parts: partsFor(message.turnId).length ? partsFor(message.turnId) : message.parts, text: replyText.get(message.turnId) || message.text, seq: Math.max(message.seq, liveSequences.get(message.turnId) ?? 0) } : message) }
    : chat);
  void persistence.save(snapshots).catch(persistenceFailure);
  if (lastActiveId !== activeId) {
    void AsyncStorage.setItem(KEYS.activeId, activeId ?? "").then(() => { lastActiveId = activeId; }, persistenceFailure);
  }
}
function scheduleSave(): void {
  if (!store.get().hydrated) return;
  saveTimer ??= setTimeout(saveConversations, 400);
}
function saveSettledReply(): void {
  if (!store.get().hydrated) return;
  clearTimeout(saveTimer);
  saveConversations();
}

export async function hydrate(): Promise<void> {
  // Read tiny durable settings independently: a broken transcript must not prevent pairing.
  const [settingsText, activeIdText] = await Promise.all([
    AsyncStorage.getItem(KEYS.settings).catch(() => null),
    AsyncStorage.getItem(KEYS.activeId).catch(() => null),
  ]);
  const settings = parseSettings(safeJson(settingsText));
  if (settings && !settings.chatIndexScope) {
    settings.chatIndexScope = newId();
    void AsyncStorage.setItem(KEYS.settings, JSON.stringify(settings));
  }
  bindChatIndex(settings);
  const activeId = activeIdText || null;
  let conversations: Conversation[] = [];
  let indexed = false;
  try {
    // Fast path: one index key with light entries. Transcripts load on demand, except the
    // active chat and chats with unsent work.
    const index = await persistence.loadIndex();
    if (index) {
      indexed = true;
      conversations = index.chats;
      const needed = new Set(index.pending);
      if (activeId) needed.add(activeId);
      for (const id of needed) {
        const stub = conversations.find(chat => chat.id === id);
        if (!stub) continue;
        let loaded: Conversation;
        try { loaded = await persistence.loadOne(stub); }
        catch { persistenceFailure(); continue; }
        const full = id === activeId ? loaded : await persistence.cached(loaded);
        conversations = conversations.map(chat => chat.id === id ? full : chat);
        persistence.markLoaded(id);
      }
    } else {
      conversations = await persistence.load();
      const migrated = await AsyncStorage.getItem("dash.conversations.migrated.v2");
      const recovered = migrated || await conversationFiles.read("durable", ".migration-complete.json");
      if (!recovered) {
        // Leave an unreadable legacy row untouched. The host can repopulate its cache.
        const rawLegacy = await AsyncStorage.getItem(KEYS.conversations);
        const legacy = safeJson(rawLegacy);
        if (rawLegacy && !Array.isArray(legacy)) throw new Error("Invalid legacy conversations");
        if (Array.isArray(legacy)) {
          const existing = new Set(conversations.map(chat => chat.id));
          const parsed = legacy.flatMap(raw => { const chat = parseConversation(raw); return chat ? [chat] : []; });
          for (const chat of uniqueConversationIds(parsed)) {
            if (!existing.has(chat.id)) { conversations.push(chat); existing.add(chat.id); }
          }
          await persistence.save(conversations);
        }
        await conversationFiles.write("durable", ".migration-complete.json", "true");
      }
      if (!migrated) {
        await AsyncStorage.removeItem(KEYS.conversations);
        await AsyncStorage.setItem("dash.conversations.migrated.v2", "true");
      }
    }
  } catch { persistenceFailure(); }
  const active = conversations.find(chat => chat.id === activeId);
  if (active) {
    const cached = await persistence.cached(active);
    conversations = conversations.map(chat => chat.id === cached.id ? cached : chat);
  }
  // Only loaded transcripts (active, pending) can hold a reply that was streaming at exit.
  for (const chat of conversations) for (const message of chat.messages) {
    if (message.role === "assistant" && message.state === "streaming") replyText.set(message.turnId, message.text);
  }
  lastActiveId = activeId;
  store.set(s => ({ ...s, hydrated: true, settings, conversations,
    activeId: conversations.some(chat => chat.id === activeId) ? activeId : null }));
  // First run on the v2 layout: the next save writes the v3 index.
  if (!indexed) scheduleSave();
  // After first paint: durable files the index missed (crash between writes, downgrade) rejoin it.
  else setTimeout(() => { void reconcileIndex().catch(persistenceFailure); }, 0);
}

/**
 * Add durable conversations the v3 index does not list to the store and the index. A new chat's
 * file is written before the index key, so a kill in between would otherwise hide it for good;
 * for a local chat that file is the only copy of the transcript. Returns how many were added.
 */
export async function reconcileIndex(): Promise<number> {
  const found = await persistence.orphans();
  if (!found.length) return 0;
  let added: Conversation[] = [];
  store.set(s => {
    const ids = new Set(s.conversations.map(c => c.id));
    added = found.filter(c => !ids.has(c.id));
    return added.length ? { ...s, conversations: [...s.conversations, ...added] } : s;
  });
  persistence.adopt(added);
  scheduleSave();
  return added.length;
}

function safeJson(text: string | null | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---- settings / connection -------------------------------------------------

export function saveSettings(settings: Settings): void {
  const previous = store.get().settings;
  settings = { ...settings, chatIndexScope: sameChatEndpoint(previous, settings) && previous?.chatIndexScope ? previous.chatIndexScope : newId() };
  bindChatIndex(settings);
  store.set((s) => ({ ...s, settings }));
  void AsyncStorage.setItem(KEYS.settings, JSON.stringify(settings));
}

/** Body hash of the hosts the store holds, so an unchanged roster keeps its reference. */
let hostsBody: { hosts: Connection["hosts"]; body: string } | undefined;

export function chatsEnabled(connection: Pick<Connection, "features">): boolean {
  return connection.features?.includes(CHATS_FEATURE) === true;
}

export function setConnection(patch: Partial<Connection>): void {
  let conversationsChanged = false;
  store.set((s) => {
    let hosts = s.connection.hosts;
    if (patch.hosts !== undefined) {
      const named = patch.hosts.map(host => ({ ...host, name: hostDisplayName(host) }));
      const body = JSON.stringify(named);
      const known = hostsBody?.hosts === s.connection.hosts ? hostsBody.body : JSON.stringify(s.connection.hosts);
      hosts = body === known ? s.connection.hosts : named;
      hostsBody = { hosts, body };
    }
    const sameFeatures = patch.features === undefined || (patch.features.length === s.connection.features?.length && patch.features.every((f, i) => s.connection.features?.[i] === f));
    const connection = { ...s.connection, ...patch, hosts, features: sameFeatures ? s.connection.features : patch.features };
    const was = s.connection;
    const unchanged = hosts === was.hosts && sameFeatures && connection.status === was.status && connection.host === was.host &&
      connection.cwd === was.cwd && connection.harnesses === was.harnesses && connection.error === was.error;
    if (patch.hosts === undefined) return unchanged ? s : { ...s, connection };
    // chats.v1: only running or host-held sessions become conversations; the paged list has the rest.
    const conversations = mergeLiveConversations(s.conversations, connection.hosts, Date.now(), { endpointAddress: s.settings?.address, adopt: chatsEnabled(connection) ? "live" : "all", routes: connection.routes });
    conversationsChanged = conversations !== s.conversations;
    if (!conversationsChanged) return unchanged ? s : { ...s, connection };
    return { ...s, connection, conversations };
  });
  if (conversationsChanged) scheduleSave();
}

/**
 * `send` reaches the bridge (to drop its notice ring) when the caller still holds an open socket.
 * The store never imports the socket module itself: that pulls react-native into store tests.
 */
export async function forgetEverything(send: (message: ClientMessage) => boolean = () => false): Promise<void> {
  const { agentNoticeInbox }: typeof import("./notices") = require("./notices");
  await agentNoticeInbox.forget(send);
  const enrollment = store.get().settings?.identity;
  if (enrollment) {
    const { setSecret }: typeof import("../lib/secure") = require("../lib/secure");
    const { identitySecretKey }: typeof import("../lib/identity-client") = require("../lib/identity-client");
    await setSecret(identitySecretKey(enrollment.credentialId), "");
    const { clearIdentityTokens }: typeof import("../lib/bridge-auth") = require("../lib/bridge-auth");
    clearIdentityTokens();
  }
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
  await persistence.clear();
  await AsyncStorage.multiRemove([KEYS.settings, KEYS.conversations, KEYS.activeId, "dash.conversations.migrated.v2", "dash.chats.migrated.v3", "dash.chats.head.v1"]);
  const { resetChatIndex }: typeof import("./chat-index-store") = require("./chat-index-store");
  resetChatIndex();
  lastActiveId = undefined;
  for (const chat of store.get().conversations) for (const message of chat.messages) releaseReply(message);
  store.set((s) => ({
    ...s,
    settings: null,
    conversations: [],
    activeId: null,
    connection: { status: "idle", harnesses: [], hosts: [] },
  }));
  await clearNextActionPreferences();
}

// ---- conversations ---------------------------------------------------------

type LiveHistoryRequest = (input: { conversationId: string; harness: string; sessionId: string; cwd?: string; hostId?: string; profileId?: string }) => void;
let requestLiveHistory: LiveHistoryRequest | undefined;

export function setLiveHistoryRequester(fn: LiveHistoryRequest | undefined): void {
  requestLiveHistory = fn;
}

/**
 * The roster id for a host id a bridge reported. An older bridge names itself by OS hostname
 * ("host-b") while the roster keys the same computer by its MagicDNS label ("0").
 */
export function rosterHostId(hostId: string | undefined, connection: Pick<Connection, "hosts" | "host">): string | undefined {
  if (!hostId || connection.hosts.some(h => h.id === hostId)) return hostId;
  const self = connection.hosts.find(h => h.self);
  if (self && (self.hostname === hostId || self.name === hostId || connection.host === hostId)) return self.id;
  return hostId;
}

export function applyLiveHistory(harness: string, sessionId: string, messages: HistoryMessage[], hostId?: string, profileId?: string): void {
  const host = rosterHostId(hostId, store.get().connection);
  const candidates = store.get().conversations.filter(c => c.endpointAddress !== undefined && c.endpointAddress === store.get().settings?.address && c.harness === harness && c.sessionId === sessionId && (!host || c.targetHostId === host) && (!profileId || c.profileId === profileId));
  const conv = candidates.length === 1 ? candidates[0] : undefined;
  if (!conv) return;
  // Once older pages are loaded, a refreshed newest window merges (as a ws history reply does), so the
  // rows that slid out of it stay in the scrollback.
  const merge = olderLoaded(historyState(conv.id)) > 0;
  updateConversation(conv.id, (c) => merge ? mergeHistoryWindow(c, messages) : hydrateLiveConversation(c, messages));
}

/** A ws history reply matched to its request: no harness/session guessing. */
export function applyLiveHistoryTo(conversationId: string, messages: HistoryMessage[]): void {
  updateConversation(conversationId, c => hydrateLiveConversation(c, messages));
}

/**
 * A paged (chats.v1) ws history reply. Once older pages are loaded, their cursor is kept, so the
 * refreshed window merges instead of replacing: messages that slid out of the newest window stay.
 */
export function applyHistoryReply(conversationId: string, messages: HistoryMessage[], before: string | null | undefined): void {
  if (olderLoaded(historyState(conversationId)) > 0) updateConversation(conversationId, c => mergeHistoryWindow(c, messages));
  else applyLiveHistoryTo(conversationId, messages);
  // An old bridge never sends `before`: older pages stay unavailable.
  setHistoryCursor(conversationId, before);
}
/** The first /chats/history page of a chat the websocket cannot serve. */
export const applyHistoryPage = applyLiveHistoryTo;

/** Full text for a message the host history cut. */
export function replaceMessageText(conversationId: string, messageId: string, text: string): void {
  updateConversation(conversationId, c => c.messages.some(m => m.id === messageId)
    ? { ...c, messages: c.messages.map(m => m.id === messageId ? { ...m, text, truncated: undefined } : m) } : c);
}

export function setDetailMode(id: string, detailMode: DetailMode): void { updateConversation(id, c => ({ ...c, detailMode })); }

export function setActive(id: string | null): void {
  store.set((s) => {
    const previous = s.activeId && s.activeId !== id ? s.conversations.find(c => c.id === s.activeId) : undefined;
    // Leaving a view-only chat drops it: it was never the phone's to keep.
    let conversations = previous?.viewOnly ? s.conversations.filter(c => c !== previous) : s.conversations;
    // Opening an adopted host chat marks it opened: the archive prune (live: rows only) never removes it.
    const target = id?.startsWith("live:") ? conversations.findIndex(c => c.id === id) : -1;
    const opening = conversations[target];
    if (opening && opening.openedAt === undefined) {
      conversations = conversations.slice();
      conversations[target] = { ...opening, openedAt: Date.now() };
    }
    return s.activeId === id && conversations === s.conversations ? s : { ...s, activeId: id, conversations };
  });
  scheduleSave();
  if (!id) return;
  const current = store.get().conversations.find((c) => c.id === id);
  if (current && (!persistence.isLoaded(current.id) || (current.messages.length === 0 && current.sessionId))) {
    // Hydration changes transcript identity but is not competing user work. Capture
    // the network snapshot only after the durable/cache load has settled.
    void loadTranscript(current).catch(persistenceFailure).then(() => requestActiveHistory(id));
    return;
  }
  requestActiveHistory(id);
}

function requestActiveHistory(id: string): void {
  const state = store.get();
  if (state.activeId !== id) return;
  const current = state.conversations.find(c => c.id === id);
  if (!current || !shouldRequestHistory(current) || !current.sessionId || conversationTargetError(current)) return;
  requestLiveHistory?.({ conversationId: current.id, harness: current.harness, sessionId: current.sessionId, cwd: current.cwd, hostId: current.targetHostId, profileId: current.profileId });
}

/** Read a conversation's durable transcript (if the index hydrated it as a stub) and its cache. */
async function loadTranscript(current: Conversation): Promise<void> {
  const loaded = await persistence.loadOne(current);
  const full = await persistence.cached(loaded);
  let applied = false;
  store.set(state => ({ ...state, conversations: state.conversations.map(chat => {
    if (chat.id !== current.id || chat.sessionId !== current.sessionId || chat.harness !== current.harness ||
      chat.profileId !== current.profileId || chat.targetHostId !== current.targetHostId || chat.endpointAddress !== current.endpointAddress) return chat;
    applied = true;
    return chat === current ? full : { ...chat, messages: mergeTranscriptMessages(full.messages, chat.messages) };
  }) }));
  if (!applied) return;
  persistence.markLoaded(current.id);
  const messages = store.get().conversations.find(chat => chat.id === current.id)?.messages ?? [];
  for (const message of messages) {
    if (message.role === "assistant" && message.state === "streaming" && !replyText.get(message.turnId)) replyText.set(message.turnId, message.text);
  }
  scheduleSave();
}

/**
 * Open a chat from the paged list or search. Only opened chats become conversations: a chatable
 * summary is adopted and persisted, a view-only one opens transiently.
 */
export function openChat(summary: ChatSummary): Conversation {
  const { conversations } = store.get();
  const existing = conversations.find(c => c.endpointAddress === store.get().settings?.address && conversationKey(c) === summary.key);
  if (existing) {
    const updated = summary.model ? { ...existing, sessionModel: { sessionId: summary.sessionId, model: summary.model } } : existing;
    if (updated !== existing) store.set(s => ({ ...s, conversations: s.conversations.map(c => c.id === existing.id ? updated : c) }));
    setActive(existing.id);
    return updated;
  }
  let conversation = { ...adoptSummary(summary, Date.now(), store.get().connection.hosts.find(host => host.self)?.id), endpointAddress: store.get().settings?.address };
  if (conversations.some(c => c.id === conversation.id)) conversation = { ...conversation, id: `${conversation.id}:endpoint:${encodeURIComponent(conversation.endpointAddress ?? "")}` };
  store.set(s => ({ ...s, conversations: [conversation, ...s.conversations] }));
  persistence.markLoaded(conversation.id);
  setActive(conversation.id);
  return conversation;
}

/** Open a conversation a search listed (e.g. a /live row) that the store may not hold yet. */
export function openListedConversation(conversation: Conversation): Conversation {
  // Saved search hits retain their original provenance, including unowned legacy rows.
  if (store.get().conversations.includes(conversation)) { setActive(conversation.id); return conversation; }
  const endpointAddress = store.get().settings?.address;
  const scopedId = `${conversation.id}:endpoint:${encodeURIComponent(endpointAddress ?? "")}`;
  const existing = store.get().conversations.find(c => (c.id === conversation.id || c.id === scopedId) && c.endpointAddress === endpointAddress);
  if (existing) { setActive(existing.id); return existing; }
  const id = store.get().conversations.some(c => c.id === conversation.id) ? scopedId : conversation.id;
  const adopted: Conversation = { ...conversation, id, endpointAddress, openedAt: conversation.openedAt ?? Date.now() };
  store.set(s => ({ ...s, conversations: [adopted, ...s.conversations] }));
  persistence.markLoaded(adopted.id);
  setActive(adopted.id);
  return adopted;
}

/** Drop a transient view-only chat (the chat screen closed). */
export function releaseViewOnly(id: string): void {
  store.set(s => {
    const chat = s.conversations.find(c => c.id === id);
    if (!chat?.viewOnly) return s;
    return { ...s, conversations: s.conversations.filter(c => c !== chat), activeId: s.activeId === id ? null : s.activeId };
  });
}

/**
 * One-time chats.v1 migration: drop never-opened adopted archive rows from the phone (the paged
 * list brings them back) and stamp the rest `openedAt`. Runs after first paint, in batches.
 */
export async function migrateArchive(options: { legacy: boolean; pause?: () => Promise<void> }): Promise<void> {
  if (!store.get().hydrated) return;
  // The live store decides, at the moment of each removal: an opened, active or written-to chat stays.
  const prunable = (s: AppState, id: string) => {
    const c = s.conversations.find(chat => chat.id === id);
    return !c || (c.endpointAddress !== undefined && c.endpointAddress === s.settings?.address && c.id !== s.activeId && c.openedAt === undefined && c.messages.length === 0);
  };
  const result = await pruneArchive({ storage: AsyncStorage, activeId: store.get().activeId, legacy: options.legacy, pause: options.pause, stillPrunable: id => prunable(store.get(), id) });
  if (result.status !== "done") return;
  const removed = new Set(result.pruned);
  const opened = new Map(result.kept.map(chat => [chat.id, chat.openedAt]));
  store.set(s => ({ ...s, conversations: s.conversations.filter(c => !removed.has(c.id) || !prunable(s, c.id)).map(c => {
    const at = opened.get(c.id);
    return c.openedAt === undefined && at !== undefined ? { ...c, openedAt: at } : c;
  }) }));
  // Every removed file is forgotten; one the user opened after its removal is still in the store,
  // so the next save writes it again. The index is rebuilt in full from the store.
  persistence.forget(result.pruned);
  persistence.markIndexDirty();
  scheduleSave();
}

export function createConversation(harness: string, opts?: { id?: string; title?: string; targetHostId?: string; profileId?: string; sessionId?: string; cwd?: string }): Conversation {
  const endpointAddress = store.get().settings?.address;
  const scopedId = opts?.id ? `${opts.id}:endpoint:${encodeURIComponent(endpointAddress ?? "")}` : undefined;
  if (opts?.id) {
    const existing = store.get().conversations.find(c => (c.id === opts.id || c.id === scopedId) && c.endpointAddress === endpointAddress);
    if (existing) {
      setActive(existing.id);
      return existing;
    }
  }
  const now = Date.now();
  const conversation: Conversation = {
    id: opts?.id && store.get().conversations.some(c => c.id === opts.id) ? scopedId! : opts?.id ?? newId(),
    endpointAddress,
    harness,
    title: opts?.title ?? "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
    targetHostId: opts?.targetHostId,
    profileId: opts?.profileId,
    sessionId: opts?.sessionId,
    cwd: opts?.cwd,
  };
  store.set((s) => ({ ...s, conversations: [conversation, ...s.conversations], activeId: conversation.id }));
  scheduleSave();
  return conversation;
}

export function conversationTargetError(target: Pick<Conversation, "targetHostId" | "profileId" | "harness" | "sessionId" | "stale"> & { viewOnly?: boolean; endpointAddress?: string; messages?: Message[] }): string | undefined {
  if (target.viewOnly) return "View only: Dash can read this chat but cannot send to it.";
  if (target.messages && !target.endpointAddress) return "This saved chat has no verified bridge address. Keep its history and drafts; open the session again from the paired computer's Chats list, or start a new chat.";
  if (target.messages && target.endpointAddress !== store.get().settings?.address) return `This chat belongs to ${target.endpointAddress}. Select that address in Settings to resume; your history and queued drafts stay here.`;
  const { connection } = store.get();
  // A chat recorded on another computer that the paired bridge continues there (hello `routes`).
  if (target.sessionId && target.targetHostId && connection.status === "online" && connection.routes?.includes(target.targetHostId)) return undefined;
  if (target.sessionId && !target.targetHostId && !target.profileId && target.stale)
    return "This saved session has no verified host. Keep its history and drafts. Open it again from the paired computer's Chats list, or start a new chat.";
  if (target.stale) return "This chat has ended on the host. Its saved history is still on this phone.";
  if (!target.targetHostId) return undefined;
  const host = connection.hosts.find((h) => h.id === target.targetHostId);
  if (!host || !host.online) return "This target host is unavailable. Reconnect to that computer.";
  if (!host.self) return `The paired bridge cannot route to remote host ${host.name}. Pair with that computer to chat.`;
  const agent = host.agents.find((a) => a.id === target.profileId);
  if (!agent && !target.stale && resumableWithoutRoster(target, connection.hosts)) {
    // Opened from the paged list: resumes by session id; the hello head lists only the newest chats.
    return connection.harnesses.some((h) => h.id === target.harness && h.available) ? undefined : "This harness is unavailable on the paired computer.";
  }
  if (!agent || agent.status === "offline") return "This agent is unavailable. Refresh the roster before trying again.";
  if (chatKind(agent) !== target.harness || (agent.sessionId && target.sessionId && agent.sessionId !== target.sessionId)) return "This agent session has changed. Select it again from the roster.";
  if (!connection.harnesses.some((h) => h.id === target.harness && h.available)) return "This harness is unavailable on the paired computer.";
  if (agent.kind === "a2a" && !target.sessionId) return "This bridge cannot target an individual A2A profile. Open a live session instead.";
  if (agent.id.startsWith("hermes:") && agent.id !== "hermes:default" && !target.sessionId) return "This bridge cannot target this Hermes profile. Open a live session instead.";
  return undefined;
}

export function openAgentConversation(profile: AgentTarget): { conversation: Conversation } | { error: string } {
  if (!profile.online) return { error: "This agent is offline." };
  const error = conversationTargetError(profile);
  if (error) return { error };
  if (!profile.targetHostId || !profile.profileId) return { error: "This agent has no target identity. Refresh the roster." };
  const existing = store.get().conversations.find(c => c.endpointAddress === store.get().settings?.address && c.harness === profile.harness && c.targetHostId === profile.targetHostId && c.profileId === profile.profileId && c.sessionId === profile.sessionId && c.cwd === profile.cwd);
  if (existing) {
    setActive(existing.id);
    return { conversation: store.get().conversations.find(c => c.id === existing.id) ?? existing };
  }
  const conversation = createConversation(profile.harness, { title: profile.name, targetHostId: profile.targetHostId, profileId: profile.profileId, sessionId: profile.sessionId, cwd: profile.cwd });
  if (conversation.sessionId) setActive(conversation.id);
  // setActive may have stamped `openedAt`: hand back the stored conversation.
  return { conversation: store.get().conversations.find(c => c.id === conversation.id) ?? conversation };
}

export function clearEndedConversations(): void {
  const ended = store.get().conversations.filter(c => c.stale);
  const ids = ended.map(c => c.id);
  for (const chat of ended) for (const message of chat.messages) releaseReply(message);
  store.set(s => ({ ...s, conversations: s.conversations.filter(c => !c.stale), activeId: ids.includes(s.activeId ?? "") ? null : s.activeId }));
  scheduleSave();
}

export function deleteConversation(id: string): void {
  for (const message of store.get().conversations.find(c => c.id === id)?.messages ?? []) releaseReply(message);
  store.set((s) => ({
    ...s,
    conversations: s.conversations.filter((c) => c.id !== id),
    activeId: s.activeId === id ? null : s.activeId,
  }));
  scheduleSave();
}

export function setConversationHarness(id: string, harness: string): void {
  updateConversation(id, (c) => ({ ...c, harness }));
}

export function setThinkingSummaries(id: string, enabled: boolean): void {
  updateConversation(id, c => ({ ...c, summariesEnabled: enabled }));
}

function updateConversation(id: string, fn: (c: Conversation) => Conversation): void {
  store.set((s) => {
    const index = s.conversations.findIndex((c) => c.id === id);
    const current = s.conversations[index];
    if (!current) return s;
    const next = fn(current);
    if (next === current) return s;
    const conversations = s.conversations.slice();
    conversations[index] = next;
    return { ...s, conversations };
  });
  scheduleSave();
}

function updateMessage(
  conversationId: string,
  messageId: string,
  fn: (m: AssistantMessage) => AssistantMessage,
): void {
  updateConversation(conversationId, (c) => {
    const index = c.messages.findIndex((m) => m.id === messageId);
    const current = c.messages[index];
    if (!current || current.role !== "assistant") return c;
    const next = fn(current);
    if (next === current) return c;
    const messages = c.messages.slice();
    messages[index] = next;
    return { ...c, messages, updatedAt: Date.now() };
  });
}

/** Append the user message and an assistant placeholder. Returns the turn id. */
export function beginTurn(
  conversationId: string,
  text: string,
  opts?: { pending?: boolean; attachments?: ChatAttachment[]; mode?: "steer" | "queue" },
): { turnId: string; messageId: string } {
  const turnId = newId();
  const messageId = newId();
  const now = Date.now();
  const user: Message = { id: newId(), role: "user", text, at: now, delivery: opts?.mode === "steer" ? "steering" : opts?.pending ? "queued" : undefined, ...(opts?.attachments?.length ? { attachments: opts.attachments } : {}) };
  const assistant: AssistantMessage = {
    id: messageId,
    role: "assistant",
    text: "",
    at: now,
    state: opts?.pending ? "pending" : "streaming",
    turnId,
    seq: 0,
  };
  updateConversation(conversationId, (c) => ({
    ...c,
    title: c.messages.length === 0 && !c.sessionId ? titleFrom(text || opts?.attachments?.[0]?.name || "") : c.title,
    messages: [...c.messages, user, assistant],
    queuePreview: opts?.pending && c.queuePreview !== undefined ? `${c.queuePreview}\n\n${text}` : c.queuePreview,
    updatedAt: now,
  }));
  // Move to top of the list.
  store.set((s) => {
    const index = s.conversations.findIndex((c) => c.id === conversationId);
    if (index <= 0) return s;
    const conversations = s.conversations.slice();
    const [moved] = conversations.splice(index, 1);
    if (moved) conversations.unshift(moved);
    return { ...s, conversations };
  });
  return { turnId, messageId };
}

/** Where a turn's events should land. */
export function locateTurn(turnId: string): { conversationId: string; messageId: string } | null {
  for (const c of store.get().conversations) {
    for (const m of c.messages) {
      if (m.role === "assistant" && m.turnId === turnId) return { conversationId: c.id, messageId: m.id };
    }
  }
  return null;
}

export function rejectUnavailableTurn(turnId: string): boolean {
  const where = locateTurn(turnId);
  const c = store.get().conversations.find((item) => item.id === where?.conversationId);
  if (!c) return false;
  const error = conversationTargetError(c);
  if (!error) return false;
  const m = c.messages.find((item) => item.id === where?.messageId);
  if (m?.role !== "assistant") return false;
  applyTurnEvent({ type: "error", id: turnId, seq: Math.max(m.seq, liveSequences.get(turnId) ?? 0) + 1, message: error });
  return true;
}

/** All turns still marked streaming (candidates for re-attach after reconnect). */
export function streamingTurns(): { id: string; seq: number }[] {
  const out: { id: string; seq: number }[] = [];
  for (const c of store.get().conversations) {
    if (!c.endpointAddress || c.endpointAddress !== store.get().settings?.address) continue;
    for (const m of c.messages) {
      if (m.role === "assistant" && m.state === "streaming") out.push({ id: m.turnId, seq: Math.max(m.seq, liveSequences.get(m.turnId) ?? 0) });
    }
  }
  return out;
}

/** Reject stale frames against the applied watermark before coalescing their text. */
export function applyDeltas(batch: ReadonlyMap<string, readonly { text: string; seq: number }[]>): void {
  for (const [turnId, deltas] of batch) {
    const where = locateTurn(turnId);
    if (!where) continue;
    const message = store.get().conversations.find((c) => c.id === where.conversationId)?.messages.find((m) => m.id === where.messageId);
    if (message?.role !== "assistant" || message.state !== "streaming") continue;
    const applied = Math.max(message.seq, liveSequences.get(turnId) ?? 0);
    let seq = applied;
    let text = "";
    for (const delta of deltas) {
      if (delta.seq <= seq) continue;
      text += delta.text;
      seq = delta.seq;
    }
    if (seq === applied) continue;
    if (!replyText.get(turnId) && message.text) replyText.set(turnId, message.text);
    replyText.append(turnId, text);
    liveSequences.set(turnId, seq);
  }
}


/** Fill the user bubble with what the laptop heard for a spoken turn. */
export function applyTranscript(turnId: string, text: string): void {
  const where = locateTurn(turnId);
  if (!where) return;
  updateConversation(where.conversationId, (c) => {
    const index = c.messages.findIndex((m) => m.id === where.messageId);
    const assistant = c.messages[index];
    const user = index > 0 ? c.messages[index - 1] : undefined;
    if (!assistant || assistant.role !== "assistant" || user?.role !== "user") return c;
    const messages = c.messages.slice();
    messages[index - 1] = { ...user, text };
    const userTurns = c.messages.filter((m) => m.role === "user").length;
    return {
      ...c,
      title: userTurns <= 1 && !c.sessionId ? titleFrom(text) : c.title,
      messages,
      updatedAt: Date.now(),
    };
  });
}

export function applyTurnEvent(
  event: Exclude<TurnEvent, { type: "delta" } | { type: "transcript" }>,
): void {
  const where = locateTurn(event.id);
  if (!where) return;
  switch (event.type) {
    case "session":
      updateConversation(where.conversationId, c => {
        const { connection, settings } = store.get();
        const host = rosterHostId(event.hostId, connection);
        const native = event.transport === "api" || event.profileId?.startsWith("hermes:session:");
        // The unscoped ACP request ran on the paired bridge. Its confirmed self host,
        // not a live process lease, owns continuation after the executor exits.
        const selfHost = connection.hosts.find(candidate => candidate.self && candidate.id === host);
        const genericProfile = selfHost?.agents.find(agent => agent.id === `harness:${c.harness}` && agent.kind === c.harness);
        const paired = !c.targetHostId && !c.profileId && c.endpointAddress === settings?.address &&
          event.harnessId === c.harness && (event.transport === "acp" || event.transport === "legacy") &&
          selfHost !== undefined && (isCatalogHarness(c.harness) || event.transport === "acp" && genericProfile !== undefined);
        return { ...c, sessionId: event.sessionId,
          ...(native ? { profileId: event.profileId ?? c.profileId, targetHostId: host ?? c.targetHostId, stale: false }
            : paired ? { targetHostId: host, ...(!isCatalogHarness(c.harness) ? { profileId: genericProfile!.id } : {}), stale: false } : {}) };
      });
      updateMessage(where.conversationId, where.messageId, (m) => (event.seq <= m.seq ? m : { ...m, seq: event.seq }));
      return;
    case "status":
      if (event.delivery) {
        const delivery = event.delivery;
        updateConversation(where.conversationId, c => {
          const index = c.messages.findIndex(m => m.id === where.messageId);
          const assistant = c.messages[index];
          if (assistant?.role !== "assistant" || event.seq <= assistant.seq || assistant.state !== "streaming") return c;
          return { ...c, messages: c.messages.map((m, i) => i === index - 1 && m.role === "user" ? { ...m, delivery, deliveryAt: event.deliveryAt ?? Date.now(), deliveryNote: event.text } : i === index && m.role === "assistant" ? { ...m, delivery, seq: event.seq, status: event.text } : m) };
        });
        return;
      }
      if (event.part) {
        const message = store.get().conversations.find(c => c.id === where.conversationId)?.messages.find(m => m.id === where.messageId);
        if (message?.role !== "assistant") return;
        if (event.part.kind !== "tool_detail" && (message.state !== "streaming" || event.seq <= Math.max(message.seq, liveSequences.get(event.id) ?? 0))) return;
        if (!replyParts.get(event.id) && message.parts) replyParts.set(event.id, JSON.stringify(message.parts));
        appendReplyPart(event.id, event.part);
        scheduleSave();
        if (event.part.kind !== "tool_detail") liveSequences.set(event.id, event.seq);
        return;
      }
      if (event.summary) {
        const current = store.get().conversations.find(c => c.id === where.conversationId)?.messages.find(m => m.id === where.messageId);
        if (current?.role !== "assistant" || event.seq <= current.seq) return;
        const summary = event.summary;
        replySummaries.set(`${event.id}:${summary.kind === "turn" ? "turn" : summary.blockId}`, JSON.stringify(summary));
        updateMessage(where.conversationId, where.messageId, m => event.seq <= m.seq ? m : ({ ...m, seq: event.seq, summaries: [...(m.summaries ?? []).filter(item => item.blockId !== summary.blockId), summary].slice(-64) }));
        return;
      }
      updateMessage(where.conversationId, where.messageId, (m) =>
        event.seq <= m.seq || m.state !== "streaming" ? m : { ...m, status: event.text, activity: event.handoff ? m.activity : appendActivity(m.activity, event.text), seq: event.seq, handoff: event.handoff?.state },
      );
      return;
    case "done": {
      let checkpointed = false;
      updateMessage(where.conversationId, where.messageId, (m) => {
        if (event.seq <= m.seq || m.state === "interrupted") return m;
        checkpointed = true;
        const text = replyText.get(event.id) || m.text;
        const error = m.error ?? (event.exitCode !== 0 ? `Process exited with code ${event.exitCode}` : text || m.delivery === "steered" ? undefined : "No response");
        return { ...m, text, parts: partsFor(event.id).length ? partsFor(event.id) : m.parts, state: error ? "error" : "done", endedAt: m.endedAt ?? Date.now(), error, status: undefined, handoff: undefined, seq: event.seq };
      });
      notifyTurnSettled(where.conversationId);
      if (checkpointed) releaseSettledReply(where.conversationId, where.messageId);
      if (checkpointed) saveSettledReply();
      return;
    }
    case "error": {
      let checkpointed = false;
      updateConversation(where.conversationId, c => {
        const index = c.messages.findIndex(m => m.id === where.messageId);
        return { ...c, messages: c.messages.map((m, i) => i === index - 1 && m.role === "user" && m.delivery ? { ...m, delivery: "failed", deliveryNote: event.message } : m) };
      });
      updateMessage(where.conversationId, where.messageId, (m) => {
        if (m.state === "interrupted") return m;
        checkpointed = true;
        return {
        ...m,
        parts: partsFor(event.id).length ? partsFor(event.id) : m.parts,
        text: replyText.get(event.id) || m.text,
        state: "error",
        endedAt: m.endedAt ?? Date.now(),
        error: event.message,
        status: undefined,
        handoff: undefined,
        seq: Math.max(m.seq, event.seq),
        };
      });
      notifyTurnSettled(where.conversationId);
      if (checkpointed) releaseSettledReply(where.conversationId, where.messageId);
      return;
    }
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}



/** Start a queued turn: pending → streaming, ready for the bridge. */
export function promotePendingTurn(turnId: string): { text: string; harness: string; sessionId?: string; attachments?: ChatAttachment[] } | null {
  const where = locateTurn(turnId);
  if (!where) return null;
  const conv = store.get().conversations.find((c) => c.id === where.conversationId);
  if (!conv) return null;
  const index = conv.messages.findIndex((m) => m.id === where.messageId);
  const assistant = conv.messages[index];
  const user = index > 0 ? conv.messages[index - 1] : undefined;
  if (assistant?.role !== "assistant" || assistant.state !== "pending" || user?.role !== "user") return null;
  updateMessage(where.conversationId, where.messageId, (m) =>
    m.state === "pending" ? { ...m, state: "streaming" } : m,
  );
  updateConversation(where.conversationId, c => ({ ...c, messages: c.messages.map(m => m.id === user.id && m.role === "user" && m.delivery === "queued" ? { ...m, delivery: "started" } : m) }));
  return { text: user.text, harness: conv.harness, sessionId: conv.sessionId, ...(user.attachments?.length ? { attachments: user.attachments } : {}) };
}

export function conversationBusy(conversationId: string): boolean {
  const conv = store.get().conversations.find((c) => c.id === conversationId);
  if (!conv) return false;
  return conv.messages.some(
    (m) => m.role === "assistant" && (m.state === "streaming" || m.state === "pending"),
  );
}

export function stopConversation(conversationId: string, cancel: (turnId: string) => void): void {
  const running: string[] = [];
  const stopped: AssistantMessage[] = [];
  const stoppedAt = Date.now();
  updateConversation(conversationId, (c) => {
    const messages = c.messages.map<Message>((m) => {
      if (m.role !== "assistant" || (m.state !== "streaming" && m.state !== "pending")) return m;
      if (m.state === "streaming") running.push(m.turnId);
      stopped.push(m);
      liveSequences.delete(m.turnId);
      return { ...m, parts: partsFor(m.turnId).length ? partsFor(m.turnId) : m.parts, text: replyText.get(m.turnId) || m.text, state: "interrupted", endedAt: stoppedAt, status: "Stopped" };
    });
    return {
      ...c,
      queuePreview: undefined,
      queueWaitForIdle: false,
      messages,
      updatedAt: stopped.length > 0 ? stoppedAt : c.updatedAt,
    };
  });
  while (dequeue(conversationId)) { /* Drain canceled turns before settlement listeners run. */ }
  for (const turnId of running) cancel(turnId);
  notifyTurnSettled(conversationId);
  for (const message of stopped) releaseReply(message);
}

/** The bridge no longer has this turn (it restarted). Keep whatever text arrived. */
export function markTurnLost(turnId: string): void {
  const where = locateTurn(turnId);
  if (!where) return;
  let checkpointed = false;
  updateMessage(where.conversationId, where.messageId, (m) => {
    if (m.state !== "streaming") return m;
    checkpointed = true;
    return { ...m, parts: partsFor(turnId).length ? partsFor(turnId) : m.parts, text: replyText.get(turnId) || m.text, state: "interrupted", endedAt: Date.now(), status: undefined };
  });
  notifyTurnSettled(where.conversationId);
  if (checkpointed) releaseSettledReply(where.conversationId, where.messageId);
}

/** Socket was down: keep the user text and retry after hello. */
export function parkUnsentTurn(turnId: string): boolean {
  const where = locateTurn(turnId);
  if (!where) return false;
  const message = store.get().conversations.find((c) => c.id === where.conversationId)?.messages.find((m) => m.id === where.messageId);
  if (message?.role !== "assistant" || message.state !== "streaming") return false;
  // A bridge delivery receipt (started/queued/steered) proves the host already has
  // this turn; requeueing it locally would send the same prompt twice.
  if (message.delivery) return false;
  updateMessage(where.conversationId, where.messageId, parkMessage);
  enqueue(where.conversationId, turnId);
  return true;
}

export type ChatSender = (input: {
  turnId: string;
  harness: string;
  text: string;
  sessionId?: string;
  cwd?: string;
  attachments?: ChatAttachment[];
}) => boolean;

/** Queue operations mutate persisted message pairs, not a second volatile FIFO. */
export function setQueueWaiting(id: string, waiting: boolean): void {
  updateConversation(id, c => ({ ...c, queueWaitForIdle: waiting }));
}

export function setDeliverQueuedAsOne(id: string, enabled: boolean): void {
  updateConversation(id, c => ({ ...c, deliverQueuedAsOne: enabled }));
}

export function editQueued(id: string, turnId: string, text: string): void {
  updateConversation(id, c => {
    const part = queuedParts(c).find(item => item.assistant.turnId === turnId);
    if (!part) return c;
    return { ...c, messages: c.messages.map(m => m.id === part.user.id ? { ...part.user, text } : m) };
  });
}

export function removeQueued(id: string, turnId?: string): void {
  updateConversation(id, c => {
    const removed = new Set(queuedParts(c).filter(part => turnId === undefined || part.assistant.turnId === turnId).flatMap(part => [part.user.id, part.assistant.id]));
    return { ...c, queuePreview: undefined, queueWaitForIdle: turnId === undefined ? false : c.queueWaitForIdle, messages: c.messages.filter(m => !removed.has(m.id)) };
  });
}

export function moveQueued(id: string, from: number, to: number): void {
  updateConversation(id, c => reorderQueued(c, from, to));
}

export function previewQueued(id: string): void {
  updateConversation(id, c => queuedParts(c).length && !queueMergeError(c) ? { ...c, queuePreview: mergedQueue(queuedParts(c)) } : c);
}

export function changeQueuePreview(id: string, text: string): void {
  updateConversation(id, c => c.queuePreview === undefined ? c : { ...c, queuePreview: text });
}

export function cancelQueuePreview(id: string): void {
  updateConversation(id, c => ({ ...c, queuePreview: undefined }));
  notifyTurnSettled(id);
}

export function saveQueuePreview(id: string): void {
  updateConversation(id, c => c.queuePreview?.trim() && !queueMergeError(c) ? combineQueued(c, c.queuePreview.trim()) : c);
  notifyTurnSettled(id);
}

/** Claim all parts synchronously before transport; refusal stays visible, never auto-retries. */
export function takeQueuedForSteer(id: string): { text: string; attachments: ChatAttachment[] } | undefined {
  const c = store.get().conversations.find(item => item.id === id);
  if (!c || queueMergeError(c) || c.queuePreview !== undefined) return undefined;
  const parts = queuedParts(c);
  if (!parts.length) return undefined;
  const payload = { text: mergedQueue(parts), attachments: parts.flatMap(part => part.user.attachments ?? []) };
  removeQueued(id);
  return payload;
}

/** After reconnect or settlement, deliver one batch per idle conversation. */
export function flushPendingSends(send: ChatSender): number {
  let sent = 0;
  for (const snapshot of store.get().conversations) {
    if (!snapshot.endpointAddress || snapshot.endpointAddress !== store.get().settings?.address) continue;
    if (snapshot.queueWaitForIdle || snapshot.queuePreview !== undefined || !nextPendingSend(snapshot)) continue;
    if (snapshot.deliverQueuedAsOne !== false && queueMergeError(snapshot)) continue;
    if (snapshot.deliverQueuedAsOne !== false) updateConversation(snapshot.id, combineQueued);
    const conv = store.get().conversations.find(c => c.id === snapshot.id);
    if (!conv) continue;
    const pending = nextPendingSend(conv);
    if (!pending) continue;
    while (dequeue(conv.id)) { /* Legacy queue ids are superseded by persisted pairs. */ }
    const payload = promotePendingTurn(pending.turnId);
    if (!payload) continue;
    const ok = send({
      turnId: pending.turnId,
      harness: payload.harness,
      text: payload.text,
      sessionId: conv.sessionId ?? payload.sessionId,
      cwd: conv.cwd,
      attachments: payload.attachments,
    });
    if (!ok) {
      parkUnsentTurn(pending.turnId);
      continue;
    }
    sent += 1;
  }
  return sent;
}
