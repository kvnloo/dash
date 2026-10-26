// Temporary AgentsView and Hermes databases for chat-index tests. The subset
// schemas mirror the columns, indexes and FTS layout the bridge reads on groot.
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatIndexEngine, dispatch, type EngineConfig, type WorkerReply, type WorkerRequest } from "../../chat-index/worker";
import type { WorkerLike } from "../../chat-index/client";

export function tempDir(prefix = "dash-chat-index-"): string { return mkdtempSync(join(tmpdir(), prefix)); }

export interface AvSession {
  id: string; agent: string; project?: string; machine?: string; first_message?: string | null; display_name?: string | null;
  started_at?: string | null; ended_at?: string | null; message_count?: number; user_message_count?: number; parent_session_id?: string | null;
  deleted_at?: string | null; is_automated?: number; cwd?: string; entrypoint?: string; session_kind?: string;
}
export interface AvMessage { session_id: string; ordinal: number; role: string; content: string; timestamp?: string; is_system?: number }

export class AgentsviewFixture {
  readonly db: Database;
  constructor(readonly path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(`
      create table sessions (id text primary key, project text not null default '', machine text not null default 'local', agent text not null default 'claude',
        entrypoint text not null default '', session_kind text not null default '', first_message text, display_name text, session_name text,
        started_at text, ended_at text, message_count integer not null default 0, user_message_count integer not null default 0,
        parent_session_id text, deleted_at text, is_automated integer not null default 0, cwd text not null default '');
      create index idx_sessions_ended on sessions(ended_at desc, id);
      create index idx_sessions_started on sessions(started_at);
      create index idx_sessions_message_count on sessions(message_count);
      create index idx_sessions_user_message_count on sessions(user_message_count);
      create index idx_sessions_agent on sessions(agent);
      create table messages (id integer primary key, session_id text not null, ordinal integer not null, role text not null, content text not null,
        timestamp text, content_length integer not null default 0, is_system integer not null default 0, unique(session_id, ordinal));
      create index idx_messages_session_ordinal on messages(session_id, ordinal);
      create virtual table messages_fts using fts5(content, content='messages', content_rowid='id', tokenize='porter unicode61');
      create trigger messages_ai after insert on messages begin insert into messages_fts(rowid, content) values (new.id, new.content); end;
      create trigger messages_ad after delete on messages begin insert into messages_fts(messages_fts, rowid, content) values('delete', old.id, old.content); end;
      create trigger messages_au after update on messages begin
        insert into messages_fts(messages_fts, rowid, content) values('delete', old.id, old.content);
        insert into messages_fts(rowid, content) values (new.id, new.content); end;`);
  }
  session(s: AvSession): this {
    this.db.query(`insert or replace into sessions (id, project, machine, agent, entrypoint, session_kind, first_message, display_name, started_at, ended_at,
      message_count, user_message_count, parent_session_id, deleted_at, is_automated, cwd) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      s.id, s.project ?? "proj", s.machine ?? "local", s.agent, s.entrypoint ?? "", s.session_kind ?? "", s.first_message ?? null, s.display_name ?? null,
      s.started_at ?? "2026-10-01T00:00:00Z", s.ended_at === undefined ? "2026-10-01T01:00:00Z" : s.ended_at, s.message_count ?? 12, s.user_message_count ?? 3,
      s.parent_session_id ?? null, s.deleted_at ?? null, s.is_automated ?? 0, s.cwd ?? "/w");
    return this;
  }
  message(m: AvMessage): number {
    return Number(this.db.query("insert into messages (session_id, ordinal, role, content, timestamp, content_length, is_system) values (?,?,?,?,?,?,?)")
      .run(m.session_id, m.ordinal, m.role, m.content, m.timestamp ?? "2026-10-01T00:30:00Z", m.content.length, m.is_system ?? 0).lastInsertRowid);
  }
  close(): void { this.db.close(); }
}

export interface HzSession { id: string; source?: string; title?: string | null; started_at?: number; last_activity_at?: number | null; message_count?: number; cwd?: string | null; archived?: number; hidden?: number; parent_session_id?: string | null; end_reason?: string | null; model_config?: string | null }

export class HermesFixture {
  readonly db: Database;
  readonly path: string;
  constructor(readonly home: string) {
    mkdirSync(home, { recursive: true });
    this.path = join(home, "state.db");
    this.db = new Database(this.path, { create: true });
    this.db.exec(`
      create table sessions (id text primary key, source text not null, title text, started_at real not null, last_activity_at real, message_count integer default 0,
        cwd text, archived integer not null default 0, hidden integer not null default 0, parent_session_id text, end_reason text, model_config text, created_source text);
      create table messages (id integer primary key autoincrement, session_id text not null, role text not null, content text, tool_call_id text, tool_calls text,
        tool_name text, timestamp real not null, reasoning text, reasoning_content text, active integer not null default 1);
      create index idx_messages_session on messages(session_id, timestamp);
      create virtual table messages_fts using fts5(content);
      create virtual table messages_fts_trigram using fts5(content, tokenize='trigram');
      create trigger messages_fts_insert after insert on messages begin
        insert into messages_fts(rowid, content) values (new.id, coalesce(new.content, ''));
        insert into messages_fts_trigram(rowid, content) values (new.id, coalesce(new.content, '')); end;`);
  }
  session(s: HzSession): this {
    this.db.query(`insert or replace into sessions (id, source, title, started_at, last_activity_at, message_count, cwd, archived, hidden, parent_session_id, end_reason, model_config)
      values (?,?,?,?,?,?,?,?,?,?,?,?)`).run(s.id, s.source ?? "cli", s.title ?? null, s.started_at ?? 1_790_000_000, s.last_activity_at === undefined ? (s.started_at ?? 1_790_000_000) + 60 : s.last_activity_at,
      s.message_count ?? 4, s.cwd ?? null, s.archived ?? 0, s.hidden ?? 0, s.parent_session_id ?? null, s.end_reason ?? null, s.model_config ?? null);
    return this;
  }
  message(session_id: string, role: string, content: string, timestamp: number): number {
    return Number(this.db.query("insert into messages (session_id, role, content, timestamp) values (?,?,?,?)").run(session_id, role, content, timestamp).lastInsertRowid);
  }
  close(): void { this.db.close(); }
}

export function engineConfig(dir: string, over: Partial<EngineConfig> = {}): EngineConfig {
  return { role: "primary", sidecarPath: join(dir, "sidecar.db"), hermesRoot: join(dir, "hermes"), archiveHead: 10, selfMachines: ["groot"], manual: true, ...over };
}

/** Fixture-driven tests push bulk ingest through a lane; deadlines are tested with explicit small timeouts. */
export const TEST_RPC_TIMEOUT_MS = 30_000;

/** A WorkerLike that runs an engine in-process (async hop, like a real worker). */
export function inProcessWorker(base: Omit<EngineConfig, "role">): (role: EngineConfig["role"]) => WorkerLike {
  return () => {
    let engine: ChatIndexEngine | undefined;
    const worker: WorkerLike = {
      onmessage: null,
      postMessage(request: WorkerRequest) {
        void (async () => {
          let reply: WorkerReply;
          try {
            if (request.op === "init") {
              engine = new ChatIndexEngine({ ...base, ...request.args, manual: true });
              engine.onSnapshot = snapshot => worker.onmessage?.(new MessageEvent("message", { data: { type: "snapshot", snapshot } }));
              reply = { id: request.id, ok: true, value: true };
            } else if (!engine) reply = { id: request.id, ok: false, code: "busy", message: "busy" };
            else reply = { id: request.id, ok: true, value: await dispatch(engine, request) };
          } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "internal";
            const field = typeof error === "object" && error !== null && "field" in error && typeof error.field === "string" ? error.field : undefined;
            reply = { id: request.id, ok: false, code, ...(field ? { field } : {}), message: String(error) };
          }
          await Bun.sleep(0);
          worker.onmessage?.(new MessageEvent("message", { data: structuredClone(reply) }));
        })();
      },
      terminate() { engine?.stop(); },
    };
    return worker;
  };
}

/** A worker that accepts requests and never answers (a stalled scan). */
export function stalledWorker(log: WorkerRequest[] = []): WorkerLike {
  return {
    onmessage: null,
    postMessage(request: WorkerRequest) {
      log.push(request);
      if (request.op === "init") void Promise.resolve().then(() => this.onmessage?.(new MessageEvent("message", { data: { id: request.id, ok: true, value: true } })));
    },
    terminate() {},
  };
}
