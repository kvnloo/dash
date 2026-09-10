import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import { isCatalogHarness } from "../../../shared/catalog";
import type { Conversation } from "../model";

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
