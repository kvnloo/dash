import type { ChatSearchHit, ChatSummary, SearchHighlight } from "../../../shared/protocol";
import { effortIdForTurn, lastAssistantState, runtimeStateFromOrchestra, runtimeStateFromTurn } from "../catalog/runtime-state";
import type { Conversation } from "../model";
import { timeAgo } from "./time-labels";
import { sameSummary, type ConversationEntry } from "./chat-index";
import type { SearchResult } from "./global-search";

// ---- local index -----------------------------------------------------------

export interface LocalSearchEntry {
  entry: ConversationEntry;
  harnessName: string;
  /** Lowercase title + harness + cwd + preview, built once per conversation revision. */
  hay: string;
}

const localIndex = new WeakMap<Conversation, LocalSearchEntry>();
export const localIndexStats = { builds: 0 };

export function localSearchEntry(entry: ConversationEntry, harnessName: string): LocalSearchEntry {
  const cached = localIndex.get(entry.conversation);
  if (cached && cached.entry === entry && cached.harnessName === harnessName) return cached;
  localIndexStats.builds += 1;
  const built: LocalSearchEntry = {
    entry, harnessName,
    hay: [entry.title, harnessName, entry.harness, entry.cwd ?? "", entry.preview].join(" ").toLowerCase(),
  };
  localIndex.set(entry.conversation, built);
  return built;
}

export function searchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export const LOCAL_SEARCH_LIMIT = 50;

/** Filter first over precomputed haystacks, newest first, capped. Empty query lists recent chats. */
export function searchLocal(entries: readonly ConversationEntry[], query: string, harnessName: (id: string) => string, limit = LOCAL_SEARCH_LIMIT): LocalSearchEntry[] {
  const terms = searchTerms(query);
  const out: LocalSearchEntry[] = [];
  for (const entry of entries) {
    const indexed = localSearchEntry(entry, harnessName(entry.harness));
    if (terms.every(term => indexed.hay.includes(term))) out.push(indexed);
  }
  out.sort((a, b) => b.entry.updatedAt - a.entry.updatedAt);
  return out.length > limit ? out.slice(0, limit) : out;
}

// ---- row models ------------------------------------------------------------

export interface SearchSegment { text: string; hit: boolean }

/** Everything a search row renders, precomputed. Rows never read a Conversation. */
export interface SearchRowModel {
  key: string;
  kind: SearchResult["kind"];
  title: string;
  meta: string | null;
  subtitle: string;
  segments: SearchSegment[];
  kindLabel: string;
  avatarName: string;
  harnessId?: string;
  effortId?: string;
  stateId?: string;
  icon?: "file-text" | "message-circle" | "tool";
  stale: boolean;
  conversationId?: string;
  summary?: ChatSummary;
  /** The global search result this row came from (bots, products, harnesses …). */
  result?: SearchResult;
}

/** Split a snippet into plain and highlighted runs. Bad or overlapping ranges are clamped. */
export function snippetSegments(snippet: string, highlights: readonly SearchHighlight[]): SearchSegment[] {
  const ranges = highlights
    .map(h => ({ start: Math.max(0, Math.min(snippet.length, h.start)), end: Math.max(0, Math.min(snippet.length, h.end)) }))
    .filter(h => h.end > h.start)
    .sort((a, b) => a.start - b.start);
  const out: SearchSegment[] = [];
  let at = 0;
  for (const range of ranges) {
    const start = Math.max(range.start, at);
    if (range.end <= start) continue;
    if (start > at) out.push({ text: snippet.slice(at, start), hit: false });
    out.push({ text: snippet.slice(start, range.end), hit: true });
    at = range.end;
  }
  if (at < snippet.length || out.length === 0) out.push({ text: snippet.slice(at), hit: false });
  return out;
}

/** Case-insensitive term highlights for local rows (no server snippet). */
export function termHighlights(text: string, terms: readonly string[]): SearchHighlight[] {
  const lower = text.toLowerCase();
  const out: SearchHighlight[] = [];
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at >= 0) out.push({ start: at, end: at + term.length });
  }
  return out;
}

const conversationModels = new WeakMap<Conversation, { harnessName: string; model: SearchRowModel }>();

/** Built once per conversation revision (lastAssistantState included). */
export function conversationRowModel(c: Conversation, harnessName: string, subtitle: string, key = `conv:${c.id}`): SearchRowModel {
  const cached = conversationModels.get(c);
  if (cached && cached.harnessName === harnessName && cached.model.key === key && cached.model.subtitle === subtitle) return cached.model;
  const turnState = lastAssistantState(c.messages);
  const stale = c.stale === true;
  const model: SearchRowModel = {
    key, kind: "conversation", title: c.title || harnessName, meta: stale ? "ended" : timeAgo(c.updatedAt), subtitle,
    segments: [{ text: subtitle, hit: false }], kindLabel: c.viewOnly ? "Chat · view only" : "Chat", avatarName: harnessName, harnessId: c.harness,
    effortId: effortIdForTurn({ turnState }), stateId: runtimeStateFromTurn({ turnState }), stale, conversationId: c.id,
  };
  conversationModels.set(c, { harnessName, model });
  return model;
}

export function localRowModel(local: LocalSearchEntry, terms: readonly string[]): SearchRowModel {
  const base = conversationRowModel(local.entry.conversation, local.harnessName, local.entry.preview, local.entry.key);
  if (!terms.length) return base;
  const highlights = termHighlights(base.subtitle, terms);
  return highlights.length ? { ...base, segments: snippetSegments(base.subtitle, highlights) } : base;
}

export function hitRowModel(hit: ChatSearchHit, harnessName: string): SearchRowModel {
  const chat = hit.chat;
  return {
    key: chat.key, kind: "conversation", title: chat.title || harnessName, meta: timeAgo(hit.at ?? chat.lastActivityAt),
    subtitle: hit.snippet || chat.cwd || chat.hostName, segments: hit.snippet ? snippetSegments(hit.snippet, hit.highlights) : [{ text: chat.cwd || chat.hostName, hit: false }],
    kindLabel: chat.chatable ? `Chat · ${chat.hostName}` : `Chat · view only · ${chat.hostName}`, avatarName: harnessName, harnessId: chat.kind,
    stale: false, summary: chat,
  };
}

function resultTitle(item: SearchResult): string {
  switch (item.kind) {
    case "bot": return item.bot.name;
    case "conversation": return item.conversation.title || item.harnessName;
    case "product": return item.project.name;
    case "harness": return item.name;
    case "skill": return item.skill.name;
    case "plugin": return item.plugin.name;
    case "tool": return item.tool.name;
    case "file": return item.file.path;
  }
}

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  bot: "Bot", conversation: "Chat", product: "Product", harness: "Harness", skill: "Skill", plugin: "Plugin", tool: "Tool", file: "File",
};

/** Row model for a global (non-chat-index) result. */
export function resultRowModel(item: SearchResult): SearchRowModel {
  if (item.kind === "conversation") return { ...conversationRowModel(item.conversation, item.harnessName, item.subtitle, item.key), result: item };
  const meta = item.kind === "product" ? timeAgo(item.project.updatedAt)
    : item.kind === "bot" ? (item.bot.status === "running" ? "Running" : "Not running")
      : item.kind === "harness" ? (item.available ? "Available" : "Unavailable") : null;
  const avatarName = item.kind === "bot" ? item.bot.name : item.kind === "product" ? item.project.name : item.kind === "harness" ? item.name
    : item.kind === "skill" ? item.skill.name : item.kind === "plugin" ? item.plugin.name : item.kind === "tool" ? item.tool.name
      : item.file.path.split("/").pop() ?? item.file.path;
  const icon = item.kind === "file" ? "file-text" : item.kind === "bot" ? "message-circle" : item.kind === "tool" ? "tool" : undefined;
  return {
    key: item.key, kind: item.kind, title: resultTitle(item), meta, subtitle: item.subtitle, segments: [{ text: item.subtitle, hit: false }],
    kindLabel: KIND_LABEL[item.kind], avatarName, ...(item.kind === "harness" ? { harnessId: item.id, stateId: item.available ? "paused" : "stale" } : {}),
    ...(item.kind === "product" ? { stateId: runtimeStateFromOrchestra({ status: item.project.status, streaming: false }) } : {}),
    ...(icon ? { icon } : {}), stale: false, result: item,
  };
}

function sameModel(a: SearchRowModel, b: SearchRowModel): boolean {
  if (a === b) return true;
  if (a.key !== b.key || a.title !== b.title || a.meta !== b.meta || a.subtitle !== b.subtitle || a.kindLabel !== b.kindLabel || a.stale !== b.stale ||
    a.effortId !== b.effortId || a.stateId !== b.stateId || a.conversationId !== b.conversationId || (a.summary !== b.summary && !(a.summary && b.summary && sameSummary(a.summary, b.summary))) || a.result !== b.result ||
    a.segments.length !== b.segments.length) return false;
  return a.segments.every((s, i) => s.text === b.segments[i]?.text && s.hit === b.segments[i]?.hit);
}

/** Keep the previous object for rows whose content did not change, so memoized rows skip render. */
export function reuseRows(previous: ReadonlyMap<string, SearchRowModel>, next: readonly SearchRowModel[]): { rows: SearchRowModel[]; byKey: Map<string, SearchRowModel> } {
  const byKey = new Map<string, SearchRowModel>();
  const rows = next.map(row => {
    const old = previous.get(row.key);
    const kept = old && sameModel(old, row) ? old : row;
    byKey.set(kept.key, kept);
    return kept;
  });
  return { rows, byKey };
}

/**
 * Local hits first (they are on the phone), then remote hits for chats not already listed. A local
 * hit takes the remote message snippet when the server found one for the same chat.
 */
export function mergeSearch(local: readonly SearchRowModel[], remote: readonly ChatSearchHit[], harnessName: (id: string) => string): SearchRowModel[] {
  const hits = new Map<string, ChatSearchHit>();
  for (const hit of remote) if (!hits.has(hit.chat.key)) hits.set(hit.chat.key, hit);
  const seen = new Set<string>();
  const out: SearchRowModel[] = [];
  for (const row of local) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    const hit = hits.get(row.key);
    out.push(hit && hit.snippet ? { ...row, subtitle: hit.snippet, segments: snippetSegments(hit.snippet, hit.highlights) } : row);
  }
  for (const hit of remote) {
    if (seen.has(hit.chat.key)) continue;
    seen.add(hit.chat.key);
    out.push(hitRowModel(hit, harnessName(hit.chat.kind)));
  }
  return out;
}
