import { chatKey, type ChatPage, type ChatSummary } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { dateGroupLabel } from "./time-labels";
import { chatAttention } from "./chat-attention";
import { conversationPreview } from "./live-sessions";

/** Injected work meter for the O(page) checks. Each unit is one row touched. */
export interface OpCounter { n: number }

/**
 * A cursor-paged list of chat summaries. `rows` and `index` are append-only and shared between
 * versions (one owner: the chat index store), so a new page costs O(page), not O(loaded).
 */
export interface PagedList {
  readonly version: number;
  /** Rows that a head refresh found above page 1 (new or bumped), newest first. Small. */
  readonly head: readonly ChatSummary[];
  /** Server pages in order. `null` marks a row that moved into `head`. */
  readonly rows: (ChatSummary | null)[];
  /** key -> rows index, or "head". */
  readonly index: Map<string, number | "head">;
  readonly next: string | null;
  /** True once the server returned `next: null`. */
  readonly exhausted: boolean;
  readonly rev: number;
}

export function emptyList(): PagedList {
  return { version: 0, head: [], rows: [], index: new Map(), next: null, exhausted: false, rev: 0 };
}

export function sameSummary(a: ChatSummary, b: ChatSummary): boolean {
  return a.key === b.key && a.kind === b.kind && a.sessionId === b.sessionId && a.hostId === b.hostId && a.hostName === b.hostName &&
    a.profileId === b.profileId && a.agentId === b.agentId && a.title === b.title && a.cwd === b.cwd && a.startedAt === b.startedAt &&
    a.lastActivityAt === b.lastActivityAt && a.messageCount === b.messageCount && a.origin === b.origin && a.chatable === b.chatable &&
    a.running === b.running && a.openIn === b.openIn;
}

function byActivity(a: ChatSummary, b: ChatSummary): number {
  return b.lastActivityAt - a.lastActivityAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** Append the next page. Known keys are replaced in place only when a field changed. */
export function mergePage(list: PagedList, page: ChatPage, counter?: OpCounter): PagedList {
  let head = list.head;
  for (const item of page.items) {
    if (counter) counter.n += 1;
    const slot = list.index.get(item.key);
    if (slot === undefined) {
      list.rows.push(item);
      list.index.set(item.key, list.rows.length - 1);
    } else if (slot === "head") {
      const at = head.findIndex(row => row.key === item.key);
      const current = head[at];
      if (current && !sameSummary(current, item) && item.lastActivityAt >= current.lastActivityAt) {
        const copy = head.slice();
        copy[at] = item;
        head = copy;
      }
    } else {
      const current = list.rows[slot];
      if (current && !sameSummary(current, item)) list.rows[slot] = item;
    }
  }
  return { ...list, head, version: list.version + 1, next: page.next, exhausted: page.next === null, rev: page.rev };
}

/**
 * Apply a fresh page 1 on top of a loaded list: new keys and bumped rows move to the top,
 * changed rows are replaced in place, and unchanged rows keep their identity.
 */
export function applyHead(list: PagedList, page: ChatPage, counter?: OpCounter): PagedList {
  if (list.version === 0) return mergePage(list, page, counter);
  let changed = false;
  const lifted: ChatSummary[] = [];
  let head = list.head;
  for (const item of page.items) {
    if (counter) counter.n += 1;
    const slot = list.index.get(item.key);
    if (slot === undefined) {
      lifted.push(item);
      list.index.set(item.key, "head");
      changed = true;
    } else if (slot === "head") {
      const at = head.findIndex(row => row.key === item.key);
      const current = head[at];
      if (current && !sameSummary(current, item)) {
        const copy = head.slice();
        copy[at] = item;
        head = copy;
        changed = true;
      }
    } else {
      const current = list.rows[slot];
      if (!current || sameSummary(current, item)) continue;
      changed = true;
      if (item.lastActivityAt !== current.lastActivityAt) {
        list.rows[slot] = null;
        list.index.set(item.key, "head");
        lifted.push(item);
      } else list.rows[slot] = item;
    }
  }
  if (!changed) return list.rev === page.rev ? list : { ...list, rev: page.rev };
  if (lifted.length) {
    const merged = [...lifted, ...head];
    if (counter) counter.n += merged.length;
    merged.sort(byActivity);
    head = merged;
  }
  return { ...list, head, version: list.version + 1, rev: page.rev };
}

const flatCache = new WeakMap<PagedList, ChatSummary[]>();
/** The loaded rows in display order. O(loaded), cached per version. */
export function listRows(list: PagedList): ChatSummary[] {
  const cached = flatCache.get(list);
  if (cached) return cached;
  const out: ChatSummary[] = list.head.slice();
  for (const row of list.rows) if (row) out.push(row);
  flatCache.set(list, out);
  return out;
}

export function findInList(list: PagedList, key: string): ChatSummary | undefined {
  const slot = list.index.get(key);
  if (slot === undefined) return undefined;
  if (slot === "head") return list.head.find(row => row.key === key);
  return list.rows[slot] ?? undefined;
}

// ---- local conversations ---------------------------------------------------

/** The index key of a phone conversation; chats that never reached a host are `local:<id>`. */
export function conversationKey(c: Pick<Conversation, "id" | "harness" | "sessionId" | "targetHostId" | "profileName">): string {
  if (!c.sessionId || !c.targetHostId) return `local:${c.id}`;
  return chatKey({ hostId: c.targetHostId, kind: c.harness, sessionId: c.sessionId, ...(c.harness === "hermes" && c.profileName ? { profileId: c.profileName } : {}) });
}

/** What a list or search row needs from a conversation. Built once per conversation revision. */
export interface ConversationEntry {
  id: string;
  key: string;
  title: string;
  harness: string;
  updatedAt: number;
  preview: string;
  attention: "Needs attention" | "Running" | null;
  hostId?: string;
  stale: boolean;
  cwd?: string;
  sessionId?: string;
  conversation: Conversation;
}

const entries = new WeakMap<Conversation, ConversationEntry>();
export const entryStats = { builds: 0 };

export function conversationEntry(c: Conversation): ConversationEntry {
  const cached = entries.get(c);
  if (cached) return cached;
  entryStats.builds += 1;
  const entry: ConversationEntry = {
    id: c.id, key: conversationKey(c), title: c.title, harness: c.harness, updatedAt: c.updatedAt,
    preview: conversationPreview(c), attention: chatAttention(c), hostId: c.targetHostId, stale: c.stale === true,
    ...(c.cwd ? { cwd: c.cwd } : {}), ...(c.sessionId ? { sessionId: c.sessionId } : {}), conversation: c,
  };
  entries.set(c, entry);
  return entry;
}

/** Light entries for every listed conversation. Unchanged conversations reuse their entry. */
export function conversationEntries(conversations: readonly Conversation[]): ConversationEntry[] {
  const out: ConversationEntry[] = [];
  for (const c of conversations) if (!c.viewOnly) out.push(conversationEntry(c));
  return out;
}

// ---- merged list -----------------------------------------------------------

export type ChatListRow =
  | { type: "section"; key: string; title: string; count: number }
  | { type: "chat"; key: string; local?: ConversationEntry; remote?: ChatSummary }
  | { type: "skeleton"; key: string };

/** Group labels for 20k rows: month labels are computed once per month, not per row. */
export function groupLabeler(now: number): (at: number) => string {
  const recent = new Date(now);
  recent.setHours(0, 0, 0, 0);
  const weekStart = recent.getTime() - 6 * 86_400_000;
  const months = new Map<number, string>();
  return at => {
    if (at >= weekStart) return dateGroupLabel(at, now);
    const d = new Date(at);
    const month = d.getFullYear() * 12 + d.getMonth();
    let label = months.get(month);
    if (label === undefined) { label = dateGroupLabel(at, now); months.set(month, label); }
    return label;
  };
}

export interface MergeInput {
  local: readonly ConversationEntry[];
  remote: readonly ChatSummary[];
  /** The remote list reached its end (or there is no remote list: legacy mode). */
  exhausted: boolean;
  now?: number;
  /** Legacy look: ended local chats in their own trailing section. */
  endedLast?: boolean;
  groupOf?: (at: number) => string;
}

/**
 * One sorted, key-deduplicated list with section headers, in a single pass over
 * local + loaded rows. A local conversation wins over its remote summary. A local row older than
 * the last loaded remote row waits until the remote list reaches it (or ends), so it never jumps
 * above remote rows that are not loaded yet.
 */
export function mergeLocalAndRemote(input: MergeInput): ChatListRow[] {
  const groupOf = input.groupOf ?? groupLabeler(input.now ?? Date.now());
  const attention: ConversationEntry[] = [];
  const timeline: ConversationEntry[] = [];
  const ended: ConversationEntry[] = [];
  const localKeys = new Set<string>();
  for (const entry of input.local) {
    localKeys.add(entry.key);
    if (entry.attention) attention.push(entry);
    else if (entry.stale && input.endedLast) ended.push(entry);
    else timeline.push(entry);
  }
  attention.sort((a, b) => (a.attention === b.attention ? 0 : a.attention === "Needs attention" ? -1 : 1) || b.updatedAt - a.updatedAt);
  timeline.sort((a, b) => b.updatedAt - a.updatedAt);
  ended.sort((a, b) => b.updatedAt - a.updatedAt);

  const out: ChatListRow[] = [];
  let section: { type: "section"; key: string; title: string; count: number } | undefined;
  const used = new Map<string, number>();
  const push = (title: string, row: ChatListRow) => {
    if (section?.title !== title) {
      const seen = used.get(title) ?? 0;
      used.set(title, seen + 1);
      section = { type: "section", key: seen ? `sec-${title}-${seen}` : `sec-${title}`, title, count: 0 };
      out.push(section);
    }
    section.count += 1;
    out.push(row);
  };

  for (const entry of attention) push(entry.attention ?? "", { type: "chat", key: entry.key, local: entry });

  const remote = input.remote;
  const last = remote.at(-1);
  const cutoff = !input.exhausted && last ? last.lastActivityAt : -Infinity;
  let i = 0, j = 0;
  while (i < timeline.length || j < remote.length) {
    const r = remote[j];
    if (r && localKeys.has(r.key)) { j += 1; continue; }
    const l = timeline[i];
    if (l && l.updatedAt < cutoff) { i = timeline.length; continue; }
    if (l && (!r || l.updatedAt >= r.lastActivityAt)) {
      push(l.stale && input.endedLast ? "Ended" : groupOf(l.updatedAt), { type: "chat", key: l.key, local: l });
      i += 1;
    } else if (r) {
      push(groupOf(r.lastActivityAt), { type: "chat", key: r.key, remote: r });
      j += 1;
    }
  }
  for (const entry of ended) push("Ended", { type: "chat", key: entry.key, local: entry });
  return out;
}
