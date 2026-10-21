import AsyncStorage from "@react-native-async-storage/async-storage";
import { hostDisplayName } from "../../../shared/host-display";
import { appendReplyPart, partsFor, replyParts } from "./text";
import type { DetailMode } from "../lib/reply-details";
import type { ChatAttachment, HistoryMessage, TurnEvent } from "../../../shared/protocol";
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
import { hydrateLiveConversation, mergeLiveConversations, shouldRequestHistory } from "../lib/live-sessions";
import { createStore } from "./createStore";
import { dequeue, enqueue, notifyTurnSettled } from "./queue";
import { nextPendingSend, parkMessage } from "./offline-send";
import { replyText, replySummaries } from "./text";
import { appendActivity } from "../lib/message-details";
import type { AgentTarget } from "../mock/agents";
import { chatKind } from "../lib/roster";

const liveSequences = new Map<string, number>();

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

function scheduleSave(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    const { conversations, activeId } = store.get();
    const snapshots = conversations.map((c) => ({ ...c, messages: c.messages.map((m) =>
      m.role === "assistant" && m.state === "streaming"
        ? { ...m, parts: partsFor(m.turnId).length ? partsFor(m.turnId) : m.parts, text: replyText.get(m.turnId) || m.text, seq: Math.max(m.seq, liveSequences.get(m.turnId) ?? 0) }
        : m,
    ) }));
    void AsyncStorage.multiSet([
      [KEYS.conversations, JSON.stringify(snapshots)],
      [KEYS.activeId, activeId ?? ""],
    ]);
  }, 400);
}

export async function hydrate(): Promise<void> {
  const entries = await AsyncStorage.multiGet([KEYS.settings, KEYS.conversations, KEYS.activeId]);
  const byKey = new Map(entries);
  const settings = parseSettings(safeJson(byKey.get(KEYS.settings)));
  const rawConversations = safeJson(byKey.get(KEYS.conversations));
  const conversations: Conversation[] = [];
  if (Array.isArray(rawConversations)) {
    for (const raw of rawConversations) {
      const c = parseConversation(raw);
      if (c) conversations.push(c);
    }
  }
  const activeId = byKey.get(KEYS.activeId) || null;
  for (const c of conversations) for (const m of c.messages) {
    if (m.role === "assistant" && m.state === "streaming") replyText.set(m.turnId, m.text);
  }
  store.set((s) => ({
    ...s,
    hydrated: true,
    settings,
    conversations,
    activeId: conversations.some((c) => c.id === activeId) ? activeId : null,
  }));
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
  store.set((s) => ({ ...s, settings }));
  void AsyncStorage.setItem(KEYS.settings, JSON.stringify(settings));
}

export function setConnection(patch: Partial<Connection>): void {
  store.set((s) => {
    const connection = { ...s.connection, ...patch, hosts: patch.hosts?.map(host => ({ ...host, name: hostDisplayName(host) })) ?? s.connection.hosts };
    if (patch.hosts === undefined) return { ...s, connection };
    const conversations = mergeLiveConversations(s.conversations, connection.hosts, Date.now());
    return conversations === s.conversations ? { ...s, connection } : { ...s, connection, conversations };
  });
  if (patch.hosts !== undefined) scheduleSave();
}

export async function forgetEverything(): Promise<void> {
  const enrollment = store.get().settings?.identity;
  if (enrollment) {
    const { setSecret } = await import("../lib/secure");
    const { identitySecretKey } = await import("../lib/identity-client");
    await setSecret(identitySecretKey(enrollment.credentialId), "");
    const { clearIdentityTokens } = await import("../lib/bridge-auth");
    clearIdentityTokens();
  }
  await AsyncStorage.multiRemove([KEYS.settings, KEYS.conversations, KEYS.activeId]);
  store.set((s) => ({
    ...s,
    settings: null,
    conversations: [],
    activeId: null,
    connection: { status: "idle", harnesses: [], hosts: [] },
  }));
}

// ---- conversations ---------------------------------------------------------

type LiveHistoryRequest = (input: { harness: string; sessionId: string; cwd?: string; hostId?: string; profileId?: string }) => void;
let requestLiveHistory: LiveHistoryRequest | undefined;

export function setLiveHistoryRequester(fn: LiveHistoryRequest | undefined): void {
  requestLiveHistory = fn;
}

/**
 * The roster id for a host id a bridge reported. An older bridge names itself by OS hostname
 * ("groot") while the roster keys the same computer by its MagicDNS label ("0").
 */
export function rosterHostId(hostId: string | undefined, connection: Pick<Connection, "hosts" | "host">): string | undefined {
  if (!hostId || connection.hosts.some(h => h.id === hostId)) return hostId;
  const self = connection.hosts.find(h => h.self);
  if (self && (self.hostname === hostId || self.name === hostId || connection.host === hostId)) return self.id;
  return hostId;
}

export function applyLiveHistory(harness: string, sessionId: string, messages: HistoryMessage[], hostId?: string, profileId?: string): void {
  const host = rosterHostId(hostId, store.get().connection);
  const candidates = store.get().conversations.filter(c => c.harness === harness && c.sessionId === sessionId && (!host || c.targetHostId === host) && (!profileId || c.profileId === profileId));
  const conv = candidates.length === 1 ? candidates[0] : undefined;
  if (!conv) return;
  updateConversation(conv.id, (c) => hydrateLiveConversation(c, messages));
}

export function setDetailMode(id: string, detailMode: DetailMode): void { updateConversation(id, c => ({ ...c, detailMode })); }

export function setActive(id: string | null): void {
  store.set((s) => ({ ...s, activeId: id }));
  scheduleSave();
  if (!id) return;
  const current = store.get().conversations.find((c) => c.id === id);
  if (!current || !shouldRequestHistory(current) || !current.sessionId) return;
  if (conversationTargetError(current)) return;
  requestLiveHistory?.({ harness: current.harness, sessionId: current.sessionId, cwd: current.cwd, hostId: current.targetHostId, profileId: current.profileId });
}

export function createConversation(harness: string, opts?: { id?: string; title?: string; targetHostId?: string; profileId?: string; sessionId?: string; cwd?: string }): Conversation {
  if (opts?.id) {
    const existing = store.get().conversations.find((c) => c.id === opts.id);
    if (existing) {
      setActive(existing.id);
      return existing;
    }
  }
  const now = Date.now();
  const conversation: Conversation = {
    id: opts?.id ?? newId(),
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

export function conversationTargetError(target: Pick<Conversation, "targetHostId" | "profileId" | "harness" | "sessionId" | "stale">): string | undefined {
  if (target.stale) return "This chat has ended on the host. Its saved history is still on this phone.";
  if (!target.targetHostId) return undefined;
  const { connection } = store.get();
  const host = connection.hosts.find((h) => h.id === target.targetHostId);
  if (!host || !host.online) return "This target host is unavailable. Reconnect to that computer.";
  if (!host.self) return `The paired bridge cannot route to remote host ${host.name}. Pair with that computer to chat.`;
  const agent = host.agents.find((a) => a.id === target.profileId);
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
  const existing = store.get().conversations.find((c) => c.harness === profile.harness && c.targetHostId === profile.targetHostId && c.profileId === profile.profileId && c.sessionId === profile.sessionId && c.cwd === profile.cwd);
  if (existing) {
    setActive(existing.id);
    return { conversation: existing };
  }
  const conversation = createConversation(profile.harness, { title: profile.name, targetHostId: profile.targetHostId, profileId: profile.profileId, sessionId: profile.sessionId, cwd: profile.cwd });
  if (conversation.sessionId) setActive(conversation.id);
  return { conversation };
}

export function clearEndedConversations(): void {
  const ids = store.get().conversations.filter(c => c.stale).map(c => c.id);
  store.set(s => ({ ...s, conversations: s.conversations.filter(c => !c.stale), activeId: ids.includes(s.activeId ?? "") ? null : s.activeId }));
  scheduleSave();
}

export function deleteConversation(id: string): void {
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
    for (const m of c.messages) {
      if (m.role === "assistant" && m.state === "streaming") out.push({ id: m.turnId, seq: Math.max(m.seq, liveSequences.get(m.turnId) ?? 0) });
    }
  }
  return out;
}

/** Apply a batch of coalesced deltas: turnId -> appended text and last seq. */
export function applyDeltas(batch: Map<string, { text: string; seq: number }>): void {
  for (const [turnId, { text, seq }] of batch) {
    const where = locateTurn(turnId);
    if (!where) continue;
    const message = store.get().conversations.find((c) => c.id === where.conversationId)?.messages.find((m) => m.id === where.messageId);
    if (message?.role !== "assistant" || message.state !== "streaming") continue;
    if (seq <= Math.max(message.seq, liveSequences.get(turnId) ?? 0)) continue;
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
      // Host-resolved identity: native API turns, and Hermes sessions the bridge names
      // (new ACP chats land in a host profile), so the roster row merges into this chat.
      updateConversation(where.conversationId, (c) => ({ ...c, sessionId: event.sessionId, ...(event.transport === "api" || event.profileId?.startsWith("hermes:session:") ? { profileId: event.profileId ?? c.profileId, targetHostId: rosterHostId(event.hostId, store.get().connection) ?? c.targetHostId, stale: false } : {}) }));
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
    case "done":
      updateMessage(where.conversationId, where.messageId, (m) => {
        if (event.seq <= m.seq || m.state === "interrupted") return m;
        const text = replyText.get(event.id) || m.text;
        const error = m.error ?? (event.exitCode !== 0 ? `Process exited with code ${event.exitCode}` : text || m.delivery === "steered" ? undefined : "No response");
        return { ...m, text, parts: partsFor(event.id).length ? partsFor(event.id) : m.parts, state: error ? "error" : "done", error, status: undefined, handoff: undefined, seq: event.seq };
      });
      liveSequences.delete(event.id);
      notifyTurnSettled(where.conversationId);
      return;
    case "error":
      updateConversation(where.conversationId, c => {
        const index = c.messages.findIndex(m => m.id === where.messageId);
        return { ...c, messages: c.messages.map((m, i) => i === index - 1 && m.role === "user" && m.delivery ? { ...m, delivery: "failed", deliveryNote: event.message } : m) };
      });
      updateMessage(where.conversationId, where.messageId, (m) => m.state === "interrupted" ? m : ({
        ...m,
        parts: partsFor(event.id).length ? partsFor(event.id) : m.parts,
        text: replyText.get(event.id) || m.text,
        state: "error",
        error: event.message,
        status: undefined,
        handoff: undefined,
        seq: Math.max(m.seq, event.seq),
      }));
      notifyTurnSettled(where.conversationId);
      return;
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
  updateConversation(conversationId, (c) => ({
    ...c,
    messages: c.messages.map((m) => {
      if (m.role !== "assistant" || (m.state !== "streaming" && m.state !== "pending")) return m;
      if (m.state === "streaming") running.push(m.turnId);
      liveSequences.delete(m.turnId);
      return { ...m, parts: partsFor(m.turnId).length ? partsFor(m.turnId) : m.parts, text: replyText.get(m.turnId) || m.text, state: "interrupted", status: "Stopped" };
    }),
  }));
  while (dequeue(conversationId)) { /* Drain canceled turns before settlement listeners run. */ }
  for (const turnId of running) cancel(turnId);
  notifyTurnSettled(conversationId);
}

/** The bridge no longer has this turn (it restarted). Keep whatever text arrived. */
export function markTurnLost(turnId: string): void {
  const where = locateTurn(turnId);
  if (!where) return;
  updateMessage(where.conversationId, where.messageId, (m) =>
    m.state === "streaming" ? { ...m, parts: partsFor(turnId).length ? partsFor(turnId) : m.parts, text: replyText.get(turnId) || m.text, state: "interrupted", status: undefined } : m,
  );
  notifyTurnSettled(where.conversationId);
}

/** Socket was down: keep the user text and retry after hello. */
export function parkUnsentTurn(turnId: string): boolean {
  const where = locateTurn(turnId);
  if (!where) return false;
  const message = store.get().conversations.find((c) => c.id === where.conversationId)?.messages.find((m) => m.id === where.messageId);
  if (message?.role !== "assistant" || message.state !== "streaming") return false;
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

/** After reconnect, send parked turns that never reached the laptop. */
export function flushPendingSends(send: ChatSender): number {
  let sent = 0;
  for (const conv of store.get().conversations) {
    const pending = nextPendingSend(conv);
    if (!pending) continue;
    dequeue(conv.id);
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
