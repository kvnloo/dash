import { MODEL_ID, type ChatSummary, type HostInfo } from "../../../shared/protocol";
import { conversationKey } from "./chat-index";
import type { Conversation } from "../model";

/** One chat the badge can warp to. `id` is a phone conversation id, or `remote:<index key>` for a host-index chat not opened on this phone yet. */
export interface RouteSession { id: string; title: string; sessionId?: string; updatedAt: number; viewOnly?: boolean }
/** Chats of one host › harness › profile, newest first. */
export interface RouteGroup { key: string; host: string; harness: string; profile?: string; sessions: RouteSession[] }

export interface SessionRoutesInput {
  conversations: readonly Conversation[];
  currentId?: string;
  /** The paired bridge address. Chats owned by another pairing (or with no recorded owner) are never offered. */
  address?: string;
  hosts: readonly Pick<HostInfo, "id" | "name" | "self">[];
  harnesses: readonly { id: string; name: string }[];
  /** The host chat index (Chats tab rows). Rows the phone already holds are listed once, as the phone chat. */
  summaries?: readonly ChatSummary[];
  limit?: number;
}

/**
 * The other chats this pairing reaches, grouped host › harness › profile, newest first: the phone's own
 * chats (only ones that hold a session or messages: an empty "New chat" is not a place to warp to; stale
 * and view-only copies are left out) plus the host chat index rows the phone has not opened yet.
 */
export function sessionRoutes({ conversations, currentId, address, hosts, harnesses, summaries = [], limit = 24 }: SessionRoutesInput): RouteGroup[] {
  if (!address) return [];
  const selfName = hosts.find(host => host.self)?.name ?? "this computer";
  const hostName = (id: string | undefined) => !id ? selfName : hosts.find(host => host.id === id)?.name ?? id.replace(/^machine:/, "");
  const harnessName = (id: string) => harnesses.find(h => h.id === id)?.name ?? id;
  const hostKey = (id: string | undefined) => !id || hosts.some(host => host.self && host.id === id) ? "self" : id;
  interface Entry { groupKey: string; host: string; harness: string; profile?: string; session: RouteSession }
  const owned = conversations.filter(c => c.endpointAddress === address);
  const held = new Set(owned.map(conversationKey));
  const current = conversations.find(c => c.id === currentId);
  if (current) held.add(conversationKey(current));
  const entries: Entry[] = owned
    .filter(c => c.id !== currentId && !c.viewOnly && !c.stale && (c.sessionId || c.messages.length > 0))
    .map(c => ({
      groupKey: `${hostKey(c.targetHostId)}\u0000${c.harness}\u0000${c.profileId ?? ""}`, host: hostName(c.targetHostId), harness: harnessName(c.harness),
      profile: c.profileName ?? c.profileId,
      session: { id: c.id, title: c.title || harnessName(c.harness), ...(c.sessionId ? { sessionId: c.sessionId } : {}), updatedAt: c.updatedAt },
    }));
  const listed = new Set<string>();
  for (const row of summaries) {
    if (held.has(row.key) || listed.has(row.key)) continue;
    listed.add(row.key);
    entries.push({
      groupKey: `${hostKey(row.hostId)}\u0000${row.kind}\u0000${row.profileId ?? ""}`, host: row.hostName || hostName(row.hostId), harness: harnessName(row.kind),
      profile: row.profileId,
      session: { id: `remote:${row.key}`, title: row.title || harnessName(row.kind), sessionId: row.sessionId, updatedAt: row.lastActivityAt, ...(row.chatable ? {} : { viewOnly: true }) },
    });
  }
  entries.sort((a, b) => b.session.updatedAt - a.session.updatedAt);
  const groups = new Map<string, RouteGroup>();
  for (const entry of entries.slice(0, limit)) {
    const group = groups.get(entry.groupKey) ?? { key: entry.groupKey, host: entry.host, harness: entry.harness, ...(entry.profile && entry.profile !== entry.harness ? { profile: entry.profile } : {}), sessions: [] };
    group.sessions.push(entry.session);
    groups.set(entry.groupKey, group);
  }
  return [...groups.values()];
}

export interface ModelChoice { id: string; source: string }

/**
 * Models the badge offers for the next turn: what the host reported for this session, the one already
 * requested, then the host's configured role models. Role references (`@default`) and anything that is
 * not a model id are dropped. The host still decides: it applies the choice before prompting or rejects it.
 */
export function modelChoices({ reported, requested, roles = [] }: { reported?: string; requested?: string; roles?: readonly { role: string; model: string }[] }): ModelChoice[] {
  const out: ModelChoice[] = [];
  const add = (id: string | undefined, source: string) => {
    if (!id || id.startsWith("@") || !MODEL_ID.test(id) || out.some(choice => choice.id === id)) return;
    out.push({ id, source });
  };
  add(reported, "reported by host for this session");
  add(requested, "requested for the next turn");
  for (const row of roles) add(row.model, `host role · ${row.role}`);
  return out;
}

/** A free-typed model id is accepted only in the exact shape the bridge forwards. */
export function validModelId(text: string): string | undefined {
  const id = text.trim();
  return MODEL_ID.test(id) ? id : undefined;
}
