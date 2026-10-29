import type { AgentInfo, ChatSummary, HistoryMessage, HostInfo } from "../../../shared/protocol";
import { isCatalogHarness } from "../../../shared/catalog";
import { unwrapHermesHistoryText } from "./history-display";
import { adoptableSessions } from "./remote-host-sessions";
import type { Conversation, Message } from "../model";

export function liveConversationId(harness: string, sessionId: string, remoteHostId?: string): string {
  return remoteHostId === undefined ? `live:${harness}:${sessionId}` : `live:${remoteHostId}:${harness}:${sessionId}`;
}
export function liveSessionTitle(agent: Pick<AgentInfo, "name" | "cwd"> & { kind?: string }): string {
  if (agent.kind === "hermes") return agent.name;
  const cwd = agent.cwd?.trim();
  if (cwd) return cwd.split("/").filter(p => p.length > 0).at(-1) ?? cwd;
  return agent.name;
}
export function conversationPreview(c: Conversation): string {
  const last = c.messages.at(-1);
  if (!last) return c.preview || c.cwd || (c.sessionId ? c.title : "Empty chat");
  if (last.role === "assistant") return last.status || last.text.replace(/\s+/g, " ").trim() || "Thinking…";
  return last.text.replace(/\s+/g, " ").trim();
}
/** Bucket key for harness+session lookups. Profile and host are compared inside a bucket. */
function sessionBucket(harness: string, sessionId: string): string { return `${harness}\u0000${sessionId}`; }

export function findLiveConversation(conversations: Conversation[], agent: { harness: string; sessionId?: string; targetHostId?: string; profileId?: string }): Conversation | undefined {
  const sessionId = agent.sessionId?.trim();
  if (!sessionId) return undefined;
  const candidates = conversations.filter(c => c.harness === agent.harness && c.sessionId === sessionId && (!agent.profileId || !c.profileId || c.profileId === agent.profileId));
  if (agent.targetHostId) return candidates.find(c => c.targetHostId === agent.targetHostId) ?? candidates.find(c => !c.targetHostId);
  return candidates.find(c => !c.targetHostId) ?? (candidates.length === 1 ? candidates[0] : undefined);
}

/** One keyed index over conversations for many lookups: O(C) to build, O(bucket) per lookup. */
export function liveConversationIndex(conversations: Conversation[]): (agent: { harness: string; sessionId?: string; targetHostId?: string; profileId?: string }) => Conversation | undefined {
  const buckets = new Map<string, Conversation[]>();
  for (const c of conversations) {
    if (!c.sessionId) continue;
    const key = sessionBucket(c.harness, c.sessionId);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(c); else buckets.set(key, [c]);
  }
  return agent => {
    const sessionId = agent.sessionId?.trim();
    if (!sessionId) return undefined;
    return findLiveConversation(buckets.get(sessionBucket(agent.harness, sessionId)) ?? [], { ...agent, sessionId });
  };
}

function sessionAgents(hosts: HostInfo[]) {
  return adoptableSessions(hosts, { includeRemote: true });
}

/**
 * A persisted self-host chat resumes by session id, so it needs no session roster row.
 * Non-catalog harnesses must retain their exact generic local harness route.
 * OMP live sessions (`omp:` profiles) end when the host stops listing them.
 */
/** `routes`: other computers the paired bridge carries chats to (hello `routes`). */
export function resumableWithoutRoster(c: Pick<Conversation, "harness" | "sessionId" | "targetHostId" | "profileId" | "stale" | "viewOnly">, hosts: readonly HostInfo[], routes: readonly string[] = []): boolean {
  if (!c.sessionId?.trim() || c.viewOnly || c.profileId?.startsWith("omp:")) return false;
  const self = hosts.some(host => host.self && host.id === c.targetHostId);
  if (!isCatalogHarness(c.harness)) return self && c.profileId === `harness:${c.harness}`;
  return self || (c.targetHostId !== undefined && routes.includes(c.targetHostId));
}

export interface MergeLiveOptions {
  /**
   * `all` (legacy bridges): every reported session becomes a conversation.
   * `live` (chats.v1): only running or host-held sessions do; the paged list shows the rest.
   */
  adopt?: "all" | "live";
  /** Hosts the paired bridge routes chats to (hello `routes`): their chats are resumable, not ended. */
  routes?: readonly string[];
}

/** Successful roster snapshots reconcile, never delete. Missing snapshots do not enter here. O(C + R). */
export function mergeLiveConversations(existing: Conversation[], hosts: HostInfo[], now: number, options: MergeLiveOptions = {}): Conversation[] {
  const reported = sessionAgents(hosts);
  const bySession = new Map<string, { host: HostInfo; agent: AgentInfo }[]>();
  for (const entry of reported) {
    if (!entry.agent.sessionId) continue;
    const key = sessionBucket(entry.agent.kind, entry.agent.sessionId);
    const bucket = bySession.get(key);
    if (bucket) bucket.push(entry); else bySession.set(key, [entry]);
  }
  let changed = false;
  const owned = new Set<string>();
  const rows = existing.map(c => {
    if (!c.sessionId) return c;
    const bucket = bySession.get(sessionBucket(c.harness, c.sessionId)) ?? [];
    const matches = bucket.filter(({ host, agent }) => (!c.targetHostId || host.id === c.targetHostId) && (!c.profileId || c.profileId === agent.id));
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) {
      owned.add(`${c.harness}\u0000${c.sessionId}\u0000${c.targetHostId ?? ""}\u0000${c.profileId ?? ""}`);
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
      // chats.v1 rosters list only running/host-held chats and a short head: a chat opened from the
      // paged list is simply not running, not ended. Only live-only sessions end with the roster row.
      if (options.adopt === "live" && resumableWithoutRoster(c, hosts, options.routes)) {
        // A chat marked ended before the routes arrived must come back, or it stays unsendable forever.
        if (c.openIn === undefined && c.stale !== true) return c;
        changed = true; return { ...c, stale: false, openIn: undefined };
      }
      if (c.stale && c.openIn === undefined) return c;
      changed = true; return { ...c, stale: true, openIn: undefined };
    }
    const { host, agent } = match;
    owned.add(`${c.harness}\u0000${c.sessionId}\u0000${host.id}\u0000${agent.id}`);
    const title = c.harness === "hermes" ? agent.name : c.title;
    const updatedAt = agent.lastActivityAt ?? c.updatedAt;
    if (c.stale === false && title === c.title && updatedAt === c.updatedAt && c.messageCount === agent.messageCount && c.targetHostId === host.id && c.profileId === agent.id && c.openIn === agent.openIn && (!agent.model || c.sessionModel?.model === agent.model && c.sessionModel.sessionId === agent.sessionId)) return c;
    changed = true;
    return { ...c, ...(agent.model && agent.sessionId ? { sessionModel: { sessionId: agent.sessionId, model: agent.model } } : {}), stale: false, targetHostId: host.id, profileId: agent.id, profileName: agent.profileId, title, updatedAt, messageCount: agent.messageCount, cwd: agent.cwd ?? c.cwd, openIn: agent.openIn };
  });
  const adopted: Conversation[] = [];
  for (const { host, agent } of reported) {
    const sessionId = agent.sessionId;
    if (!sessionId || owned.has(`${agent.kind}\u0000${sessionId}\u0000${host.id}\u0000${agent.id}`)) continue;
    if (options.adopt === "live" && agent.status !== "running" && !agent.openIn) continue;
    const baseId = liveConversationId(agent.kind, sessionId, host.self ? undefined : host.id);
    adopted.push({ id: agent.kind === "hermes" ? `${baseId}:${host.id}:${agent.profileId ?? agent.id}` : baseId,
      harness: agent.kind, title: liveSessionTitle(agent), createdAt: agent.lastActivityAt ?? now, updatedAt: agent.lastActivityAt ?? now,
      ...(agent.model ? { sessionModel: { sessionId, model: agent.model } } : {}),
      sessionId, cwd: agent.cwd, targetHostId: host.id, profileId: agent.id, profileName: agent.profileId, messageCount: agent.messageCount, stale: false, ...(!host.self ? { viewOnly: true } : {}), ...(agent.openIn ? { openIn: agent.openIn } : {}), messages: [] });
  }
  return adopted.length ? [...adopted, ...rows] : changed ? rows : existing;
}

/** The conversation a tapped chat summary becomes. Ids match roster adoption so both paths meet. */
export function adoptSummary(summary: ChatSummary, now: number, selfHostId?: string): Conversation {
  const baseId = liveConversationId(summary.kind, summary.sessionId, selfHostId && summary.hostId !== selfHostId ? summary.hostId : undefined);
  return {
    id: summary.kind === "hermes" ? `${baseId}:${summary.hostId}:${summary.profileId ?? summary.agentId ?? "default"}` : baseId,
    harness: summary.kind, title: summary.title || liveSessionTitle({ name: summary.kind, cwd: summary.cwd, kind: summary.kind }),
    ...(summary.model ? { sessionModel: { sessionId: summary.sessionId, model: summary.model } } : {}),
    createdAt: summary.startedAt, updatedAt: summary.lastActivityAt, sessionId: summary.sessionId,
    ...(summary.cwd ? { cwd: summary.cwd } : {}), targetHostId: summary.hostId,
    ...(summary.agentId ? { profileId: summary.agentId } : {}), ...(summary.profileId ? { profileName: summary.profileId } : {}),
    messageCount: summary.messageCount, stale: false, ...(summary.openIn ? { openIn: summary.openIn } : {}),
    openedAt: now, ...(summary.chatable ? {} : { viewOnly: true }), messages: [],
  };
}
/** Routed archive rows have no live process flag; follow them while open, even between turns. */
function isRemoteClaude(c: Conversation): boolean {
  return c.harness === "claude" && c.targetHostId?.startsWith("machine:") === true && c.profileId === `av:claude:${c.sessionId}` && !c.viewOnly;
}

export function shouldRequestHistory(c: Conversation | undefined): boolean {
  if (!c?.sessionId?.trim() || !isCatalogHarness(c.harness) || c.stale) return false;
  if (c.messages.some(m => m.role === "assistant" && (m.state === "streaming" || m.state === "pending"))) return false;
  return c.harness === "hermes" || isRemoteClaude(c) || c.messages.length === 0;
}
export function hydrateLiveConversation(conversation: Conversation, history: HistoryMessage[]): Conversation {
  if (conversation.messages.some(m => m.role === "assistant" && (m.state === "streaming" || m.state === "pending"))) return conversation;
  if (conversation.messages.length > 0 && conversation.harness !== "hermes" && !isRemoteClaude(conversation)) return conversation;
  const incoming = historyToMessages(history, conversation.id, conversation.harness === "hermes");
  if (!incoming.length) return conversation;
  const messages = reconcileHistory(conversation.messages, incoming, conversation.id);
  return { ...conversation, messages, updatedAt: Math.max(incoming.at(-1)?.at ?? 0, conversation.updatedAt) };
}

/**
 * History is an ordered window, not a deletion list. Native ids order rows already
 * seen; text matching only aligns their display with a phone turn, not its identity.
 * Consume matches in order so repeated prompts remain distinct. A partial or cut
 * native reply must not replace the phone's richer text or its stopped/error state.
 */
function reconcileHistory(existing: Message[], incoming: Message[], conversationId: string): Message[] {
  const positions = new Map(incoming.map((message, index) => [message.id, index]));
  const existingIds = new Set(existing.map(message => message.id));
  const result: Message[] = [];
  let next = 0;
  const appendUntil = (end: number) => {
    for (; next < end; next++) {
      const native = incoming[next];
      if (native && !existingIds.has(native.id)) result.push(native);
    }
  };

  for (let index = 0; index < existing.length; index++) {
    const message = existing[index];
    if (!message) continue;
    const position = positions.get(message.id);
    if (position !== undefined && position >= next) {
      appendUntil(position);
      const native = incoming[position];
      result.push(native && (!native.truncated || message.truncated) ? native : message);
      next = position + 1;
      continue;
    }

    const assistant = existing[index + 1];
    const phoneAssistant = assistant?.role === "assistant" &&
      !assistant.turnId.startsWith(`history:${conversationId}:`) &&
      (assistant.state === "done" || assistant.state === "error" || assistant.state === "interrupted")
      ? assistant : undefined;
    if (message.role !== "user" || (!phoneAssistant && message.delivery !== "failed")) {
      result.push(message);
      continue;
    }

    // Do not search through a later row already in the transcript: that would
    // move a phone turn past an established native anchor.
    let candidate = next;
    while (candidate < incoming.length) {
      const native = incoming[candidate];
      if (!native || existingIds.has(native.id)) break;
      if (native.role === "user" && !native.truncated && !message.truncated && native.text === message.text) break;
      candidate++;
    }
    const user = incoming[candidate];
    if (!user || existingIds.has(user.id) || user.role !== "user" || user.truncated ||
      message.truncated || user.text !== message.text) {
      result.push(message);
      if (phoneAssistant) { result.push(phoneAssistant); index++; }
      continue;
    }

    appendUntil(candidate);
    next = candidate + 1;
    // Native assistant text can span multiple rows. Accept either concatenated
    // stream chunks or Hermes' paragraph-separated projection, and stop as soon
    // as the local reply is complete so later host rows remain visible.
    let joined = "";
    let paragraphs = "";
    let count = 0;
    let complete = false;
    let cut = false;
    if (phoneAssistant) {
      for (let i = next; i < incoming.length; i++) {
        const part = incoming[i];
        if (!part || part.role !== "assistant" || existingIds.has(part.id)) break;
        const raw = joined + part.text;
        const spaced = paragraphs + (count ? "\n\n" : "") + part.text;
        if (!phoneAssistant.text.startsWith(raw) && !phoneAssistant.text.startsWith(spaced)) {
          // Redaction can prevent a text comparison. A cut first reply still
          // cannot supersede a completed phone response; consume only that row.
          if (count === 0 && part.truncated && phoneAssistant.state === "done") {
            count++;
            cut = true;
          }
          break;
        }
        joined = raw;
        paragraphs = spaced;
        count++;
        cut ||= part.truncated === true;
        if (joined === phoneAssistant.text || paragraphs === phoneAssistant.text) {
          complete = true;
          break;
        }
        if (cut) break;
      }
    }
    const reply = incoming[next];
    if (phoneAssistant?.state === "done" && !phoneAssistant.truncated && count === 1 && complete && !cut && reply?.role === "assistant") {
      result.push(user, reply);
    } else {
      result.push(message);
      if (phoneAssistant) result.push(phoneAssistant);
    }
    next += count;
    if (phoneAssistant) index++;
  }
  appendUntil(incoming.length);
  return result;
}
/** Newest-window refreshes use the same id-based merge as full hydration. */
export function mergeHistoryWindow(conversation: Conversation, history: HistoryMessage[]): Conversation {
  return hydrateLiveConversation(conversation, history);
}
export function historyToMessages(history: HistoryMessage[], conversationId: string, hermes: boolean): Message[] {
  return history.map(h => h.role === "user"
    ? { id: h.id, role: "user", text: hermes ? unwrapHermesHistoryText(h.text) : h.text, at: h.at, ...(h.truncated ? { truncated: true } : {}) }
    : { id: h.id, role: "assistant", text: h.text, at: h.at, state: "done", parts: h.parts, ...(h.truncated ? { truncated: true } : {}), turnId: `history:${conversationId}:${h.id}`, seq: 0 });
}
