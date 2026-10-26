import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentInfo } from "../../shared/protocol";

// Persisted chats for every catalog harness Dash lists, from AgentsView's unified
// archive. The archive is read only by the chat-index workers (chat-index/): this
// module never opens it. The hello roster gets a short head per catalog kind from
// the workers' latest snapshot; the full list is served paged by GET /chats.
export const AGENTSVIEW_KINDS = ["omp", "codex", "claude", "grok"] as const;
export const AGENTSVIEW_PREFIX = "av:";

type Row = { id: string; agent: string; project: string; cwd: string | null; title: string | null;
  started_at: string | null; ended_at: string | null; message_count: number };

export function agentsviewPath(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.DASH_AGENTSVIEW === "0") return undefined;
  const path = env.DASH_AGENTSVIEW_DB ?? join(homedir(), ".agentsview", "sessions.db");
  return existsSync(path) ? path : undefined;
}

/** Hello roster head per catalog kind (DASH_ROSTER_ARCHIVE_HEAD, default 10). */
export function rosterArchiveHead(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.DASH_ROSTER_ARCHIVE_HEAD);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 200) : 10;
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

let head: AgentInfo[] = [];

/** Called by the chat-index client with each worker snapshot. */
export function setArchiveHead(rows: AgentInfo[]): void { head = rows; }

/**
 * The archived-chat head for the hello roster: the latest worker snapshot, in memory.
 * Synchronous and never blocking; empty until the first snapshot or when DASH_AGENTSVIEW=0.
 */
export function agentsviewSessions(exclude: Set<string> = new Set(), rows: AgentInfo[] = head, env: Record<string, string | undefined> = process.env): AgentInfo[] {
  if (env.DASH_AGENTSVIEW === "0") return [];
  return rows.filter(agent => !exclude.has(`${agent.kind}:${agent.sessionId}`));
}
