import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { findOmpJsonl } from "./roster";
import type { SessionWorker } from "./hermes-workers";
import { workersFromToolEvents } from "./transcript-workers";

/** Harnesses whose transcripts record subagent launches as tool calls (DF-046). */
export const TRANSCRIPT_HARNESSES = ["claude", "codex", "omp"] as const;
type TranscriptHarness = (typeof TRANSCRIPT_HARNESSES)[number];

const SESSION_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const TAIL_BYTES = 4 * 1024 * 1024;
const CODEX_DEPTH = 4;
/** A transcript untouched this long belongs to a dead or parked session: none of its calls are live. */
const QUIET_MS = 30 * 60_000;

export type TranscriptRoots = { home: string; claudeProjects: string; codexSessions: string; ompSessions: string };

export function transcriptRoots(env: Record<string, string | undefined>, home: string): TranscriptRoots {
  return {
    home,
    claudeProjects: join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "projects"),
    codexSessions: join(env.CODEX_HOME || join(home, ".codex"), "sessions"),
    ompSessions: join(env.PI_CODING_AGENT_DIR || join(home, ".omp", "agent"), "sessions"),
  };
}

function isHarness(value: string): value is TranscriptHarness {
  return TRANSCRIPT_HARNESSES.some(harness => harness === value);
}

function entries(dir: string): { name: string; dir: boolean }[] {
  try { return readdirSync(dir, { withFileTypes: true }).map(entry => ({ name: entry.name, dir: entry.isDirectory() })); }
  catch { return []; }
}

/** Claude Code: `<projects>/<encoded cwd>/<session>.jsonl`, one level deep. */
function claudePath(root: string, session: string): string | undefined {
  for (const project of entries(root)) {
    if (!project.dir) continue;
    if (entries(join(root, project.name)).some(file => !file.dir && file.name === `${session}.jsonl`)) return join(root, project.name, `${session}.jsonl`);
  }
  return undefined;
}

/** Codex: `<sessions>/YYYY/MM/DD/rollout-<stamp>-<session>.jsonl`. */
function codexPath(dir: string, session: string, depth = 0): string | undefined {
  for (const entry of entries(dir).sort((a, b) => b.name.localeCompare(a.name))) {
    if (entry.dir && depth < CODEX_DEPTH) {
      const hit = codexPath(join(dir, entry.name), session, depth + 1);
      if (hit) return hit;
    } else if (!entry.dir && entry.name.startsWith("rollout-") && entry.name.endsWith(`-${session}.jsonl`)) return join(dir, entry.name);
  }
  return undefined;
}

export function transcriptPath(harness: string, session: string, roots: TranscriptRoots): string | undefined {
  if (!isHarness(harness) || !SESSION_OK.test(session)) return undefined;
  if (harness === "claude") return claudePath(roots.claudeProjects, session);
  if (harness === "codex") return codexPath(roots.codexSessions, session);
  return findOmpJsonl(roots.ompSessions, session);
}

/** The newest 4 MiB of a JSONL transcript as raw parsed events; a partial first line is dropped. */
export function readRawToolEvents(path: string): unknown[] {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    const out: unknown[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* torn or non-JSON line */ }
    }
    return out;
  } catch { return []; } finally { if (fd !== undefined) closeSync(fd); }
}

/** Live subagents only: finished Task/Agent calls are history, not "working", and a quiet transcript has none. */
export function liveTranscriptWorkers(harness: string, session: string, roots: TranscriptRoots, now = Date.now()): SessionWorker[] {
  const path = transcriptPath(harness, session, roots);
  if (!path) return [];
  try { if (now - statSync(path).mtimeMs > QUIET_MS) return []; } catch { return []; }
  return workersFromToolEvents(readRawToolEvents(path), now).filter(worker => worker.phase !== "idle");
}

/** GET /chat/workers?harness=claude|codex|omp&session=<id>: status-only workers derived from tool events. */
export function chatWorkersHttp(request: Request, authorized: boolean, read: (harness: string, session: string) => SessionWorker[]): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== "/chat/workers") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  const harness = url.searchParams.get("harness") ?? "";
  const session = url.searchParams.get("session") ?? "";
  if (!isHarness(harness) || !SESSION_OK.test(session)) return new Response("invalid identity", { status: 400 });
  return Response.json({ workers: read(harness, session) }, { headers: { "Cache-Control": "no-store" } });
}
