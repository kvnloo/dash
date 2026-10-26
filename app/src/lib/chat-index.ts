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

/**
 * Same list placement and row header: what the merged list reads from an entry. The preview and
 * the thinking state are not compared: list rows read those live from the conversation by id.
 */
function sameListEntry(a: ConversationEntry, b: ConversationEntry): boolean {
  return a.id === b.id && a.key === b.key && a.title === b.title && a.updatedAt === b.updatedAt && a.attention === b.attention &&
    a.stale === b.stale && a.hostId === b.hostId && a.harness === b.harness && a.sessionId === b.sessionId && a.cwd === b.cwd;
}

/**
 * `next` with each entry replaced by its `prev` counterpart when the list-visible fields match,
 * and `prev` itself when nothing changed. Keeps the merged list's input stable across store
 * changes that do not move or relabel a row (roster adoption, status, setActive, most tool events).
 * A reused entry may hold an older `conversation`: list rows must read live state by id.
 */
export function stableEntries(prev: readonly ConversationEntry[], next: readonly ConversationEntry[]): readonly ConversationEntry[] {
  const byId = new Map<string, ConversationEntry>();
  for (const entry of prev) byId.set(entry.id, entry);
  let same = prev.length === next.length;
  const out: ConversationEntry[] = [];
  for (let i = 0; i < next.length; i++) {
    const entry = next[i];
    if (!entry) continue;
    const old = byId.get(entry.id);
    const kept = old && (old === entry || sameListEntry(old, entry)) ? old : entry;
    if (kept !== prev[i]) same = false;
    out.push(kept);
  }
  return same ? prev : out;
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
 * One sorted, key-deduplicated list with section headers. A local conversation wins over its
 * remote summary. A local row older than the last loaded remote row waits until the remote list
 * reaches it (or ends), so it never jumps above remote rows that are not loaded yet.
 * Equivalent to `mergeLocal(labelRemote(remote, groupOf), …)`; callers that re-merge on every
 * local change keep the labeled remote half and call those two directly.
 */
export function mergeLocalAndRemote(input: MergeInput): ChatListRow[] {
  const groupOf = input.groupOf ?? groupLabeler(input.now ?? Date.now());
  return mergeLocal(labelRemote(input.remote, groupOf), { local: input.local, exhausted: input.exhausted, endedLast: input.endedLast, groupOf });
}

// ---- labeled remote half (rebuilt per remote change, appended per page) ------

type ChatRowOf = Extract<ChatListRow, { type: "chat" }>;
type SectionRow = Extract<ChatListRow, { type: "section" }>;

interface RemoteSection {
  readonly title: string;
  readonly header: SectionRow;
  /** Row index of the header in `rows`; chats are `start + 1 .. end - 1`. */
  readonly start: number;
  readonly end: number;
}

/**
 * The loaded remote rows with their section headers, plus what an O(L log N) local merge needs.
 * `byKey` is append-only and shared with the labelings this one extends: use `chatIndex`.
 */
export interface RemoteLabeled {
  readonly source: readonly ChatSummary[];
  readonly groupOf: (at: number) => string;
  readonly rows: readonly ChatListRow[];
  readonly sections: readonly RemoteSection[];
  readonly chats: number;
  readonly chatAt: readonly number[];
  readonly chatSection: readonly number[];
  readonly chatRow: readonly number[];
  readonly byKey: Map<string, number>;
}

/** Index of the loaded remote chat with this key, if any. */
export function chatIndex(labeled: RemoteLabeled, key: string): number | undefined {
  const at = labeled.byKey.get(key);
  if (at === undefined || at >= labeled.chats) return undefined;
  const row = labeled.rows[labeled.chatRow[at] ?? -1];
  return row?.type === "chat" && row.key === key ? at : undefined;
}

/** Row objects keep their identity across rebuilds, so FlashList sees unchanged rows as unchanged. */
const remoteRowCache = new WeakMap<ChatSummary, ChatRowOf>();
function remoteRow(summary: ChatSummary): ChatRowOf {
  let row = remoteRowCache.get(summary);
  if (!row) { row = { type: "chat", key: summary.key, remote: summary }; remoteRowCache.set(summary, row); }
  return row;
}
const labelCache = new WeakMap<ChatSummary, { groupOf: (at: number) => string; label: string }>();
function labelOf(summary: ChatSummary, groupOf: (at: number) => string): string {
  const hit = labelCache.get(summary);
  if (hit && hit.groupOf === groupOf) return hit.label;
  const label = groupOf(summary.lastActivityAt);
  labelCache.set(summary, { groupOf, label });
  return label;
}

export const labelStats = { full: 0, appended: 0 };

/**
 * Label the loaded remote rows. When `prev` labeled a prefix of `remote` (a page was appended),
 * only the new rows are labeled and the last section continues; otherwise a full pass that reuses
 * row objects and labels.
 */
export function labelRemote(remote: readonly ChatSummary[], groupOf: (at: number) => string, prev?: RemoteLabeled): RemoteLabeled {
  if (prev && prev.source === remote && prev.groupOf === groupOf) return prev;
  let from = 0;
  let rows: ChatListRow[];
  let sections: RemoteSection[];
  let chatAt: number[], chatSection: number[], chatRow: number[], byKey: Map<string, number>;
  if (prev && prev.groupOf === groupOf && remote.length >= prev.source.length && prev.chats === prev.source.length && isPrefix(prev.source, remote)) {
    labelStats.appended += 1;
    from = prev.source.length;
    rows = prev.rows.slice();
    sections = prev.sections.slice();
    chatAt = prev.chatAt.slice(0, from);
    chatSection = prev.chatSection.slice(0, from);
    chatRow = prev.chatRow.slice(0, from);
    // Append-only and shared: lookups confirm the key at the index they get back.
    byKey = prev.byKey;
  } else {
    labelStats.full += 1;
    rows = [];
    sections = [];
    chatAt = []; chatSection = []; chatRow = []; byKey = new Map();
  }
  let open: { title: string; start: number; count: number } | undefined;
  const last = sections.at(-1);
  if (from > 0 && last) {
    open = { title: last.title, start: last.start, count: last.header.count };
    sections.pop();
  }
  const used = new Map<string, number>();
  for (const section of sections) used.set(section.title, (used.get(section.title) ?? 0) + 1);
  if (open) used.set(open.title, (used.get(open.title) ?? 0) + 1);
  const close = () => {
    if (!open) return;
    const seen = (used.get(open.title) ?? 1) - 1;
    const prior = rows[open.start];
    const header: SectionRow = prior?.type === "section" && prior.count === open.count && prior.title === open.title
      ? prior : { type: "section", key: seen ? `sec-${open.title}-${seen}` : `sec-${open.title}`, title: open.title, count: open.count };
    rows[open.start] = header;
    sections.push({ title: open.title, header, start: open.start, end: rows.length });
    open = undefined;
  };
  for (let j = from; j < remote.length; j++) {
    const summary = remote[j];
    if (!summary) continue;
    const title = labelOf(summary, groupOf);
    if (open?.title !== title) {
      close();
      used.set(title, (used.get(title) ?? 0) + 1);
      open = { title, start: rows.length, count: 0 };
      rows.push({ type: "section", key: "", title, count: 0 });
    }
    open.count += 1;
    chatAt[j] = summary.lastActivityAt;
    chatSection[j] = sections.length;
    chatRow[j] = rows.length;
    byKey.set(summary.key, j);
    rows.push(remoteRow(summary));
  }
  close();
  return { source: remote, groupOf, rows, sections, chats: remote.length, chatAt, chatSection, chatRow, byKey };
}

function isPrefix(prefix: readonly ChatSummary[], of: readonly ChatSummary[]): boolean {
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== of[i]) return false;
  return true;
}

const localRowCache = new WeakMap<ConversationEntry, ChatRowOf>();
function localRow(entry: ConversationEntry): ChatRowOf {
  let row = localRowCache.get(entry);
  if (!row) { row = { type: "chat", key: entry.key, local: entry }; localRowCache.set(entry, row); }
  return row;
}

export interface LocalMergeInput {
  local: readonly ConversationEntry[];
  exhausted: boolean;
  endedLast?: boolean;
  groupOf: (at: number) => string;
}

/** A run of rows under one header: a slice of the labeled remote rows, or rows built here. */
type Segment = { title: string; section: RemoteSection } | { title: string; rows: ChatRowOf[] };

/**
 * Merge the (small) local set into a labeled remote list. Cost: O(L log N) to place local rows,
 * plus rebuilding only the sections they touch, plus one copy of the output array.
 */
export function mergeLocal(labeled: RemoteLabeled, input: LocalMergeInput): ChatListRow[] {
  const { groupOf } = input;
  const attention: ConversationEntry[] = [];
  const timeline: ConversationEntry[] = [];
  const ended: ConversationEntry[] = [];
  // Remote chats a local conversation replaces, per section.
  const drops = new Map<number, Set<number>>();
  for (const entry of input.local) {
    const at = chatIndex(labeled, entry.key);
    if (at !== undefined) {
      const s = labeled.chatSection[at] ?? 0;
      let set = drops.get(s);
      if (!set) { set = new Set(); drops.set(s, set); }
      set.add(at);
    }
    if (entry.attention) attention.push(entry);
    else if (entry.stale && input.endedLast) ended.push(entry);
    else timeline.push(entry);
  }
  attention.sort((a, b) => (a.attention === b.attention ? 0 : a.attention === "Needs attention" ? -1 : 1) || b.updatedAt - a.updatedAt);
  timeline.sort((a, b) => b.updatedAt - a.updatedAt);
  ended.sort((a, b) => b.updatedAt - a.updatedAt);

  const n = labeled.chats;
  const cutoff = !input.exhausted && n > 0 ? labeled.chatAt[n - 1] ?? -Infinity : -Infinity;
  // Local rows per section, by binary search on activity (local first on ties).
  const placed = new Map<number, ConversationEntry[]>();
  const tail: ConversationEntry[] = [];
  for (const entry of timeline) {
    if (entry.updatedAt < cutoff) break;
    const c = firstAtOrBelow(labeled.chatAt, n, entry.updatedAt);
    const s = c < n ? labeled.chatSection[c] : labeled.sections.length - 1;
    if (s === undefined || s < 0) { tail.push(entry); continue; }
    let list = placed.get(s);
    if (!list) { list = []; placed.set(s, list); }
    list.push(entry);
  }

  const segments: Segment[] = [];
  let run: { title: string; rows: ChatRowOf[] } | undefined;
  const add = (row: ChatRowOf, title: string) => {
    if (run && run.title === title) { run.rows.push(row); return; }
    run = { title, rows: [row] };
    segments.push(run);
  };
  for (const entry of attention) add(localRow(entry), entry.attention ?? "");
  const sections = labeled.sections;
  for (let s = 0; s < sections.length; s++) {
    const section = sections[s];
    if (!section) continue;
    const locals = placed.get(s);
    const dropped = drops.get(s);
    if (!locals && !dropped) { segments.push({ title: section.title, section }); run = undefined; continue; }
    let i = 0;
    for (let r = section.start + 1; r < section.end; r++) {
      const row = labeled.rows[r];
      if (row?.type !== "chat" || !row.remote) continue;
      const at = row.remote.lastActivityAt;
      if (locals) for (let l = locals[i]; l && l.updatedAt >= at; l = locals[++i]) add(localRow(l), groupOf(l.updatedAt));
      if (dropped && dropped.has(chatIndex(labeled, row.key) ?? -1)) continue;
      add(row, section.title);
    }
    if (locals) for (let l = locals[i]; l; l = locals[++i]) add(localRow(l), groupOf(l.updatedAt));
  }
  for (const entry of tail) add(localRow(entry), groupOf(entry.updatedAt));
  for (const entry of ended) add(localRow(entry), "Ended");

  // Adjacent segments with one title become one section (as the single-pass merge produced).
  const out: ChatListRow[] = [];
  const used = new Map<string, number>();
  for (let k = 0; k < segments.length; k++) {
    const segment = segments[k];
    if (!segment) continue;
    let rows: ChatRowOf[] | undefined;
    while (segments[k + 1]?.title === segment.title) {
      rows ??= segmentRows(labeled, segment);
      const next = segments[++k];
      if (next) rows.push(...segmentRows(labeled, next));
    }
    const seen = used.get(segment.title) ?? 0;
    used.set(segment.title, seen + 1);
    const key = seen ? `sec-${segment.title}-${seen}` : `sec-${segment.title}`;
    if (!rows && "section" in segment) {
      const { section } = segment;
      out.push(section.header.key === key ? section.header : { ...section.header, key });
      for (let r = section.start + 1; r < section.end; r++) { const row = labeled.rows[r]; if (row) out.push(row); }
      continue;
    }
    rows ??= segmentRows(labeled, segment);
    if (rows.length === 0) continue;
    out.push({ type: "section", key, title: segment.title, count: rows.length });
    for (const row of rows) out.push(row);
  }
  return out;
}

function segmentRows(labeled: RemoteLabeled, segment: Segment): ChatRowOf[] {
  if ("rows" in segment) return segment.rows.slice();
  const out: ChatRowOf[] = [];
  for (let r = segment.section.start + 1; r < segment.section.end; r++) { const row = labeled.rows[r]; if (row?.type === "chat") out.push(row); }
  return out;
}

/** First index in the descending `at[0..n)` whose value is <= `value` (n when none). */
function firstAtOrBelow(at: readonly number[], n: number, value: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((at[mid] ?? -Infinity) <= value) hi = mid; else lo = mid + 1;
  }
  return lo;
}
