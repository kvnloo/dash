import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activityPhase, type SessionPhase } from "./hermes-phase";

/** One delegated worker of a Hermes session, status-only: title, phase and timing. Never transcript text. */
export type SessionWorker = {
  id: string;
  title: string;
  phase: SessionPhase["phase"];
  tool?: string;
  startedAt: number;
  lastActivityAt: number;
};

type Row = {
  id: string;
  source: string | null;
  title: string | null;
  cwd: string | null;
  parent_session_id: string | null;
  started_at: number | null;
  ended_at: number | null;
  last_activity_at: number | null;
  last_activity_description: string | null;
};

const LIVE_MS = 5 * 60_000;
const FRESH_MS = 90_000;

/** A headless run (sol-* unit) records its launching session in `<cwd>/PARENT_SESSION`. */
function launchedBy(cwd: string | null, read: (path: string) => string | undefined): string | undefined {
  if (!cwd) return undefined;
  return read(join(cwd, "PARENT_SESSION"))?.trim() || undefined;
}

function readFile(path: string): string | undefined {
  try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

/** Workers of `parentIds`: delegate_task children (parent_session_id) and headless runs whose
 * run dir names the parent. Live = not ended and active within 5 min. Sorted newest activity first. */
export function selectWorkers(rows: Row[], parentIds: Set<string>, now: number, read: (path: string) => string | undefined = readFile): SessionWorker[] {
  const out: SessionWorker[] = [];
  for (const row of rows) {
    if (parentIds.has(row.id) || row.ended_at) continue;
    const last = (row.last_activity_at ?? row.started_at ?? 0) * 1000;
    if (now - last > LIVE_MS) continue;
    const parent = row.parent_session_id ?? launchedBy(row.cwd, read);
    if (!parent || !parentIds.has(parent)) continue;
    const fresh = now - last < FRESH_MS;
    const phase = activityPhase(fresh ? row.last_activity_description : "", true);
    out.push({
      id: row.id,
      title: row.title?.trim() || row.cwd?.split("/").pop() || row.id.slice(0, 12),
      phase: phase.phase,
      ...(phase.tool ? { tool: phase.tool } : {}),
      startedAt: (row.started_at ?? 0) * 1000,
      lastActivityAt: last,
    });
  }
  return out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

export function readSessionWorkers(home: string, parentIds: string[], now = Date.now()): SessionWorker[] {
  let db: Database | undefined;
  try {
    db = new Database(join(home, "state.db"), { readonly: true });
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=100;");
    const since = Math.floor((now - LIVE_MS) / 1000);
    const rows = db.query<Row, [number]>(
      "SELECT id,source,title,cwd,parent_session_id,started_at,ended_at,last_activity_at,last_activity_description FROM sessions WHERE coalesce(last_activity_at,started_at) >= ? AND ended_at IS NULL LIMIT 200",
    ).all(since);
    return selectWorkers(rows, new Set(parentIds), now);
  } catch { return []; } finally { db?.close(); }
}

export function sessionWorkersHttp(request: Request, authorized: boolean, read: (profile: string, session: string) => SessionWorker[]): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== "/hermes/workers") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  const profile = url.searchParams.get("profile");
  const session = url.searchParams.get("session");
  if (!profile || !session || profile.length > 1024 || session.length > 256) return new Response("invalid identity", { status: 400 });
  return Response.json({ workers: read(profile, session) }, { headers: { "Cache-Control": "no-store" } });
}
