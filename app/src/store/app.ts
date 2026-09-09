import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TurnEvent } from "../../../shared/protocol";
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
import { createStore } from "./createStore";
import { notifyTurnSettled } from "./queue";

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
  connection: { status: "idle", harnesses: [] },
  conversations: [],
  activeId: null,
});

// ---- persistence -----------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleSave(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = undefined;
    const { conversations, activeId } = store.get();
    void AsyncStorage.multiSet([
      [KEYS.conversations, JSON.stringify(conversations)],
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
  store.set((s) => ({ ...s, connection: { ...s.connection, ...patch } }));
}

export async function forgetEverything(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.settings, KEYS.conversations, KEYS.activeId]);
  store.set((s) => ({
    ...s,
    settings: null,
    conversations: [],
    activeId: null,
    connection: { status: "idle", harnesses: [] },
  }));
}

// ---- conversations ---------------------------------------------------------

export function setActive(id: string | null): void {
  store.set((s) => ({ ...s, activeId: id }));
  scheduleSave();
}

export function createConversation(harness: string): Conversation {
  const now = Date.now();
  const conversation: Conversation = {
    id: newId(),
    harness,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  store.set((s) => ({ ...s, conversations: [conversation, ...s.conversations], activeId: conversation.id }));
  scheduleSave();
  return conversation;
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
  opts?: { pending?: boolean },
): { turnId: string; messageId: string } {
  const turnId = newId();
  const messageId = newId();
  const now = Date.now();
  const user: Message = { id: newId(), role: "user", text, at: now };
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
    title: c.messages.length === 0 ? titleFrom(text) : c.title,
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

/** All turns still marked streaming (candidates for re-attach after reconnect). */
export function streamingTurns(): { id: string; seq: number }[] {
  const out: { id: string; seq: number }[] = [];
  for (const c of store.get().conversations) {
    for (const m of c.messages) {
      if (m.role === "assistant" && m.state === "streaming") out.push({ id: m.turnId, seq: m.seq });
    }
  }
  return out;
}

/** Apply a batch of coalesced deltas: turnId -> appended text and last seq. */
export function applyDeltas(batch: Map<string, { text: string; seq: number }>): void {
  for (const [turnId, { text, seq }] of batch) {
    const where = locateTurn(turnId);
    if (!where) continue;
    updateMessage(where.conversationId, where.messageId, (m) =>
      seq <= m.seq ? m : { ...m, text: m.text + text, seq, status: undefined },
    );
  }
}

export function applyTurnEvent(event: Exclude<TurnEvent, { type: "delta" }>): void {
  const where = locateTurn(event.id);
  if (!where) return;
  switch (event.type) {
    case "session":
      updateConversation(where.conversationId, (c) => ({ ...c, sessionId: event.sessionId }));
      updateMessage(where.conversationId, where.messageId, (m) => (event.seq <= m.seq ? m : { ...m, seq: event.seq }));
      return;
    case "status":
      updateMessage(where.conversationId, where.messageId, (m) =>
        event.seq <= m.seq ? m : { ...m, status: event.text, seq: event.seq },
      );
      return;
    case "done":
      updateMessage(where.conversationId, where.messageId, (m) => ({
        ...m,
        state: m.text ? "done" : "error",
        error: m.text ? undefined : "No response",
        status: undefined,
        seq: Math.max(m.seq, event.seq),
      }));
      notifyTurnSettled(where.conversationId);
      return;
    case "error":
      updateMessage(where.conversationId, where.messageId, (m) => ({
        ...m,
        state: "error",
        error: event.message,
        status: undefined,
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
export function promotePendingTurn(turnId: string): { text: string; harness: string; sessionId?: string } | null {
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
  return { text: user.text, harness: conv.harness, sessionId: conv.sessionId };
}

export function conversationBusy(conversationId: string): boolean {
  const conv = store.get().conversations.find((c) => c.id === conversationId);
  if (!conv) return false;
  return conv.messages.some(
    (m) => m.role === "assistant" && (m.state === "streaming" || m.state === "pending"),
  );
}

/** The bridge no longer has this turn (it restarted). Keep whatever text arrived. */
export function markTurnLost(turnId: string): void {
  const where = locateTurn(turnId);
  if (!where) return;
  updateMessage(where.conversationId, where.messageId, (m) =>
    m.state === "streaming" ? { ...m, state: "interrupted", status: undefined } : m,
  );
  notifyTurnSettled(where.conversationId);
}
