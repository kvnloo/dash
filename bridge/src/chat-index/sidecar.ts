import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { chatKey, type AgentInfo, type ChatOrigin, type ChatSummary } from "../../../shared/protocol";
import { migrate } from "./schema";
import { SELF_HOST } from "./query";

// The bridge's own chat index. Worker 0 opens it read-write; worker 1 read-only.
// Holds summaries only (title/cwd/stamps/counts), never message content.

export interface ChatRow {
  key: string; origin: ChatOrigin; kind: string; session_id: string; host_id: string; host_name: string;
  profile_id: string | null; agent_id: string | null; title: string; cwd: string | null;
  started_at: number; last_activity_at: number; message_count: number; chatable: number; src_id: string; gone: number;
}
export type NewChatRow = Omit<ChatRow, "gone">;
export interface SelfInfo { id: string; name: string }
export interface ListOptions { limit: number; after?: { t: number; k: string }; kinds: string[]; hosts: string[]; chatable: boolean; excludeOrigins: string[] }

export function sidecarPath(env: Record<string, string | undefined> = process.env): string {
  if (env.DASH_CHAT_INDEX) return env.DASH_CHAT_INDEX;
  const state = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(state, "dash", "chat-index.db");
}

/** Internal sidecar key: self rows use the SELF_HOST placeholder so the public id may change freely. */
export function internalKey(row: { host_id: string; kind: string; session_id: string; profile_id?: string | null }): string {
  return chatKey({ hostId: row.host_id, kind: row.kind, sessionId: row.session_id, ...(row.profile_id ? { profileId: row.profile_id } : {}) });
}

/** The key the app sees for a row (`toSummary(row, self).key`). */
export function summaryKey(row: ChatRow, self: SelfInfo): string {
  const hostId = row.host_id === SELF_HOST ? self.id : row.host_id;
  return chatKey({ hostId, kind: row.kind, sessionId: row.session_id, ...(row.profile_id ? { profileId: row.profile_id } : {}) });
}

export function toSummary(row: ChatRow, self: SelfInfo): ChatSummary {
  const mine = row.host_id === SELF_HOST;
  const hostId = mine ? self.id : row.host_id;
  return {
    key: summaryKey(row, self),
    kind: row.kind, sessionId: row.session_id, hostId, hostName: mine ? self.name : row.host_name,
    ...(row.profile_id ? { profileId: row.profile_id } : {}), ...(row.agent_id ? { agentId: row.agent_id } : {}),
    title: row.title, ...(row.cwd ? { cwd: row.cwd } : {}), startedAt: row.started_at, lastActivityAt: row.last_activity_at,
    messageCount: row.message_count, origin: row.origin, chatable: row.chatable === 1,
  };
}

/** Roster-compatible row for the hello head (same ids the old app adopted). */
export function toAgentInfo(row: ChatRow): AgentInfo {
  return {
    id: row.agent_id ?? `av:${row.kind}:${row.session_id}`, name: row.title.slice(0, 80), kind: row.kind, status: "available",
    detail: row.cwd ?? row.kind, ...(row.cwd ? { cwd: row.cwd } : {}), sessionId: row.session_id,
    lastActivityAt: row.last_activity_at, messageCount: row.message_count, source: "agentsview",
  };
}

const COLUMNS = "key, origin, kind, session_id, host_id, host_name, profile_id, agent_id, title, cwd, started_at, last_activity_at, message_count, chatable, src_id";

export class Sidecar {
  private constructor(readonly db: Database) {}

  static open(path: string, readonly = false): Sidecar {
    if (readonly) {
      const db = new Database(path, { readonly: true });
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=300;");
      return new Sidecar(db);
    }
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path, { create: true, readwrite: true });
    migrate(db);
    return new Sidecar(db);
  }

  close(): void { this.db.close(); }

  meta(k: string): string | undefined {
    return this.db.query<{ v: string }, [string]>("select v from meta where k = ?").get(k)?.v ?? undefined;
  }
  setMeta(k: string, v: string): void {
    this.db.query("insert into meta(k, v) values (?, ?) on conflict(k) do update set v = excluded.v").run(k, v);
  }
  rev(): number { return Number(this.meta("rev") ?? "0") || 0; }
  bumpRev(): number { const rev = this.rev() + 1; this.setMeta("rev", String(rev)); return rev; }

  /** Insert or update; returns the number of rows that actually changed (revived rows count). */
  upsert(rows: NewChatRow[]): number {
    if (rows.length === 0) return 0;
    const stmt = this.db.query(`insert into chats (${COLUMNS}, gone) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
      on conflict(key) do update set origin=excluded.origin, kind=excluded.kind, session_id=excluded.session_id, host_id=excluded.host_id,
        host_name=excluded.host_name, profile_id=excluded.profile_id, agent_id=excluded.agent_id, title=excluded.title, cwd=excluded.cwd,
        started_at=excluded.started_at, last_activity_at=excluded.last_activity_at, message_count=excluded.message_count,
        chatable=excluded.chatable, src_id=excluded.src_id, gone=0
      where chats.gone <> 0 or chats.title is not excluded.title or chats.cwd is not excluded.cwd
        or chats.last_activity_at <> excluded.last_activity_at or chats.message_count <> excluded.message_count
        or chats.started_at <> excluded.started_at or chats.chatable <> excluded.chatable or chats.host_name is not excluded.host_name
        or chats.agent_id is not excluded.agent_id or chats.src_id <> excluded.src_id`);
    let changed = 0;
    this.db.transaction(() => {
      for (const r of rows) {
        changed += stmt.run(r.key, r.origin, r.kind, r.session_id, r.host_id, r.host_name, r.profile_id, r.agent_id, r.title, r.cwd,
          r.started_at, r.last_activity_at, r.message_count, r.chatable, r.src_id).changes;
      }
    })();
    return changed;
  }

  /** Mark rows of `origin` (optionally one Hermes profile) gone unless their key was seen. */
  markGoneExcept(origin: ChatOrigin, seen: Set<string>, profile?: string): number {
    let changed = 0;
    this.db.transaction(() => {
      this.db.exec("create temp table if not exists seen_keys(key text primary key); delete from seen_keys;");
      const add = this.db.query("insert or ignore into seen_keys(key) values (?)");
      for (const key of seen) add.run(key);
      changed = profile === undefined
        ? this.db.query("update chats set gone = 1 where origin = ? and gone = 0 and key not in (select key from seen_keys)").run(origin).changes
        : this.db.query("update chats set gone = 1 where origin = ? and profile_id = ? and gone = 0 and key not in (select key from seen_keys)").run(origin, profile).changes;
      this.db.exec("delete from seen_keys;");
    })();
    return changed;
  }

  markGone(keys: string[]): number {
    let changed = 0;
    const stmt = this.db.query("update chats set gone = 1 where key = ? and gone = 0");
    this.db.transaction(() => { for (const key of keys) changed += stmt.run(key).changes; })();
    return changed;
  }

  private where(opts: Omit<ListOptions, "limit" | "after">, alias = ""): { sql: string; args: (string | number)[] } {
    const p = alias ? `${alias}.` : "";
    const parts = [`${p}gone = 0`];
    const args: (string | number)[] = [];
    if (opts.excludeOrigins.length) { parts.push(`${p}origin not in (${opts.excludeOrigins.map(() => "?").join(",")})`); args.push(...opts.excludeOrigins); }
    if (opts.kinds.length) { parts.push(`${p}kind in (${opts.kinds.map(() => "?").join(",")})`); args.push(...opts.kinds); }
    if (opts.hosts.length) { parts.push(`${p}host_id in (${opts.hosts.map(() => "?").join(",")})`); args.push(...opts.hosts); }
    if (opts.chatable) parts.push(`${p}chatable = 1`);
    return { sql: parts.join(" and "), args };
  }

  /** Global keyset page: (last_activity_at desc, key asc). Returns limit+1 rows at most. */
  list(opts: ListOptions): ChatRow[] {
    const where = this.where(opts);
    const args = [...where.args];
    let keyset = "";
    if (opts.after) { keyset = " and (last_activity_at < ? or (last_activity_at = ? and key > ?))"; args.push(opts.after.t, opts.after.t, opts.after.k); }
    args.push(opts.limit + 1);
    return this.db.query<ChatRow, (string | number)[]>(`select * from chats where ${where.sql}${keyset} order by last_activity_at desc, key asc limit ?`).all(...args);
  }

  /** Title/cwd search. 3+ char terms use the trigram index; shorter queries a prefix/word LIKE. */
  titleSearch(opts: ListOptions & { trigram: string | null; like: string }): ChatRow[] {
    const where = this.where(opts, "c");
    const args: (string | number)[] = [];
    let sql: string;
    if (opts.trigram) {
      sql = `select c.* from chats_fts f join chats c on c.rowid = f.rowid where chats_fts match ? and ${where.sql}`;
      args.push(opts.trigram, ...where.args);
    } else {
      sql = `select c.* from chats c where (c.title like ? || '%' or c.title like '% ' || ? || '%') and ${where.sql}`;
      const like = opts.like.replace(/[%_]/g, "");
      args.push(like, like, ...where.args);
    }
    if (opts.after) { sql += " and (c.last_activity_at < ? or (c.last_activity_at = ? and c.key > ?))"; args.push(opts.after.t, opts.after.t, opts.after.k); }
    sql += " order by c.last_activity_at desc, c.key asc limit ?";
    args.push(opts.limit + 1);
    return this.db.query<ChatRow, (string | number)[]>(sql).all(...args);
  }

  get(key: string): ChatRow | undefined {
    return this.db.query<ChatRow, [string]>("select * from chats where key = ? and gone = 0").get(key) ?? undefined;
  }

  head(kinds: readonly string[], perKind: number): ChatRow[] {
    const stmt = this.db.query<ChatRow, [string, string, number]>("select * from chats where gone = 0 and origin = 'agentsview' and kind = ? and host_id = ? order by last_activity_at desc, key asc limit ?");
    return kinds.flatMap(kind => stmt.all(kind, SELF_HOST, perKind));
  }

  /** Eligible archive sessions for message search: source id -> sidecar row. */
  eligible(): { av: Map<string, ChatRow>; hz: Map<string, ChatRow> } {
    const av = new Map<string, ChatRow>();
    const hz = new Map<string, ChatRow>();
    for (const row of this.db.query<ChatRow, []>("select * from chats where gone = 0 and origin in ('agentsview','hermes')").all()) {
      (row.origin === "agentsview" ? av : hz).set(row.src_id, row);
    }
    return { av, hz };
  }

  count(): number { return this.db.query<{ n: number }, []>("select count(*) n from chats where gone = 0").get()?.n ?? 0; }
}
