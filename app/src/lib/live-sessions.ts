import type { AgentInfo, HistoryMessage, HostInfo } from "../../../shared/protocol";
import { isCatalogHarness } from "../../../shared/catalog";
import type { Conversation, Message } from "../model";

export function liveConversationId(harness: string, sessionId: string): string {
  return `live:${harness}:${sessionId}`;
}

export function liveSessionTitle(agent: Pick<AgentInfo, "name" | "cwd">): string {
  const cwd = agent.cwd?.trim();
  if (cwd) {
    const parts = cwd.split("/").filter((p) => p.length > 0);
    return parts[parts.length - 1] ?? cwd;
  }
  return agent.name;
}

export function conversationPreview(c: Conversation): string {
  const last = c.messages[c.messages.length - 1];
  if (!last) {
    if (c.cwd) return c.cwd;
    if (c.sessionId) return c.title;
    return "Empty chat";
  }
  if (last.role === "assistant") {
    const t = last.text.replace(/\s+/g, " ").trim();
    return last.status ? last.status : t || "Thinking…";
  }
  return last.text.replace(/\s+/g, " ").trim();
}

export function findLiveConversation(
  conversations: Conversation[],
  agent: { harness: string; sessionId?: string },
): Conversation | undefined {
  const sessionId = agent.sessionId?.trim();
  if (!sessionId) return undefined;
  return conversations.find((c) => c.harness === agent.harness && c.sessionId === sessionId);
}

/** Merge self-host live catalog sessions into Chats. Idempotent on sessionId. */
export function mergeLiveConversations(
  existing: Conversation[],
  hosts: HostInfo[],
  now: number,
): Conversation[] {
  const adopted: Conversation[] = [];
  const seen = new Set<string>();
  for (const c of existing) {
    if (c.sessionId) seen.add(`${c.harness}:${c.sessionId}`);
  }
  for (const host of hosts) {
    if (!host.self) continue;
    for (const agent of host.agents) {
      if (agent.status !== "running") continue;
      if (!isCatalogHarness(agent.kind)) continue;
      const sessionId = agent.sessionId?.trim();
      if (!sessionId) continue;
      const key = `${agent.kind}:${sessionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      adopted.push({
        id: liveConversationId(agent.kind, sessionId),
        harness: agent.kind,
        title: liveSessionTitle(agent),
        createdAt: now,
        updatedAt: now,
        sessionId,
        cwd: agent.cwd,
        messages: [],
      });
    }
  }
  if (adopted.length === 0) return existing;
  return [...adopted, ...existing];
}

export function shouldRequestHistory(c: Conversation | undefined): boolean {
  if (!c?.sessionId?.trim()) return false;
  if (!isCatalogHarness(c.harness)) return false;
  if (c.messages.length > 0) return false;
  return true;
}

export function hydrateLiveConversation(conversation: Conversation, history: HistoryMessage[]): Conversation {
  if (
    conversation.messages.some(
      (m) => m.role === "assistant" && (m.state === "streaming" || m.state === "pending"),
    )
  ) {
    return conversation;
  }
  if (conversation.messages.length > 0) return conversation;
  const messages = historyToMessages(history);
  if (messages.length === 0) return conversation;
  const last = messages[messages.length - 1];
  return {
    ...conversation,
    messages,
    updatedAt: last ? last.at : conversation.updatedAt,
  };
}

function historyToMessages(history: HistoryMessage[]): Message[] {
  const out: Message[] = [];
  for (const h of history) {
    if (h.role === "user") {
      out.push({ id: h.id, role: "user", text: h.text, at: h.at });
      continue;
    }
    out.push({
      id: h.id,
      role: "assistant",
      text: h.text,
      at: h.at,
      state: "done",
      turnId: h.id,
      seq: 0,
    });
  }
  return out;
}
