import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { redact } from "./reply-parts";
import type { AgentInfo, HistoryMessage } from "../../shared/protocol";

// Persisted chats for every catalog harness Dash lists, read from AgentsView's
// unified archive. Hermes keeps its own native listing (hermes-sessions.ts);
// running OMP tabs keep their live rows and are de-duplicated by session id.
export const AGENTSVIEW_KINDS = ["omp", "codex", "claude", "grok"] as const;
const PER_KIND = 50; // parity with Hermes RECENT_LIMIT; the phone keeps adopted rows
const HISTORY_LIMIT = 400;
export const AGENTSVIEW_PREFIX = "av:";

type Row = { id: string; agent: string; project: string; cwd: string | null; title: string | null;
  started_at: string | null; ended_at: string | null; message_count: number };

export function agentsviewPath(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.DASH_AGENTSVIEW === "0") return undefined;
  const path = env.DASH_AGENTSVIEW_DB ?? join(homedir(), ".agentsview", "sessions.db");
  return existsSync(path) ? path : undefined;
}

/** Strip AgentsView's "<agent>:" prefix to recover the harness-native session id. */
export function nativeSessionId(agent: string, id: string): string {
  return id.startsWith(`${agent}:`) ? id.slice(agent.length + 1) : id;
}

function stamp(value: string | null): number { return value ? Date.parse(value) || 0 : 0; }

function title(row: Row): string {
  const line = (row.title ?? "").split("\n").map(s => s.trim()).find(s => s.length > 0);
  return (line ?? row.project ?? row.agent).slice(0, 80);
}

export function agentsviewRow(row: Row): AgentInfo {
  const sessionId = nativeSessionId(row.agent, row.id);
  return {
    id: `${AGENTSVIEW_PREFIX}${row.agent}:${sessionId}`,
    name: title(row),
    kind: row.agent,
    status: "available",
    detail: row.cwd ?? row.project,
    ...(row.cwd ? { cwd: row.cwd } : {}),
    sessionId,
    lastActivityAt: stamp(row.ended_at) || stamp(row.started_at),
    messageCount: row.message_count,
    source: "agentsview",
  };
}

let handle: { path: string; db: Database } | undefined;
function open(path: string): Database {
  if (handle?.path !== path) {
    handle?.db.close();
    handle = { path, db: new Database(path, { readonly: true }) };
  }
  return handle.db;
}

/** Owner conversations only: no automated or SDK runs, subagents, forks, deleted or one-shot transcripts. */
export function agentsviewSessions(exclude: Set<string> = new Set(), path = agentsviewPath()): AgentInfo[] {
  if (!path) return [];
  try {
    const db = open(path);
    const query = db.query<Row, [string, number]>(
      `select id, agent, project, cwd, coalesce(nullif(display_name,''), nullif(session_name,''), first_message) as title,
              started_at, ended_at, message_count
         from sessions
        where agent = ?1 and ifnull(is_automated,0) = 0 and parent_session_id is null and deleted_at is null
          and session_kind <> 'non-interactive' and entrypoint not like 'sdk%'
          and (user_message_count >= 2 or message_count >= 10)
        order by coalesce(ended_at, started_at) desc limit ?2`);
    return AGENTSVIEW_KINDS.flatMap(kind => query.all(kind, PER_KIND))
      .map(agentsviewRow)
      .filter(agent => !exclude.has(`${agent.kind}:${agent.sessionId}`));
  } catch {
    return [];
  }
}

export function agentsviewHistory(harness: string, sessionId: string, path = agentsviewPath()): HistoryMessage[] {
  if (!path || !(AGENTSVIEW_KINDS as readonly string[]).includes(harness)) return [];
  try {
    const rows = open(path).query<{ id: number; role: string; content: string; timestamp: string | null }, [string, string, number]>(
      `select id, role, content, timestamp from messages
        where session_id in (?1, ?2) and ifnull(is_system,0) = 0 and role in ('user','assistant') and length(content) > 0
        order by ordinal desc limit ?3`).all(`${harness}:${sessionId}`, sessionId, HISTORY_LIMIT);
    return rows.reverse().map(row => ({
      id: `av:${row.id}`,
      role: row.role === "user" ? "user" : "assistant",
      text: redact(row.content),
      at: stamp(row.timestamp),
    }));
  } catch {
    return [];
  }
}
