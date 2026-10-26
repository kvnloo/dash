import { Database } from "bun:sqlite";
import { hostname } from "node:os";
import { isCatalogHarness } from "../../../shared/catalog";
import { MESSAGE_TEXT_MAX, type HistoryMessage } from "../../../shared/protocol";
import { redact } from "../reply-parts";
import { AGENTSVIEW_PREFIX, nativeSessionId } from "../agentsview-sessions";
import { firstLine, SELF_HOST, SNIPPET_SOURCE_MAX } from "./query";
import { internalKey, type NewChatRow, type Sidecar } from "./sidecar";

// Read-only AgentsView access. Runs only inside a chat-index worker, never on the
// bridge event loop. Every query is bounded by an index-driven LIMIT.

export const AV_BATCH = 500;

/** Owner conversations only; unary + keeps the planner on idx_sessions_ended. Hermes is listed natively. */
export const OWNER_FILTER = `+ifnull(is_automated,0) = 0 and parent_session_id is null and deleted_at is null
  and session_kind <> 'non-interactive' and entrypoint not like 'sdk%'
  and (+user_message_count >= 2 or +message_count >= 10) and agent <> 'hermes'`;

const FIELDS = `id, agent, project, cwd, machine,
  substr(coalesce(nullif(display_name,''), nullif(session_name,''), first_message),1,400) as title,
  started_at, ended_at, message_count`;

export interface AvSessionRow {
  id: string; agent: string; project: string | null; cwd: string | null; machine: string | null; title: string | null;
  started_at: string | null; ended_at: string | null; message_count: number; ok?: number;
}

export function openAgentsview(path: string): Database {
  const db = new Database(path, { readonly: true });
  db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=300;");
  return db;
}

function stamp(value: string | null): number { return value ? Date.parse(value) || 0 : 0; }

/** Names AgentsView may record for this machine. */
export function selfMachines(extra: string[] = []): Set<string> {
  const names = new Set(["local", "", ...extra.map(n => n.toLowerCase())]);
  const host = hostname().toLowerCase();
  names.add(host);
  names.add(host.split(".")[0] ?? host);
  return names;
}

function machineHost(machine: string | null, self: Set<string>): { host_id: string; host_name: string } {
  const raw = (machine ?? "").trim();
  const short = raw.toLowerCase().split(".")[0] ?? "";
  if (self.has(raw.toLowerCase()) || self.has(short)) return { host_id: SELF_HOST, host_name: "" };
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 56) || "unknown";
  return { host_id: `machine:${safe}`, host_name: /^[0-9a-f]{16,}$/i.test(raw) ? `Other machine (${raw.slice(0, 6)})` : raw };
}

export function avChatRow(row: AvSessionRow, self: Set<string>): NewChatRow {
  const sessionId = nativeSessionId(row.agent, row.id);
  const host = machineHost(row.machine, self);
  const title = redact(firstLine(row.title)) || firstLine(row.project) || row.agent;
  const r = {
    origin: "agentsview" as const, kind: row.agent, session_id: sessionId, ...host, profile_id: null,
    agent_id: `${AGENTSVIEW_PREFIX}${row.agent}:${sessionId}`, title, cwd: row.cwd || null,
    started_at: stamp(row.started_at), last_activity_at: stamp(row.ended_at) || stamp(row.started_at),
    message_count: row.message_count ?? 0, chatable: isCatalogHarness(row.agent) && host.host_id === SELF_HOST ? 1 : 0, src_id: row.id,
  };
  return { key: internalKey(r), ...r };
}

function hasEndedIndex(db: Database): boolean {
  return Boolean(db.query("select 1 from sqlite_master where type = 'index' and name = 'idx_sessions_ended'").get());
}
const indexHint = (db: Database) => (hasEndedIndex(db) ? "indexed by idx_sessions_ended" : "");

/** One incremental batch past (av.maxEnded, av.maxId). Returns rows read and rows changed. */
export function ingestBatch(db: Database, sidecar: Sidecar, self: Set<string>): { read: number; changed: number } {
  const maxEnded = sidecar.meta("av.maxEnded") ?? "";
  const maxId = sidecar.meta("av.maxId") ?? "";
  const rows = db.query<AvSessionRow, [string, string, number]>(`select ${FIELDS} from sessions ${indexHint(db)}
    where (ended_at > ?1 or (ended_at = ?1 and id > ?2)) and ${OWNER_FILTER}
    order by ended_at asc, id asc limit ?3`).all(maxEnded, maxId, AV_BATCH);
  const changed = sidecar.upsert(rows.map(row => avChatRow(row, self)));
  const last = rows[rows.length - 1];
  if (last?.ended_at) { sidecar.setMeta("av.maxEnded", last.ended_at); sidecar.setMeta("av.maxId", last.id); }
  return { read: rows.length, changed };
}

/**
 * One page of the reconcile walk over every session, descending keyset. Rows that pass the
 * owner filter are upserted and recorded in `seen`; NULL ended_at rows come in the final page.
 */
export function reconcilePage(db: Database, sidecar: Sidecar, self: Set<string>, seen: Set<string>, after: { e: string; i: string } | null | "nulls"): { next: { e: string; i: string } | null | "nulls" | "done"; changed: number } {
  let rows: AvSessionRow[];
  if (after === "nulls") {
    rows = db.query<AvSessionRow, []>(`select ${FIELDS}, (${OWNER_FILTER}) as ok from sessions where ended_at is null`).all();
  } else {
    const e = after?.e ?? "￿";
    const i = after?.i ?? "";
    rows = db.query<AvSessionRow, [string, string, number]>(`select ${FIELDS}, (${OWNER_FILTER}) as ok from sessions ${indexHint(db)}
      where ended_at is not null and (ended_at < ?1 or (ended_at = ?1 and id > ?2)) order by ended_at desc, id asc limit ?3`).all(e, i, AV_BATCH);
  }
  const keep = rows.filter(row => row.ok === 1).map(row => avChatRow(row, self));
  for (const row of keep) seen.add(row.key);
  const changed = sidecar.upsert(keep);
  if (after === "nulls") return { next: "done", changed };
  const last = rows[rows.length - 1];
  return { next: rows.length < AV_BATCH || !last?.ended_at ? "nulls" : { e: last.ended_at, i: last.id }, changed };
}

/** Cold-start list straight from AgentsView, (ended_at desc, id asc) keyset, while the sidecar builds. */
export function coldList(db: Database, self: Set<string>, after: { e: string; i: string } | undefined, limit: number): { rows: NewChatRow[]; raw: AvSessionRow[] } {
  const raw = db.query<AvSessionRow, [string, string, number]>(`select ${FIELDS} from sessions ${indexHint(db)}
    where ended_at is not null and (ended_at < ?1 or (ended_at = ?1 and id > ?2)) and ${OWNER_FILTER}
    order by ended_at desc, id asc limit ?3`).all(after?.e ?? "￿", after?.i ?? "", limit);
  return { rows: raw.map(row => avChatRow(row, self)), raw };
}

/** Find one owner-visible session by native id when the sidecar does not know it yet. */
export function lookupSession(db: Database, kind: string, sessionId: string): AvSessionRow | undefined {
  return db.query<AvSessionRow, [string, string, string]>(`select ${FIELDS} from sessions where id in (?1, ?2) and agent = ?3 and ${OWNER_FILTER} limit 1`)
    .get(`${kind}:${sessionId}`, sessionId, kind) ?? undefined;
}

export interface AvHistory { messages: (HistoryMessage & { ordinal: number })[]; hasMore: boolean }

/**
 * Newest `limit` user/assistant messages older than `before` (ordinal), chronological asc.
 * `cut` caps text at MESSAGE_TEXT_MAX and marks `truncated`; the legacy ws window passes false.
 */
export function avHistory(db: Database, ids: string[], before: number | undefined, limit: number, cut = true): AvHistory {
  const [a = "", b = a] = ids;
  const text = cut ? `substr(content, 1, ${MESSAGE_TEXT_MAX}) as content, length(content) > ${MESSAGE_TEXT_MAX} as cut` : "content, 0 as cut";
  const rows = db.query<{ id: number; role: string; content: string; cut: number; timestamp: string | null; ordinal: number }, [string, string, number, number]>(
    `select id, role, ${text}, timestamp, ordinal from messages
      where session_id in (?1, ?2) and ordinal < ?3 and ifnull(is_system,0) = 0 and role in ('user','assistant') and content_length > 0
      order by ordinal desc limit ?4`).all(a, b, before ?? Number.MAX_SAFE_INTEGER, limit + 1);
  const hasMore = rows.length > limit;
  return {
    hasMore,
    messages: rows.slice(0, limit).reverse().map(row => ({
      id: `av:${row.id}`, role: row.role === "user" ? "user" : "assistant", text: redact(row.content), at: stamp(row.timestamp), ordinal: row.ordinal,
      ...(row.cut ? { truncated: true } : {}),
    })),
  };
}

export function avMessage(db: Database, ids: string[], rowid: number): HistoryMessage | undefined {
  const [a = "", b = a] = ids;
  const row = db.query<{ id: number; role: string; content: string; timestamp: string | null }, [number, string, string]>(
    `select id, role, substr(content, 1, 1000000) as content, timestamp from messages
      where id = ?1 and session_id in (?2, ?3) and ifnull(is_system,0) = 0 and role in ('user','assistant')`).get(rowid, a, b);
  return row ? { id: `av:${row.id}`, role: row.role === "user" ? "user" : "assistant", text: redact(row.content), at: stamp(row.timestamp) } : undefined;
}

export interface FtsRow { rid: number; session_id: string; role: string; at: number }

export function hasTable(db: Database, name: string): boolean {
  return Boolean(db.query("select 1 from sqlite_master where name = ?").get(name));
}

/** One rowid-descending batch of message FTS hits below `below`. User/assistant, non-system only. */
export function avFtsBatch(db: Database, fts: string, below: number, limit: number): FtsRow[] {
  return db.query<{ rid: number; session_id: string; role: string; timestamp: string | null }, [string, number, number]>(
    `select f.rowid as rid, m.session_id, m.role, m.timestamp from messages_fts f join messages m on m.id = f.rowid
      where messages_fts match ?1 and f.rowid < ?2 and m.role in ('user','assistant') and ifnull(m.is_system,0) = 0
      order by f.rowid desc limit ?3`).all(fts, below, limit).map(row => ({ rid: row.rid, session_id: row.session_id, role: row.role, at: stamp(row.timestamp) }));
}

/**
 * Text of one hit for its snippet: a primary-key read of at most SNIPPET_SOURCE_MAX chars.
 * FTS5 snippet() cannot use `rowid = ?` together with MATCH, so it re-ran the whole match per hit.
 */
export function avContent(db: Database, rowid: number): string | undefined {
  return db.query<{ c: string }, [number, number]>("select substr(content, 1, ?2) as c from messages where id = ?1").get(rowid, SNIPPET_SOURCE_MAX)?.c ?? undefined;
}
