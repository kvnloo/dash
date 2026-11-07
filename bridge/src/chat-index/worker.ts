// Chat-index engine and Bun Worker entry. The engine owns every database handle
// (AgentsView and Hermes read-only; the sidecar read-write on worker 0, read-only
// on worker 1). The bridge event loop never touches these files; it talks to the
// engine through client.ts over {id, op, args} -> {id, ok, value|error}.
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import type { AgentInfo, ChatSearchHit, ChatSummary, HistoryMessage } from "../../../shared/protocol";
import { CURSOR_MAX_BYTES } from "../../../shared/protocol";
import { AGENTSVIEW_KINDS } from "../agentsview-sessions";
import { HermesSessions } from "../hermes-sessions";
import { redact } from "../reply-parts";
import {
  avContent, avFtsBatch, avHistory, avMessage, coldList, hasTable, ingestBatch, lookupSession, openAgentsview, reconcilePage,
  selfMachines, AV_BATCH, avChatRow, type FtsRow, type MachineNames,
} from "./agentsview-src";
import { HermesFts, hermesIngest, hermesReconcile } from "./hermes-src";
import {
  capSnippet, CursorError, cursorNumber, cursorString, decodeCursor, encodeCursor, hash, markersToHighlights, markSnippet, readCursor, RESPONSE_CAP_BYTES,
  sanitizeQuery, SEARCH_BATCH, SEARCH_BUDGET_MS, SEARCH_MAX_SCANNED, SELF_HOST, substringHighlights, type SanitizedQuery,
} from "./query";
import { Sidecar, summaryKey, toAgentInfo, toSummary, type ChatRow, type SelfInfo } from "./sidecar";

export interface EngineConfig {
  role: "primary" | "search";
  sidecarPath: string;
  /** Undefined disables every archive source (DASH_AGENTSVIEW=0 or no archive). */
  agentsviewPath?: string;
  hermesRoot?: string;
  /** Per catalog kind, for the hello roster head. */
  archiveHead?: number;
  /** Extra names AgentsView may use for this machine. */
  selfMachines?: string[];
  /** AgentsView machines whose Claude Code / Codex chats this bridge routes to (DASH_REMOTE_HOSTS). */
  remoteMachines?: string[];
  ingestEveryMs?: number;
  reconcileEveryMs?: number;
  hermesReconcileEveryMs?: number;
  /** Tests: do not start timers. */
  manual?: boolean;
}

export interface Snapshot { rev: number; head: AgentInfo[]; building: boolean }

export class EngineError extends Error {
  constructor(readonly code: "bad_request" | "bad_cursor" | "not_found" | "busy", readonly field?: string) { super(code); }
}

export interface ListArgs { limit: number; cursor?: string; fh: string; kinds: string[]; hosts: string[]; chatable: boolean; self: SelfInfo }
export interface ListValue { items: ChatSummary[]; next: string | null; rev: number; building: boolean }
export interface TitleArgs { q: string; qh: string; limit: number; after?: { t: number; k: string }; kinds: string[]; hosts: string[]; self: SelfInfo }
export interface TitleValue { hits: ChatSearchHit[]; keys: string[]; next: { t: number; k: string } | null; rev: number }
export type MsgPositions = { av?: number; hz?: Record<string, number> };
export interface MsgArgs { q: string; limit: number; positions: MsgPositions | "start"; exclude: string[]; /** `hash()` of the app-facing chat keys (summaryKey) earlier pages returned. */ excludeHashes?: string[]; kinds: string[]; hosts: string[]; self: SelfInfo; budgetMs?: number; maxScanned?: number }
export interface MsgValue { hits: ChatSearchHit[]; next: MsgPositions | null; partial: boolean; scanned: number }
export interface HistoryArgs { key?: string; kind?: string; sessionId?: string; host?: string; profile?: string; before?: string; limit: number; self: SelfInfo }
export interface WsHistoryArgs { kind: string; sessionId: string; limit?: number }

/** ws history keeps today's catalog-only rule; HTTP history serves any indexed kind. */
const WS_KINDS: ReadonlySet<string> = new Set(AGENTSVIEW_KINDS);
const yieldNow = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const MAX_TS = Number.MAX_SAFE_INTEGER;

export class ChatIndexEngine {
  private sidecarHandle: Sidecar | undefined;
  private avHandle: Database | null | undefined;
  readonly hermes: HermesSessions;
  private readonly fts: HermesFts;
  private readonly self: MachineNames;
  private lastIngest = 0;
  private ingesting: Promise<number> | undefined;
  private eligibleRev = -1;
  private eligibleMaps: { av: Map<string, ChatRow>; hz: Map<string, ChatRow> } = { av: new Map(), hz: new Map() };
  private timers: ReturnType<typeof setInterval>[] = [];
  onSnapshot: ((snapshot: Snapshot) => void) | undefined;

  constructor(readonly config: EngineConfig) {
    this.hermes = new HermesSessions(config.hermesRoot ? { root: config.hermesRoot } : {});
    this.fts = new HermesFts(this.hermes);
    this.self = selfMachines(config.selfMachines ?? [], config.remoteMachines ?? []);
  }

  get avEnabled(): boolean { return this.config.agentsviewPath !== undefined; }

  sidecar(): Sidecar {
    if (!this.sidecarHandle) {
      if (this.config.role === "search" && !existsSync(this.config.sidecarPath)) throw new EngineError("busy");
      this.sidecarHandle = Sidecar.open(this.config.sidecarPath, this.config.role === "search");
    }
    return this.sidecarHandle;
  }

  av(): Database | undefined {
    if (this.avHandle === undefined) {
      const path = this.config.agentsviewPath;
      try { this.avHandle = path && existsSync(path) ? openAgentsview(path) : null; } catch { this.avHandle = null; }
    }
    return this.avHandle ?? undefined;
  }

  building(): boolean { return this.avEnabled && this.av() !== undefined && this.sidecar().meta("av.built") !== "1"; }

  private excluded(): string[] { return this.avEnabled ? [] : ["agentsview"]; }

  // -- ingest (worker 0) ---------------------------------------------------

  /** Incremental pass: Hermes first (small, so cold lists can merge it), then AgentsView in yielding batches. */
  ingest(): Promise<number> {
    this.ingesting ??= (async () => {
      const sidecar = this.sidecar();
      let changed = 0;
      try { changed += await hermesIngest(this.hermes, sidecar, yieldNow); } catch { /* Hermes is optional */ }
      const db = this.av();
      if (db) {
        try {
          for (;;) {
            const batch = ingestBatch(db, sidecar, this.self);
            changed += batch.changed;
            if (batch.read < AV_BATCH) break;
            await yieldNow();
          }
          if (sidecar.meta("av.built") !== "1") { sidecar.setMeta("av.built", "1"); changed += 1; }
        } catch { /* archive busy or missing; retry next tick */ }
      }
      this.lastIngest = Date.now();
      if (changed > 0) sidecar.bumpRev();
      this.publish();
      return changed;
    })().finally(() => { this.ingesting = undefined; });
    return this.ingesting;
  }

  /** Full AgentsView walk: picks up NULL ended_at rows and marks deleted/automated/filtered rows gone. */
  async reconcileAgentsview(): Promise<number> {
    const db = this.av();
    if (!db) return 0;
    const sidecar = this.sidecar();
    const seen = new Set<string>();
    let changed = 0;
    let after: { e: string; i: string } | null | "nulls" = null;
    for (;;) {
      const page = reconcilePage(db, sidecar, this.self, seen, after);
      changed += page.changed;
      if (page.next === "done") break;
      after = page.next;
      await yieldNow();
    }
    changed += sidecar.markGoneExcept("agentsview", seen);
    if (changed > 0) { sidecar.bumpRev(); this.publish(); }
    return changed;
  }

  async reconcileHermes(): Promise<number> {
    const sidecar = this.sidecar();
    let changed = 0;
    try { changed = await hermesReconcile(this.hermes, sidecar, yieldNow); } catch { return 0; }
    if (changed > 0) { sidecar.bumpRev(); this.publish(); }
    return changed;
  }

  /** Boot: ingest, then reconcile; then timers. Never throws. */
  async start(): Promise<void> {
    // A warm sidecar serves the hello head at once, before this boot's ingest finishes.
    try { this.publish(); } catch { /* sidecar not ready; the ingest below publishes */ }
    await this.ingest().catch(() => 0);
    await this.reconcileAgentsview().catch(() => 0);
    await this.reconcileHermes().catch(() => 0);
    if (this.config.manual) return;
    const every = (ms: number, fn: () => Promise<unknown>) => { const t = setInterval(() => { void fn().catch(() => undefined); }, ms); this.timers.push(t); };
    every(this.config.ingestEveryMs ?? 15_000, () => this.ingest());
    every(this.config.reconcileEveryMs ?? 60 * 60_000, () => this.reconcileAgentsview());
    every(this.config.hermesReconcileEveryMs ?? 10 * 60_000, () => this.reconcileHermes());
  }

  /** A list whose revision is older than the ingest period triggers one (debounced by `ingesting`). */
  private maybeIngest(): void {
    if (this.config.role === "primary" && !this.config.manual && !this.ingesting && Date.now() - this.lastIngest > (this.config.ingestEveryMs ?? 15_000)) void this.ingest().catch(() => 0);
  }

  snapshot(): Snapshot {
    const sidecar = this.sidecar();
    const head = this.avEnabled ? sidecar.head(AGENTSVIEW_KINDS, this.config.archiveHead ?? 50).map(toAgentInfo) : [];
    return { rev: sidecar.rev(), head, building: this.building() };
  }

  private publish(): void { this.onSnapshot?.(this.snapshot()); }

  // -- list ------------------------------------------------------------------

  list(args: ListArgs): ListValue {
    this.maybeIngest();
    const sidecar = this.sidecar();
    let cursor: Record<string, unknown> | undefined;
    try { cursor = readCursor(args.cursor, "f", args.fh); } catch { throw new EngineError("bad_cursor", "cursor"); }
    const building = this.building();
    if (cursor?.c === 1 || (!cursor && building)) return this.coldPage(args, cursor);
    const t = cursorNumber(cursor?.t);
    const k = cursorString(cursor?.k);
    if (cursor && (t === undefined || k === undefined)) throw new EngineError("bad_cursor", "cursor");
    const rows = sidecar.list({ limit: args.limit, ...(t !== undefined && k !== undefined ? { after: { t, k } } : {}), kinds: args.kinds, hosts: args.hosts, chatable: args.chatable, excludeOrigins: this.excluded() });
    const page = capRows(rows.slice(0, args.limit), args.self);
    const more = rows.length > args.limit || page.items.length < Math.min(rows.length, args.limit);
    const last = page.rows[page.rows.length - 1];
    return { items: page.items, next: more && last ? encodeCursor({ v: 1, t: last.last_activity_at, k: last.key, f: args.fh }) : null, rev: sidecar.rev(), building };
  }

  /** While the sidecar is still building: AgentsView keyset merged with the (already ingested) Hermes rows. */
  private coldPage(args: ListArgs, cursor: Record<string, unknown> | undefined): ListValue {
    const sidecar = this.sidecar();
    const db = this.av();
    const n = args.limit;
    const avAfter = typeof cursor?.ae === "string" && typeof cursor.ai === "string" ? { e: cursor.ae, i: cursor.ai } : undefined;
    const hzT = cursorNumber(cursor?.ht);
    const hzK = cursorString(cursor?.hk);
    const avDone = cursor?.ax === 1 || !db;
    const hzDone = cursor?.hx === 1;
    const av = avDone || !db ? { rows: [], raw: [] } : coldList(db, this.self, avAfter, n + 1);
    const hz = hzDone ? [] : sidecar.list({ limit: n, ...(hzT !== undefined && hzK !== undefined ? { after: { t: hzT, k: hzK } } : {}), kinds: args.kinds, hosts: args.hosts, chatable: args.chatable, excludeOrigins: ["agentsview", "live"] });
    const kinds = new Set(args.kinds);
    const hosts = new Set(args.hosts);
    const passes = (row: { kind: string; host_id: string; chatable: number }) => (!kinds.size || kinds.has(row.kind)) && (!hosts.size || hosts.has(row.host_id)) && (!args.chatable || row.chatable === 1);
    const out: ChatRow[] = [];
    let ai = 0, hi = 0;
    while (out.length < n) {
      const a = av.rows[ai];
      const h = hz[hi];
      if (!a && !h) break;
      if (a && (!h || a.last_activity_at >= h.last_activity_at)) { ai++; if (passes(a)) out.push({ ...a, gone: 0 }); }
      else if (h) { hi++; out.push(h); }
    }
    const avExhausted = avDone || (av.raw.length < n + 1 && ai === av.rows.length);
    const hzExhausted = hzDone || (hz.length <= n && hi === hz.length);
    const lastAv = ai > 0 ? av.raw[ai - 1] : undefined;
    const lastHz = hi > 0 ? hz[hi - 1] : undefined;
    const next = avExhausted && hzExhausted ? null : encodeCursor({
      v: 1, f: args.fh, c: 1,
      ...(avExhausted ? { ax: 1 } : lastAv?.ended_at ? { ae: lastAv.ended_at, ai: lastAv.id } : avAfter ? { ae: avAfter.e, ai: avAfter.i } : {}),
      ...(hzExhausted ? { hx: 1 } : lastHz ? { ht: lastHz.last_activity_at, hk: lastHz.key } : hzT !== undefined && hzK !== undefined ? { ht: hzT, hk: hzK } : {}),
    });
    return { items: out.map(row => toSummary(row, args.self)), next, rev: sidecar.rev(), building: true };
  }

  // -- search ----------------------------------------------------------------

  titleSearch(args: TitleArgs): TitleValue {
    const sidecar = this.sidecar();
    const sanitized = sanitizeQuery(args.q);
    if (!sanitized) throw new EngineError("bad_request", "q");
    const q = args.q.trim();
    const rows = sidecar.titleSearch({
      limit: args.limit, ...(args.after ? { after: args.after } : {}), kinds: args.kinds, hosts: args.hosts, chatable: false, excludeOrigins: this.excluded(),
      trigram: q.length >= 3 ? sanitized.trigram : null, like: q,
    });
    const page = rows.slice(0, args.limit);
    const last = page[page.length - 1];
    return {
      hits: page.map(row => titleHit(row, sanitized, args.self)),
      keys: page.map(row => row.key),
      next: rows.length > args.limit && last ? { t: last.last_activity_at, k: last.key } : null,
      rev: sidecar.rev(),
    };
  }

  private eligible(): { av: Map<string, ChatRow>; hz: Map<string, ChatRow> } {
    const sidecar = this.sidecar();
    const rev = sidecar.rev();
    if (rev !== this.eligibleRev) { this.eligibleMaps = sidecar.eligible(); this.eligibleRev = rev; }
    return this.eligibleMaps;
  }

  /**
   * Message phase: rowid-descending FTS scans per source, merged by message time. Stops at `limit`
   * distinct chats, or the time budget, or the scanned-row budget (then `partial`). Positions resume
   * exactly after the last consumed row, so pages have no gaps or repeats.
   */
  msgSearch(args: MsgArgs, now: () => number = performance.now.bind(performance)): MsgValue {
    const sanitized = sanitizeQuery(args.q);
    if (!sanitized) throw new EngineError("bad_request", "q");
    const started = now();
    const budget = args.budgetMs ?? SEARCH_BUDGET_MS;
    const maxScanned = args.maxScanned ?? SEARCH_MAX_SCANNED;
    const { av: avEligible, hz: hzEligible } = this.eligible();
    const start = args.positions === "start";
    const positions = args.positions === "start" ? {} : args.positions;
    type Source = { id: string; fetch(below: number): FtsRow[]; content(rowid: number): string | undefined; chat(row: FtsRow): ChatRow | undefined; messageId(rowid: number): string; pos: number; buf: FtsRow[]; done: boolean };
    const sources: Source[] = [];
    const db = this.avEnabled ? this.av() : undefined;
    if (db && hasTable(db, "messages_fts") && (start || positions.av !== undefined)) {
      sources.push({
        id: "av", pos: start ? MAX_TS : positions.av ?? MAX_TS, buf: [], done: false,
        fetch: below => avFtsBatch(db, sanitized.fts, below, SEARCH_BATCH),
        content: rowid => avContent(db, rowid),
        chat: row => avEligible.get(row.session_id),
        messageId: rowid => `av:${rowid}`,
      });
    }
    for (const profile of this.fts.profiles()) {
      if (!start && positions.hz?.[profile.id] === undefined) continue;
      const hdb = this.fts.db(profile);
      if (!hdb) continue;
      const tri = sanitized.wantsTrigram && sanitized.trigram && hasTable(hdb, "messages_fts_trigram");
      const table = tri ? "messages_fts_trigram" : "messages_fts";
      const match = tri && sanitized.trigram ? sanitized.trigram : sanitized.fts;
      sources.push({
        id: profile.id, pos: start ? MAX_TS : positions.hz?.[profile.id] ?? MAX_TS, buf: [], done: false,
        fetch: below => this.fts.batch(hdb, table, match, below, SEARCH_BATCH),
        content: rowid => this.fts.content(hdb, rowid),
        chat: row => hzEligible.get(`${profile.id}:${row.session_id}`),
        messageId: rowid => `hz:${profile.id}:${rowid}`,
      });
    }
    const kinds = new Set(args.kinds);
    const hosts = new Set(args.hosts);
    const seen = new Set(args.exclude);
    const emitted = new Set(args.excludeHashes ?? []);
    const picked: { source: Source; row: FtsRow; chat: ChatRow }[] = [];
    let scanned = 0;
    let partial = false;
    const exhausted = (s: Source) => s.done && s.buf.length === 0;
    for (;;) {
      if (picked.length >= args.limit) break;
      if (now() - started > budget || scanned >= maxScanned) { partial = true; break; }
      for (const s of sources) {
        if (s.buf.length === 0 && !s.done) {
          try { s.buf = s.fetch(s.pos); } catch { s.buf = []; s.done = true; }
          if (s.buf.length < SEARCH_BATCH) s.done = true;
        }
      }
      let best: Source | undefined;
      for (const s of sources) { const head = s.buf[0]; if (head && (!best || head.at > (best.buf[0]?.at ?? -Infinity))) best = s; }
      if (!best) break;
      const row = best.buf.shift();
      if (!row) break;
      best.pos = row.rid;
      scanned++;
      const chat = best.chat(row);
      if (!chat || seen.has(chat.key) || (emitted.size > 0 && emitted.has(hash(summaryKey(chat, args.self))))) continue;
      if ((kinds.size && !kinds.has(chat.kind)) || (hosts.size && !hosts.has(chat.host_id))) continue;
      seen.add(chat.key);
      picked.push({ source: best, row, chat });
    }
    const live = sources.filter(s => !exhausted(s));
    const next: MsgPositions | null = live.length === 0 ? null : {
      ...(live.some(s => s.id === "av") ? { av: live.find(s => s.id === "av")?.pos ?? MAX_TS } : {}),
      hz: Object.fromEntries(live.filter(s => s.id !== "av").map(s => [s.id, s.pos])),
    };
    const hits: ChatSearchHit[] = picked.map(({ source, row, chat }) => {
      let text: string | undefined;
      try { text = source.content(row.rid); } catch { text = undefined; }
      // Redact the whole source before marking and windowing: a marker inside a secret, or a window
      // that cuts off a secret's prefix, would otherwise defeat the redaction patterns.
      const { snippet, highlights } = markersToHighlights(markSnippet(redact(text ?? ""), sanitized.needles));
      return { chat: toSummary(chat, args.self), field: "message", messageId: source.messageId(row.rid), role: row.role === "user" ? "user" : "assistant", at: row.at, snippet, highlights };
    });
    return { hits, next, partial: partial && next !== null, scanned };
  }

  // -- history -----------------------------------------------------------------

  /** Resolve an HTTP history target. Unknown, gone or foreign-host chats are not found. */
  private resolve(args: { key?: string; kind?: string; sessionId?: string; host?: string; profile?: string }): ChatRow | undefined {
    const sidecar = this.sidecar();
    let kind = args.kind;
    let sessionId = args.sessionId;
    let host = args.host ?? SELF_HOST;
    if (args.key) {
      const known = sidecar.get(args.key);
      if (known) return known;
      // Not listed (for example a chat Dash ran with claude -p or codex exec): an archived self chat is
      // still history-readable, so a ws history cursor always has a working HTTP continuation.
      const parsed = selfArchiveKey(args.key);
      if (!parsed) return undefined;
      ({ kind, sessionId } = parsed);
      host = SELF_HOST;
    } else {
      if (!kind || !sessionId) return undefined;
      const key = kind === "hermes" && args.profile ? `${host}:hermes:${sessionId}:${args.profile}` : `${host}:${kind}:${sessionId}`;
      const known = sidecar.get(key);
      if (known) return known;
    }
    const db = this.avEnabled ? this.av() : undefined;
    if (kind && sessionId && kind !== "hermes" && db) {
      const raw = lookupSession(db, kind, sessionId);
      if (raw) { const row = avChatRow(raw, this.self); if (row.host_id === host) return { ...row, gone: 0 }; }
    }
    return undefined;
  }

  async history(args: HistoryArgs): Promise<{ messages: HistoryMessage[]; before: string | null }> {
    const row = this.resolve(args);
    if (!row || (row.origin === "agentsview" && !this.avEnabled)) throw new EngineError("not_found");
    const cursor = args.before ? decodeCursor(args.before) : undefined;
    if (args.before && (!cursor || cursor.v !== 1)) throw new EngineError("bad_cursor", "before");
    if (row.origin === "hermes") {
      const t = cursorNumber(cursor?.t);
      const i = cursorNumber(cursor?.i);
      if (cursor && (t === undefined || i === undefined)) throw new EngineError("bad_cursor", "before");
      const page = await this.hermes.historyPage(row.profile_id ?? "default", row.session_id, t !== undefined && i !== undefined ? { t, i } : undefined, args.limit);
      if (!page) throw new EngineError("not_found");
      const kept = capMessages(page.messages);
      const oldest = kept[0];
      const before = kept.length < page.messages.length && oldest && /^\d+$/.test(oldest.id)
        ? { t: oldest.at / 1000, i: Number(oldest.id) } : page.before;
      return { messages: kept, before: before ? encodeCursor({ v: 1, t: before.t, i: before.i }) : null };
    }
    const db = this.av();
    if (!db) throw new EngineError("not_found");
    const o = cursorNumber(cursor?.o);
    if (cursor && o === undefined) throw new EngineError("bad_cursor", "before");
    const page = avHistory(db, [row.src_id, `${row.kind}:${row.session_id}`], o, args.limit);
    const kept = capMessages(page.messages);
    const oldest = kept[0];
    const more = page.hasMore || kept.length < page.messages.length;
    return { messages: kept.map(stripOrdinal), before: more && oldest ? encodeCursor({ v: 1, o: oldest.ordinal }) : null };
  }

  /** ws `history` for archived catalog chats. Without `limit`: today's 400-message window, uncut. */
  wsHistory(args: WsHistoryArgs): { messages: HistoryMessage[]; before: string | null } {
    const db = this.avEnabled ? this.av() : undefined;
    if (!db || !WS_KINDS.has(args.kind)) return { messages: [], before: null };
    const page = avHistory(db, [`${args.kind}:${args.sessionId}`, args.sessionId], undefined, args.limit ?? 400, args.limit !== undefined);
    const oldest = page.messages[0];
    return { messages: page.messages.map(stripOrdinal), before: page.hasMore && oldest ? encodeCursor({ v: 1, o: oldest.ordinal }) : null };
  }

  message(args: { key: string; id: string }): HistoryMessage {
    const row = this.resolve({ key: args.key });
    if (!row) throw new EngineError("not_found");
    if (row.origin === "agentsview") {
      const db = this.avEnabled ? this.av() : undefined;
      const match = /^av:(\d+)$/.exec(args.id);
      const message = db && match ? avMessage(db, [row.src_id, `${row.kind}:${row.session_id}`], Number(match[1])) : undefined;
      if (!message) throw new EngineError("not_found");
      return message;
    }
    const match = /^(?:hz:[A-Za-z0-9_-]+:)?(\d+)$/.exec(args.id);
    const message = match ? this.hermes.message(row.profile_id ?? "default", row.session_id, Number(match[1])) : undefined;
    if (!message) throw new EngineError("not_found");
    return message;
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.fts.close();
    this.avHandle?.close();
    this.avHandle = undefined;
    this.sidecarHandle?.close();
    this.sidecarHandle = undefined;
  }
}


/** `@self:<kind>:<sessionId>` (never Hermes, which is listed natively) -> its parts. */
function selfArchiveKey(key: string): { kind: string; sessionId: string } | undefined {
  const match = /^@self:([A-Za-z0-9_-]+):(.+)$/.exec(key);
  if (!match || match[1] === "hermes" || !match[1] || !match[2]) return undefined;
  return { kind: match[1], sessionId: match[2] };
}

function stripOrdinal<T extends HistoryMessage & { ordinal: number }>(message: T): HistoryMessage {
  const { ordinal: _ordinal, ...rest } = message;
  return rest;
}

/** Keep the newest messages that fit the response cap; chronological order is preserved. */
function capMessages<T extends HistoryMessage>(messages: T[]): T[] {
  let bytes = 64;
  let from = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) break;
    bytes += JSON.stringify(message).length + 1;
    if (bytes > RESPONSE_CAP_BYTES && from < messages.length) break;
    from = i;
  }
  return messages.slice(from);
}

function capRows(rows: ChatRow[], self: SelfInfo): { rows: ChatRow[]; items: ChatSummary[] } {
  let bytes = 64;
  const items: ChatSummary[] = [];
  const kept: ChatRow[] = [];
  for (const row of rows) {
    const item = toSummary(row, self);
    bytes += JSON.stringify(item).length + 1;
    if (bytes > RESPONSE_CAP_BYTES && items.length > 0) break;
    items.push(item);
    kept.push(row);
  }
  return { rows: kept, items };
}

function titleHit(row: ChatRow, q: SanitizedQuery, self: SelfInfo): ChatSearchHit {
  const inTitle = q.needles.some(n => row.title.toLowerCase().includes(n));
  const field = inTitle || !row.cwd ? "title" : "cwd";
  const text = field === "title" ? row.title : row.cwd ?? "";
  const { snippet, highlights } = capSnippet(text, substringHighlights(text, q.needles));
  return { chat: toSummary(row, self), field, snippet, highlights };
}

/**
 * Chats a search already returned, carried in its cursor as `hash()` values (newest last), so
 * message hits on later pages skip them. Capped: past the cap the oldest drop out.
 */
export const EMITTED_MAX = 256;

/** `prev` plus the hashes of `keys` not in it yet, keeping the newest EMITTED_MAX. */
export function withEmitted(prev: readonly string[], keys: readonly string[]): string[] {
  const out = prev.slice();
  const have = new Set(prev);
  for (const key of keys) {
    const h = hash(key);
    if (!have.has(h)) { have.add(h); out.push(h); }
  }
  return out.length > EMITTED_MAX ? out.slice(out.length - EMITTED_MAX) : out;
}

/**
 * Encode a search cursor carrying `emitted`. If it would pass CURSOR_MAX_BYTES (many Hermes
 * profiles), the oldest hashes drop until it fits: a dropped chat can repeat, never go missing.
 */
function searchCursor(fields: Record<string, unknown>, emitted: readonly string[]): string {
  let x = emitted;
  for (;;) {
    const text = encodeCursor(x.length ? { ...fields, x: x.join("") } : fields);
    if (text.length <= CURSOR_MAX_BYTES || x.length === 0) return text;
    x = x.slice(Math.ceil(x.length / 2));
  }
}

export function titleCursor(qh: string, after: { t: number; k: string }, emitted: readonly string[] = []): string {
  return searchCursor({ v: 1, q: qh, ph: "title", t: after.t, tk: after.k }, emitted);
}

export function msgCursor(qh: string, positions: MsgPositions | "start", emitted: readonly string[] = []): string {
  return searchCursor(positions === "start" ? { v: 1, q: qh, ph: "msg", s: 1 } : { v: 1, q: qh, ph: "msg", ...(positions.av !== undefined ? { av: positions.av } : {}), ...(positions.hz && Object.keys(positions.hz).length ? { hz: positions.hz } : {}) }, emitted);
}

export type SearchCursor = ({ ph: "title"; after: { t: number; k: string } } | { ph: "msg"; positions: MsgPositions | "start" }) & { emitted: string[] };

function readEmitted(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value !== "string" || value.length % 8 !== 0 || value.length > EMITTED_MAX * 8 || !/^[0-9a-f]*$/.test(value)) throw new EngineError("bad_cursor", "cursor");
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 8) out.push(value.slice(i, i + 8));
  return out;
}

/** Decode a search cursor bound to `qh`. */
export function readSearchCursor(cursor: string | undefined, qh: string): SearchCursor | undefined {
  let value: Record<string, unknown> | undefined;
  try { value = readCursor(cursor, "q", qh); } catch (error) { if (error instanceof CursorError) throw new EngineError("bad_cursor", "cursor"); throw error; }
  if (!value) return undefined;
  const emitted = readEmitted(value.x);
  if (value.ph === "title") {
    const t = cursorNumber(value.t);
    const k = cursorString(value.tk);
    if (t === undefined || k === undefined) throw new EngineError("bad_cursor", "cursor");
    return { ph: "title", after: { t, k }, emitted };
  }
  if (value.ph !== "msg") throw new EngineError("bad_cursor", "cursor");
  if (value.s === 1) return { ph: "msg", positions: "start", emitted };
  const av = cursorNumber(value.av);
  const hz: Record<string, number> = {};
  if (value.hz !== undefined) {
    if (typeof value.hz !== "object" || value.hz === null || Array.isArray(value.hz)) throw new EngineError("bad_cursor", "cursor");
    for (const [profile, id] of Object.entries(value.hz)) { const n = cursorNumber(id); if (n === undefined || !/^[A-Za-z0-9_-]{1,64}$/.test(profile)) throw new EngineError("bad_cursor", "cursor"); hz[profile] = n; }
  }
  return { ph: "msg", positions: { ...(av !== undefined ? { av } : {}), hz }, emitted };
}

// -- Bun Worker entry -----------------------------------------------------------

export type WorkerOp =
  | { op: "init"; args: EngineConfig }
  | { op: "list"; args: ListArgs }
  | { op: "titleSearch"; args: TitleArgs }
  | { op: "msgSearch"; args: MsgArgs }
  | { op: "history"; args: HistoryArgs }
  | { op: "wsHistory"; args: WsHistoryArgs }
  | { op: "message"; args: { key: string; id: string } }
  | { op: "snapshot"; args: null }
  | { op: "ingest"; args: null }
  /** Tests only: block the worker thread for `args` ms. */
  | { op: "stall"; args: number };
export type WorkerRequest = WorkerOp & { id: number };
export type WorkerReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; code: string; field?: string; message: string } | { type: "snapshot"; snapshot: Snapshot };

/** Dispatch one RPC to an engine. Exposed for tests; the worker loop below is a thin wrapper. */
export async function dispatch(engine: ChatIndexEngine, request: Exclude<WorkerOp, { op: "init" }>): Promise<unknown> {
  switch (request.op) {
    case "list": return engine.list(request.args);
    case "titleSearch": return engine.titleSearch(request.args);
    case "msgSearch": return engine.msgSearch(request.args);
    case "history": return engine.history(request.args);
    case "wsHistory": return engine.wsHistory(request.args);
    case "message": return engine.message(request.args);
    case "snapshot": return engine.snapshot();
    case "ingest": return engine.ingest();
    case "stall": { const until = Date.now() + request.args; while (Date.now() < until) { /* test-only busy wait */ } return true; }
  }
}

declare const self: Worker;
if (!Bun.isMainThread) {
  let engine: ChatIndexEngine | undefined;
  const post = (message: WorkerReply) => self.postMessage(message);
  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;
    const id = request.id;
    try {
      if (request.op === "init") {
        engine = new ChatIndexEngine(request.args);
        engine.onSnapshot = snapshot => post({ type: "snapshot", snapshot });
        if (request.args.role === "primary") void engine.start();
        post({ id, ok: true, value: true });
        return;
      }
      if (!engine) throw new EngineError("busy");
      post({ id, ok: true, value: await dispatch(engine, request) });
    } catch (error) {
      if (error instanceof EngineError) post({ id, ok: false, code: error.code, ...(error.field ? { field: error.field } : {}), message: error.message });
      else post({ id, ok: false, code: "internal", message: error instanceof Error ? error.message : String(error) });
    }
  };
}
