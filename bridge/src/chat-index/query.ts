// Pure helpers shared by the chat-index worker and the HTTP layer: cursor
// hashing, the FTS5 query sanitizer, and snippet/highlight conversion.
import { decodeCursor, encodeCursor, type SearchHighlight } from "../../../shared/protocol";

export { decodeCursor, encodeCursor };

/** Sidecar host id for this machine. Mapped to the public self id on output. */
export const SELF_HOST = "@self";
export const SNIPPET_MAX = 240;
/** Leading chars of a message read to build its snippet. */
export const SNIPPET_SOURCE_MAX = 65_536;
/** Extra chars read past a cut so a secret straddling it is still whole when redacted. */
export const REDACT_SLACK = 4096;
export const TITLE_MAX = 200;
export const SEARCH_BUDGET_MS = 120;
export const SEARCH_MAX_SCANNED = 2000;
export const SEARCH_BATCH = 200;
export const RESPONSE_CAP_BYTES = 512 * 1024;

/** 32-bit FNV-1a, hex. Stable across processes; used for cursor and ETag binding only. */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface ChatFilters { kinds: string[]; hosts: string[]; chatable?: boolean }

export function filterHash(filters: ChatFilters): string {
  return hash(JSON.stringify([[...filters.kinds].sort(), [...filters.hosts].sort(), filters.chatable === true]));
}

export function queryHash(q: string, filters: ChatFilters, scope: string): string {
  return hash(JSON.stringify([normalizeQuery(q), filterHash(filters), scope]));
}

export function normalizeQuery(q: string): string {
  return q.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "if", "in", "into", "is", "it",
  "no", "not", "of", "on", "or", "such", "that", "the", "their", "then", "there", "these", "they", "this", "to", "was",
]);

export interface SanitizedQuery {
  /** unicode61/porter FTS5 MATCH string: `"t1" "t2" … "tn"*`. */
  fts: string;
  terms: string[];
  /** Whitespace-split raw terms of 3+ chars, for trigram tables (title index, Hermes trigram). */
  trigram: string | null;
  /** True when a raw term of 3+ chars contains non-word characters (prefer the trigram table). */
  wantsTrigram: boolean;
  /** Lowercased raw terms for JS-side highlight offsets. */
  needles: string[];
}

function quote(term: string): string { return `"${term.replaceAll('"', '""')}"`; }

/** Null when no searchable term remains. Every value reaching MATCH comes from here. */
export function sanitizeQuery(q: string): SanitizedQuery | null {
  const text = q.normalize("NFC");
  let terms = text.split(/[\s\p{P}\p{S}]+/u).filter(t => t.length > 0 && t.length <= 64).slice(0, 8);
  const kept = terms.filter(t => !STOPWORDS.has(t.toLowerCase()));
  if (kept.length > 0) terms = kept;
  if (terms.length === 0) return null;
  const last = terms.length - 1;
  const fts = terms.map((t, i) => (i === last && t.length >= 3 ? `${quote(t)}*` : quote(t))).join(" ");
  const raw = text.split(/\s+/).filter(t => t.length > 0 && t.length <= 64).slice(0, 8);
  const tri = raw.filter(t => t.length >= 3);
  return {
    fts,
    terms,
    trigram: tri.length > 0 ? tri.map(quote).join(" ") : null,
    wantsTrigram: tri.some(t => /[^\p{L}\p{N}_]/u.test(t)),
    needles: [...new Set([...raw, ...terms].map(t => t.toLowerCase()))].sort((a, b) => b.length - a.length),
  };
}

/** Case-insensitive substring offsets of every needle in `text`, merged, sorted. */
export function substringHighlights(text: string, needles: string[]): SearchHighlight[] {
  const lower = text.toLowerCase();
  if (lower.length !== text.length) return [];
  const spans: SearchHighlight[] = [];
  for (const needle of needles) {
    if (!needle) continue;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) spans.push({ start: at, end: at + needle.length });
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: SearchHighlight[] = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (prev && span.start <= prev.end) prev.end = Math.max(prev.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

/**
 * Snippet source with \x01…\x02 around each needle, windowed on the first match (`…` marks a cut).
 * No match (a stemmed hit, or past SNIPPET_SOURCE_MAX): the start of the text, unmarked.
 * Callers pass already-redacted text (never raw: the window and markers can split a secret),
 * then convert markers with markersToHighlights.
 */
export function markSnippet(text: string, needles: string[], max = SNIPPET_MAX): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const usable = lower.length === flat.length ? needles.filter(Boolean) : [];
  let first = -1;
  for (const needle of usable) { const at = lower.indexOf(needle); if (at >= 0 && (first < 0 || at < first)) first = at; }
  let start = first < 0 ? 0 : Math.max(0, first - Math.floor(max / 3));
  if (start > 0) { const space = flat.indexOf(" ", start); if (space >= 0 && space < first) start = space + 1; }
  const lead = start > 0 ? "…" : "";
  const room = max - lead.length;
  const end = Math.min(flat.length, start + room);
  const window = flat.slice(start, end);
  const spans = first < 0 ? [] : substringHighlights(window, usable);
  let out = "";
  let at = 0;
  for (const span of spans) { out += window.slice(at, span.start) + "\x01" + window.slice(span.start, span.end) + "\x02"; at = span.end; }
  out += window.slice(at);
  return lead + out + (end < flat.length ? "…" : "");
}

/** Strip \x01…\x02 markers into offsets. A marker that redaction removed drops its highlight. */
export function markersToHighlights(marked: string, max = SNIPPET_MAX): { snippet: string; highlights: SearchHighlight[] } {
  let snippet = "";
  const highlights: SearchHighlight[] = [];
  let open = -1;
  for (const char of marked) {
    if (char === "\x01") { open = snippet.length; continue; }
    if (char === "\x02") { if (open >= 0 && snippet.length > open) highlights.push({ start: open, end: snippet.length }); open = -1; continue; }
    snippet += char === "\n" || char === "\r" || char === "\t" ? " " : char;
  }
  return capSnippet(snippet, highlights, max);
}

export function capSnippet(snippet: string, highlights: SearchHighlight[], max = SNIPPET_MAX): { snippet: string; highlights: SearchHighlight[] } {
  if (snippet.length <= max) return { snippet, highlights };
  const cut = snippet.slice(0, max - 1) + "…";
  return { snippet: cut, highlights: highlights.flatMap(h => (h.start >= max - 1 ? [] : [{ start: h.start, end: Math.min(h.end, max - 1) }])) };
}

/** First non-empty line, single-line, ≤ TITLE_MAX chars. */
export function firstLine(text: string | null | undefined, max = TITLE_MAX): string {
  const line = (text ?? "").split("\n").map(s => s.trim()).find(s => s.length > 0) ?? "";
  return line.slice(0, max);
}

export function cursorNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function cursorString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export class CursorError extends Error {}

/** Decode and bind a cursor to its query hash (`f` or `q`). Throws CursorError on mismatch. */
export function readCursor(cursor: string | undefined, field: "f" | "q", expected: string): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  const value = decodeCursor(cursor);
  if (!value || value.v !== 1 || value[field] !== expected) throw new CursorError("bad_cursor");
  return value;
}
