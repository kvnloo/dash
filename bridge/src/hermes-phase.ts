import { Database } from "bun:sqlite";
import { join } from "node:path";

export type SessionPhase = { phase: "idle" | "thinking" | "tool" | "streaming" | "waiting-approval"; tool?: string; observed: boolean; source: "terminal" };
export const UNOBSERVED: SessionPhase = { phase: "idle", observed: false, source: "terminal" };

/** No transcript or tool arguments: only the gateway's status projection and execution metadata.
 * Activity stamps are rate limited by Hermes (60s). Do NOT infer work from message recency.
 */
export function activityPhase(description: unknown, busy: boolean): SessionPhase {
  if (!busy) return { phase: "idle", observed: true, source: "terminal" };
  const desc = typeof description === "string" ? description : "";
  const tool = /^(?:executing tool: |sequential tool running \(\d+s\): |Running )([\w.:-]+)(?:$|\s)/i.exec(desc)?.[1]
    ?? /^executing \d+ tools concurrently: ([\w.:-]+(?:, [\w.:-]+)*)$/i.exec(desc)?.[1];
  if (tool) return { phase: "tool", tool, observed: true, source: "terminal" };
  if (/^(?:waiting for (?:approval|clarification)|approval required|clarification required)/i.test(desc)) return { phase: "waiting-approval", observed: true, source: "terminal" };
  if (/^(?:streaming|generating response)/i.test(desc)) return { phase: "streaming", observed: true, source: "terminal" };
  return { phase: "thinking", observed: true, source: "terminal" };
}

export function readSessionPhase(home: string, sessionIds: string[], gatewayAlive: boolean, now = Date.now()): SessionPhase {
  if (!gatewayAlive) return UNOBSERVED;
  let db: Database | undefined;
  try {
    db = new Database(join(home, "state.db"), { readonly: true });
    db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=100;");
    for (const id of sessionIds) {
      const row = db.query<{ last_activity_at: number | null; last_activity_description: string | null }, [string]>("SELECT last_activity_at,last_activity_description FROM sessions WHERE id=?").get(id);
      if (!row) continue;
      let running: boolean | undefined;
      try {
        running = Boolean(db.query("SELECT 1 FROM worker_executions WHERE session_id=? AND status='running' LIMIT 1").get(id)) || Boolean(db.query("SELECT 1 FROM session_admissions WHERE target_session_id=? AND status='started' LIMIT 1").get(id));
      } catch { /* Older Hermes: bounded activity projection, never transcript inference. */ }
      // Classic gateway turns may not register a worker/admission. A label is cleared at turn
      // teardown. Bound orphaned labels after a crash; no stale tool names beyond a heartbeat.
      const fresh = typeof row.last_activity_at === "number" && now - row.last_activity_at * 1000 < 90_000 && now >= row.last_activity_at * 1000;
      if (running || (fresh && Boolean(row.last_activity_description))) return activityPhase(fresh ? row.last_activity_description : "", true);
    }
    return { phase: "idle", observed: true, source: "terminal" };
  } catch { return UNOBSERVED; } finally { db?.close(); }
}

export function sessionPhaseHttp(request: Request, authorized: boolean, read: (profile: string, session: string) => SessionPhase): Response | undefined {
  const url = new URL(request.url);
  if (url.pathname !== "/hermes/phase") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  const profile = url.searchParams.get("profile");
  const session = url.searchParams.get("session");
  if (!profile || !session || profile.length > 1024 || session.length > 256) return new Response("invalid identity", { status: 400 });
  return Response.json(read(profile, session), { headers: { "Cache-Control": "no-store" } });
}
