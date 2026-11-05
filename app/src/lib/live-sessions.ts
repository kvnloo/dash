import type { AgentInfo, HistoryMessage, HostInfo } from "../../../shared/protocol";
import { isCatalogHarness } from "../../../shared/catalog";
import { unwrapHermesHistoryText } from "./history-display";
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
  const discovered = sessionAgents(hosts);
  // A native OMP session can be held by multiple physical panes. Keep one
  // conversation while retaining its pane's cwd until that pane disappears.
  const reported = discovered.filter(({ host, agent }) => {
    if (agent.kind !== "omp") return true;
    const panes = discovered.filter(({ host: otherHost, agent: other }) =>
      otherHost.id === host.id && other.kind === "omp" && other.sessionId === agent.sessionId);
    const owner = existing.find(c =>
      c.harness === "omp" && c.sessionId === agent.sessionId &&
      (!c.targetHostId || c.targetHostId === host.id) &&
      panes.some(({ agent: pane }) => pane.id === c.profileId));
    const paneId = owner?.profileId ?? panes.map(({ agent: pane }) => pane.id).sort()[0];
    return agent.id === paneId;
  });
  let changed = false;
  const rows = existing.map(c => {
    if (!c.sessionId) return c;
    const matches = reported.filter(({ host, agent }) => agent.kind === c.harness && agent.sessionId === c.sessionId && (!c.targetHostId || host.id === c.targetHostId) && (!c.profileId || c.profileId === agent.id));
    // When the owning OMP pane exits, rebind this same chat to the surviving
    // pane, rather than marking it ended or reusing the old working directory.
    const survivingPanes = c.harness === "omp" && c.profileId?.startsWith("omp:")
      ? reported.filter(({ host, agent }) => agent.kind === "omp" && agent.sessionId === c.sessionId && (!c.targetHostId || host.id === c.targetHostId))
      : [];
    const match = matches.length === 1 ? matches[0] : survivingPanes.length === 1 ? survivingPanes[0] : undefined;
    if (!match) {
      // A bridge-owned ACP session may be running without a native session row.
      // A uniquely identified, online local harness profile plus an in-flight
      // reply is evidence to retain this exact route, not to adopt another one.
      // Native sessions, stale rows, unknown profiles and offline hosts still
      // need an authoritative roster match.
      // Chats created without a profile route to the one paired bridge. Do
      // not invent a host/profile identity when retaining that live chat.
      const unscoped = c.targetHostId === undefined && c.profileId === undefined;
      const genericProfileId = `harness:${c.harness}`;
      const scopedHarness = c.targetHostId !== undefined && c.profileId === genericProfileId;
      const targetHosts = c.targetHostId
        ? hosts.filter(host => host.id === c.targetHostId)
        : hosts.filter(host => host.self);
      const targetHost = targetHosts.length === 1 ? targetHosts[0] : undefined;
      const profiles = targetHost?.agents.filter(agent => agent.id === genericProfileId);
      const bridgeOwnedStreaming =
        c.stale !== true &&
        isCatalogHarness(c.harness) &&
        (unscoped || scopedHarness) &&
        c.messages.some(message => message.role === "assistant" && message.state === "streaming") &&
        targetHost !== undefined && targetHost.self && targetHost.online &&
        profiles?.length === 1 &&
        profiles[0]?.kind === c.harness &&
        profiles[0]?.status !== "offline" &&
        !profiles[0]?.sessionId;
      if (bridgeOwnedStreaming) return c;
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
  const messages = historyToMessages(history, conversation.id, conversation.harness === "hermes");
  if (!messages.length) return conversation;
  return { ...conversation, messages, updatedAt: Math.max(messages.at(-1)?.at ?? 0, conversation.updatedAt) };
}
function historyToMessages(history: HistoryMessage[], conversationId: string, hermes: boolean): Message[] {
  return history.map(h => h.role === "user" ? { id: h.id, role: "user", text: hermes ? unwrapHermesHistoryText(h.text) : h.text, at: h.at } : { id: h.id, role: "assistant", text: h.text, at: h.at, state: "done", parts: h.parts, turnId: `history:${conversationId}:${h.id}`, seq: 0 });
}
