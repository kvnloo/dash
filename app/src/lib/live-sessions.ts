import type { AgentInfo, HistoryMessage, HostInfo } from "../../../shared/protocol";
import { isCatalogHarness } from "../../../shared/catalog";
import type { Conversation, Message } from "../model";

export function liveConversationId(harness: string, sessionId: string): string {
  return `live:${harness}:${sessionId}`;
}
export function liveSessionTitle(agent: Pick<AgentInfo, "name" | "cwd"> & { kind?: string }): string {
  if (agent.kind === "hermes") return agent.name;
  const cwd = agent.cwd?.trim();
  if (cwd) return cwd.split("/").filter(p => p.length > 0).at(-1) ?? cwd;
  return agent.name;
}
export function conversationPreview(c: Conversation): string {
  const last = c.messages.at(-1);
  if (!last) return c.cwd || (c.sessionId ? c.title : "Empty chat");
  if (last.role === "assistant") return last.status || last.text.replace(/\s+/g, " ").trim() || "Thinking…";
  return last.text.replace(/\s+/g, " ").trim();
}
export function findLiveConversation(conversations: Conversation[], agent: { harness: string; sessionId?: string; targetHostId?: string; profileId?: string }): Conversation | undefined {
  const sessionId = agent.sessionId?.trim();
  if (!sessionId) return undefined;
  const candidates = conversations.filter(c => c.harness === agent.harness && c.sessionId === sessionId && (!agent.profileId || !c.profileId || c.profileId === agent.profileId));
  if (agent.targetHostId) return candidates.find(c => c.targetHostId === agent.targetHostId) ?? candidates.find(c => !c.targetHostId);
  return candidates.find(c => !c.targetHostId) ?? (candidates.length === 1 ? candidates[0] : undefined);
}
function sessionAgents(hosts: HostInfo[]) {
  return hosts.flatMap(host => !host.self || !host.online ? [] : host.agents.filter(agent => agent.status !== "offline" && isCatalogHarness(agent.kind) && agent.sessionId).map(agent => ({ host, agent })));
}
/** Successful roster snapshots reconcile, never delete. Missing snapshots do not enter here. */
export function mergeLiveConversations(existing: Conversation[], hosts: HostInfo[], now: number): Conversation[] {
  const reported = sessionAgents(hosts);
  let changed = false;
  const rows = existing.map(c => {
    if (!c.sessionId) return c;
    const matches = reported.filter(({ host, agent }) => agent.kind === c.harness && agent.sessionId === c.sessionId && (!c.targetHostId || host.id === c.targetHostId) && (!c.profileId || c.profileId === agent.id));
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) {
      if (c.stale && c.openIn === undefined) return c;
      changed = true; return { ...c, stale: true, openIn: undefined };
    }
    const { host, agent } = match;
    const title = c.harness === "hermes" ? agent.name : c.title;
    const updatedAt = agent.lastActivityAt ?? c.updatedAt;
    if (c.stale === false && title === c.title && updatedAt === c.updatedAt && c.messageCount === agent.messageCount && c.targetHostId === host.id && c.profileId === agent.id && c.openIn === agent.openIn) return c;
    changed = true;
    return { ...c, stale: false, targetHostId: host.id, profileId: agent.id, profileName: agent.profileId, title, updatedAt, messageCount: agent.messageCount, cwd: agent.cwd ?? c.cwd, openIn: agent.openIn };
  });
  const adopted: Conversation[] = [];
  for (const { host, agent } of reported) {
    const sessionId = agent.sessionId;
    if (!sessionId || rows.some(c => c.harness === agent.kind && c.sessionId === sessionId && c.targetHostId === host.id && c.profileId === agent.id)) continue;
    const baseId = liveConversationId(agent.kind, sessionId);
    adopted.push({ id: agent.kind === "hermes" ? `${baseId}:${host.id}:${agent.profileId ?? agent.id}` : baseId,
      harness: agent.kind, title: liveSessionTitle(agent), createdAt: agent.lastActivityAt ?? now, updatedAt: agent.lastActivityAt ?? now,
      sessionId, cwd: agent.cwd, targetHostId: host.id, profileId: agent.id, profileName: agent.profileId, messageCount: agent.messageCount, stale: false, ...(agent.openIn ? { openIn: agent.openIn } : {}), messages: [] });
  }
  return adopted.length ? [...adopted, ...rows] : changed ? rows : existing;
}
export function shouldRequestHistory(c: Conversation | undefined): boolean {
  if (!c?.sessionId?.trim() || !isCatalogHarness(c.harness) || c.stale) return false;
  if (c.messages.some(m => m.role === "assistant" && (m.state === "streaming" || m.state === "pending"))) return false;
  return c.harness === "hermes" || c.messages.length === 0;
}
export function hydrateLiveConversation(conversation: Conversation, history: HistoryMessage[]): Conversation {
  if (conversation.messages.some(m => m.role === "assistant" && (m.state === "streaming" || m.state === "pending"))) return conversation;
  if (conversation.messages.length > 0 && conversation.harness !== "hermes") return conversation;
  const messages = historyToMessages(history, conversation.id);
  if (!messages.length) return conversation;
  return { ...conversation, messages, updatedAt: Math.max(messages.at(-1)?.at ?? 0, conversation.updatedAt) };
}
function historyToMessages(history: HistoryMessage[], conversationId: string): Message[] {
  return history.map(h => h.role === "user" ? { id: h.id, role: "user", text: h.text, at: h.at } : { id: h.id, role: "assistant", text: h.text, at: h.at, state: "done", parts: h.parts, turnId: `history:${conversationId}:${h.id}`, seq: 0 });
}
