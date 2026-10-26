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
  /**
   * Slots of `rows` that were replaced in place or emptied (moved to `head`), in order. Append-only
   * and shared like `rows`: a labeling replays only the entries after the ones it has seen, so a
   * head refresh costs O(changes). A new array (after JOURNAL_CAP entries) means "relabel".
   */
  readonly changes: number[];
  readonly next: string | null;
  /** True once the server returned `next: null`. */
  readonly exhausted: boolean;
  readonly rev: number;
}

export function emptyList(): PagedList {
  return { version: 0, head: [], rows: [], index: new Map(), changes: [], next: null, exhausted: false, rev: 0 };
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

/** Past this many journal entries the next version starts a fresh journal (one full relabel). */
const JOURNAL_CAP = 4096;
function journal(list: PagedList): number[] {
  return list.changes.length > JOURNAL_CAP ? [] : list.changes;
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
      if (current && !sameSummary(current, item)) {
        list.rows[slot] = item;
        list.changes.push(slot);
      }
    }
  }
  return { ...list, head, changes: journal(list), version: list.version + 1, next: page.next, exhausted: page.next === null, rev: page.rev };
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
      list.changes.push(slot);
    }
  }
  if (!changed) return list.rev === page.rev ? list : { ...list, rev: page.rev };
  if (lifted.length) {
    const merged = [...lifted, ...head];
    if (counter) counter.n += merged.length;
    merged.sort(byActivity);
    head = merged;
  }
  return { ...list, head, changes: journal(list), version: list.version + 1, rev: page.rev };
}

const flatCache = new WeakMap<PagedList, ChatSummary[]>();
/** The last flat array built for a `rows` lineage, and what it was built from. */
const flatLineage = new WeakMap<readonly (ChatSummary | null)[], { head: readonly ChatSummary[]; changes: readonly number[]; seen: number; slots: number; out: ChatSummary[] }>();
/**
 * The loaded rows in display order, cached per version. An appended page costs O(page) plus one
 * native array copy; only a head change or an in-place change rebuilds it.
 */
export function listRows(list: PagedList): ChatSummary[] {
  const cached = flatCache.get(list);
  if (cached) return cached;
  const prev = flatLineage.get(list.rows);
  let out: ChatSummary[];
  if (prev && prev.head === list.head && prev.changes === list.changes && prev.seen === list.changes.length) {
    const added: ChatSummary[] = [];
    for (let j = prev.slots; j < list.rows.length; j++) { const row = list.rows[j]; if (row) added.push(row); }
    out = added.length ? prev.out.concat(added) : prev.out;
  } else {
    out = list.head.slice();
    for (const row of list.rows) if (row) out.push(row);
  }
  flatLineage.set(list.rows, { head: list.head, changes: list.changes, seen: list.changes.length, slots: list.rows.length, out });
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
 * `updatedAt` moves on every status, tool and summary event of a running turn; an attention row is
 * pinned to its attention section, so while the attention state holds its order may lag until the
 * turn settles instead of re-merging the whole list per event.
 */
function sameListEntry(a: ConversationEntry, b: ConversationEntry): boolean {
  const placed = a.updatedAt === b.updatedAt || (a.attention !== null && a.attention === b.attention);
  return a.id === b.id && a.key === b.key && a.title === b.title && placed && a.attention === b.attention &&
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

// ---- labeled remote half (updated in O(changes) per version) ----------------

type ChatRowOf = Extract<ChatListRow, { type: "chat" }>;
type SectionRow = Extract<ChatListRow, { type: "section" }>;

/**
 * Consecutive loaded remote rows with one label. Mutable and owned by one labeling lineage; the
 * merge copies it out (natively), so a published list never changes under FlashList.
 */
interface Run {
  readonly title: string;
  readonly rows: ChatRowOf[];
  /** The header last published for this run alone, reused while its key and count hold. */
  header?: SectionRow;
}

/** What a labeling reads: a PagedList, or a plain array for a one-off merge. */
export interface LabelSource {
  readonly head: readonly ChatSummary[];
  readonly rows: readonly (ChatSummary | null)[];
  readonly changes: readonly number[];
}

/** The labeled `rows` of one PagedList lineage. Append-only arrays, patched in place. */
interface Body {
  readonly source: readonly (ChatSummary | null)[];
  readonly changes: readonly number[];
  readonly groupOf: (at: number) => string;
  /** `source` slots labeled so far, and journal entries replayed so far. */
  slots: number;
  seen: number;
  readonly runs: Run[];
  readonly slotRow: (ChatRowOf | undefined)[];
  readonly slotRun: (Run | undefined)[];
  readonly byKey: Map<string, number>;
  /** Bumped by every mutation: a labeling with an older stamp is out of date. */
  stamp: number;
}

/**
 * The loaded remote rows grouped into labeled runs: the small `head` relabeled when it changes,
 * the body appended per page and patched per journal entry. A labeling stays valid until the next
 * `labelList` call on its lineage (one owner: the Chats pane).
 */
export interface RemoteLabeled {
  readonly from: LabelSource;
  readonly groupOf: (at: number) => string;
  readonly head: readonly ChatSummary[];
  readonly headRuns: readonly Run[];
  readonly headRows: ReadonlyMap<string, { run: Run; row: ChatRowOf }>;
  readonly body: Body;
  readonly stamp: number;
  /** Non-empty runs in display order. */
  readonly runs: readonly Run[];
  readonly chats: number;
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

/** Work done by labelings: full passes, appended pages, replayed in-place changes. */
export const labelStats = { full: 0, appended: 0, patched: 0 };

function newBody(source: LabelSource, groupOf: (at: number) => string): Body {
  labelStats.full += 1;
  const body: Body = { source: source.rows, changes: source.changes, groupOf, slots: 0, seen: source.changes.length, runs: [], slotRow: [], slotRun: [], byKey: new Map(), stamp: 0 };
  appendSlots(body);
  return body;
}

function appendSlots(body: Body): void {
  const { source, runs, groupOf } = body;
  for (let j = body.slots; j < source.length; j++) {
    const summary = source[j];
    if (!summary) continue;
    const title = labelOf(summary, groupOf);
    let run = runs.at(-1);
    if (run?.title !== title) { run = { title, rows: [] }; runs.push(run); }
    const row = remoteRow(summary);
    run.rows.push(row);
    body.slotRow[j] = row;
    body.slotRun[j] = run;
    body.byKey.set(summary.key, j);
  }
  if (source.length > body.slots) body.stamp += 1;
  body.slots = source.length;
}

/** Replay the journal, then label appended slots. Returns a new body when it had to relabel. */
function syncBody(body: Body, source: LabelSource): Body {
  const { changes } = source;
  const rows = source.rows;
  for (; body.seen < changes.length; body.seen++) {
    const slot = changes[body.seen] ?? -1;
    if (slot < 0 || slot >= body.slots) continue; // not labeled yet: the append below reads it
    const old = body.slotRow[slot];
    const run = body.slotRun[slot];
    const now = rows[slot] ?? null;
    if (old?.remote === now || (!old && !now)) continue;
    const at = old && run ? run.rows.indexOf(old) : -1;
    if (at < 0 || !old || !run) return newBody(source, body.groupOf);
    if (!now) {
      // Moved to the head: the body forgets it.
      run.rows.splice(at, 1);
      body.slotRow[slot] = undefined;
      body.slotRun[slot] = undefined;
      if (body.byKey.get(old.key) === slot) body.byKey.delete(old.key);
    } else {
      // Replaced in place: same run unless its label moved (then relabel; rare).
      if (labelOf(now, body.groupOf) !== run.title) return newBody(source, body.groupOf);
      const row = remoteRow(now);
      run.rows[at] = row;
      body.slotRow[slot] = row;
      if (old.key !== now.key && body.byKey.get(old.key) === slot) body.byKey.delete(old.key);
      body.byKey.set(now.key, slot);
    }
    labelStats.patched += 1;
    body.stamp += 1;
  }
  if (rows.length > body.slots) {
    labelStats.appended += 1;
    appendSlots(body);
  }
  return body;
}

function labelHead(head: readonly ChatSummary[], groupOf: (at: number) => string): { runs: Run[]; rows: Map<string, { run: Run; row: ChatRowOf }> } {
  const runs: Run[] = [];
  const rows = new Map<string, { run: Run; row: ChatRowOf }>();
  for (const summary of head) {
    const title = labelOf(summary, groupOf);
    let run = runs.at(-1);
    if (run?.title !== title) { run = { title, rows: [] }; runs.push(run); }
    const row = remoteRow(summary);
    run.rows.push(row);
    rows.set(summary.key, { run, row });
  }
  return { runs, rows };
}

/**
 * Label a PagedList version. With the previous labeling of the same lineage it costs
 * O(appended + journal entries + head + runs); otherwise one full pass.
 */
export function labelList(source: LabelSource, groupOf: (at: number) => string, prev?: RemoteLabeled): RemoteLabeled {
  if (prev && prev.from === source && prev.groupOf === groupOf) return prev;
  let body = prev?.body;
  body = body && body.source === source.rows && body.changes === source.changes && body.groupOf === groupOf
    ? syncBody(body, source)
    : newBody(source, groupOf);
  const sameHead = prev !== undefined && prev.head === source.head && prev.groupOf === groupOf;
  if (sameHead && prev.body === body && prev.stamp === body.stamp) return prev;
  const head = sameHead ? { runs: prev.headRuns, rows: prev.headRows } : labelHead(source.head, groupOf);
  const runs: Run[] = [];
  let chats = 0;
  for (const run of head.runs) if (run.rows.length) { runs.push(run); chats += run.rows.length; }
  for (const run of body.runs) if (run.rows.length) { runs.push(run); chats += run.rows.length; }
  return { from: source, groupOf, head: source.head, headRuns: head.runs, headRows: head.rows, body, stamp: body.stamp, runs, chats };
}

const NO_HEAD: readonly ChatSummary[] = Object.freeze([]);
const NO_CHANGES: readonly number[] = Object.freeze([]);

/** Label a plain array of summaries (one-off merges and tests). `prev` helps only for the same array. */
export function labelRemote(remote: readonly ChatSummary[], groupOf: (at: number) => string, prev?: RemoteLabeled): RemoteLabeled {
  return labelList({ head: NO_HEAD, rows: remote, changes: NO_CHANGES }, groupOf, prev);
}

/** The loaded remote row with this key, and its run. */
function remoteHit(labeled: RemoteLabeled, key: string): { run: Run; row: ChatRowOf } | undefined {
  const head = labeled.headRows.get(key);
  if (head) return head;
  const { body } = labeled;
  const slot = body.byKey.get(key);
  if (slot === undefined) return undefined;
  const row = body.slotRow[slot];
  const run = body.slotRun[slot];
  return row && run && row.key === key ? { run, row } : undefined;
}

/** True when a remote chat with this key is loaded. */
export function hasRemote(labeled: RemoteLabeled, key: string): boolean {
  return remoteHit(labeled, key) !== undefined;
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

/** Rows under one title before adjacent titles are joined. `run` marks an untouched run. */
interface Segment { title: string; count: number; parts: ChatListRow[][]; run?: Run }

function atOf(row: ChatRowOf | undefined): number {
  return row?.remote?.lastActivityAt ?? -Infinity;
}

/** First index in the descending `rows` whose activity is <= `value` (rows.length when none). */
function firstAtOrBelow(rows: readonly ChatRowOf[], value: number): number {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (atOf(rows[mid]) <= value) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/**
 * Merge the (small) local set into a labeled remote list. Cost: O(L log N) to place local rows,
 * plus O(runs), plus one native copy of the untouched runs into the output array.
 */
export function mergeLocal(labeled: RemoteLabeled, input: LocalMergeInput): ChatListRow[] {
  const { groupOf } = input;
  const attention: ConversationEntry[] = [];
  const timeline: ConversationEntry[] = [];
  const ended: ConversationEntry[] = [];
  // Remote rows a local conversation replaces, per run.
  const drops = new Map<Run, ChatRowOf[]>();
  for (const entry of input.local) {
    const hit = remoteHit(labeled, entry.key);
    if (hit) {
      const list = drops.get(hit.run);
      if (list) list.push(hit.row); else drops.set(hit.run, [hit.row]);
    }
    if (entry.attention) attention.push(entry);
    else if (entry.stale && input.endedLast) ended.push(entry);
    else timeline.push(entry);
  }
  attention.sort((a, b) => (a.attention === b.attention ? 0 : a.attention === "Needs attention" ? -1 : 1) || b.updatedAt - a.updatedAt);
  timeline.sort((a, b) => b.updatedAt - a.updatedAt);
  ended.sort((a, b) => b.updatedAt - a.updatedAt);

  const runs = labeled.runs;
  const lastRun = runs.at(-1);
  const cutoff = !input.exhausted && lastRun ? atOf(lastRun.rows.at(-1)) : -Infinity;
  // Local rows per run with their insertion index, by binary search on activity (local first on ties).
  const placed = new Map<Run, { entry: ConversationEntry; pos: number }[]>();
  const tail: ConversationEntry[] = [];
  for (const entry of timeline) {
    if (entry.updatedAt < cutoff) break;
    if (!lastRun) { tail.push(entry); continue; }
    let lo = 0, hi = runs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (atOf(runs[mid]?.rows.at(-1)) <= entry.updatedAt) hi = mid; else lo = mid + 1;
    }
    const run = runs[lo] ?? lastRun;
    const pos = lo < runs.length ? firstAtOrBelow(run.rows, entry.updatedAt) : run.rows.length;
    const list = placed.get(run);
    if (list) list.push({ entry, pos }); else placed.set(run, [{ entry, pos }]);
  }

  const segments: Segment[] = [];
  const add = (title: string, part: ChatListRow[]) => {
    const last = segments.at(-1);
    if (last && !last.run && last.title === title) { last.parts.push(part); last.count += part.length; return; }
    segments.push({ title, count: part.length, parts: [part] });
  };
  for (const entry of attention) add(entry.attention ?? "", [localRow(entry)]);
  for (const run of runs) {
    const locals = placed.get(run);
    const dropped = drops.get(run);
    if (!locals && !dropped) { segments.push({ title: run.title, count: run.rows.length, parts: [run.rows], run }); continue; }
    const cuts = (dropped ?? []).map(row => run.rows.indexOf(row)).filter(i => i >= 0).sort((a, b) => a - b);
    let cursor = 0, d = 0;
    const remoteUntil = (to: number) => {
      while (cursor < to) {
        while (d < cuts.length && (cuts[d] ?? 0) < cursor) d++;
        const cut = cuts[d];
        const stop = cut !== undefined && cut < to ? cut : to;
        if (stop > cursor) add(run.title, run.rows.slice(cursor, stop));
        cursor = stop === cut ? stop + 1 : stop;
      }
    };
    if (locals) {
      locals.sort((a, b) => a.pos - b.pos);
      for (const { entry, pos } of locals) { remoteUntil(pos); add(groupOf(entry.updatedAt), [localRow(entry)]); }
    }
    remoteUntil(run.rows.length);
  }
  for (const entry of tail) add(groupOf(entry.updatedAt), [localRow(entry)]);
  for (const entry of ended) add("Ended", [localRow(entry)]);

  // Adjacent segments with one title become one section (as the single-pass merge produced).
  const pieces: ChatListRow[][] = [];
  const used = new Map<string, number>();
  const live = segments.filter(segment => segment.count > 0);
  for (let k = 0; k < live.length; k++) {
    const first = live[k];
    if (!first) continue;
    let count = first.count;
    let end = k + 1;
    while (live[end]?.title === first.title) count += live[end++]?.count ?? 0;
    const seen = used.get(first.title) ?? 0;
    used.set(first.title, seen + 1);
    const key = seen ? `sec-${first.title}-${seen}` : `sec-${first.title}`;
    let header: SectionRow;
    if (end === k + 1 && first.run) {
      const prior = first.run.header;
      header = prior && prior.key === key && prior.count === count ? prior : { type: "section", key, title: first.title, count };
      first.run.header = header;
    } else header = { type: "section", key, title: first.title, count };
    pieces.push([header]);
    for (let j = k; j < end; j++) for (const part of live[j]?.parts ?? []) pieces.push(part);
    k = end - 1;
  }
  return ([] as ChatListRow[]).concat(...pieces);
}
