import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseZ0LiveLanes, type Z0LiveLanes } from "../../shared/z0live-lanes";
import { parseZ0LiveSession, Z0LIVE_OFF, type Z0LiveState } from "../../shared/z0live-state";

export const Z0LIVE_SESSIONS_DIR = process.env.DASH_Z0LIVE_SESSIONS ?? "/mnt/zer0models/workspace/zer0/data/z0live/sessions";
const TAIL_BYTES = 64 * 1024;

function tail(path: string): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    // Drop a partial first line when the tail starts mid-record.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally { closeSync(fd); }
}

/** Newest session file by mtime: its id and bounded tail. Read-only, never the broker DB or its tokens. */
function newestSession(dir: string): { sessionId: string; jsonl: string } | undefined {
  let newest: { name: string; mtime: number } | undefined;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const mtime = statSync(join(dir, name)).mtimeMs;
    if (!newest || mtime > newest.mtime) newest = { name, mtime };
  }
  return newest ? { sessionId: newest.name.slice(0, -".jsonl".length), jsonl: tail(join(dir, newest.name)) } : undefined;
}

export function readZ0LiveState(dir = Z0LIVE_SESSIONS_DIR, now = Date.now() / 1000): Z0LiveState {
  try {
    const session = newestSession(dir);
    return session ? parseZ0LiveSession(session.sessionId, session.jsonl, now) : Z0LIVE_OFF;
  } catch { return Z0LIVE_OFF; }
}

/** Lanes attached to the newest session (DA-077); `now` rides along so the phone can show elapsed time without trusting its own clock. */
export function readZ0LiveLanes(dir = Z0LIVE_SESSIONS_DIR, now = Date.now() / 1000): Z0LiveLanes {
  try {
    const session = newestSession(dir);
    return session ? parseZ0LiveLanes(session.sessionId, session.jsonl, now) : { sessionId: "", lanes: [], updated: 0, now };
  } catch { return { sessionId: "", lanes: [], updated: 0, now }; }
}

export function z0liveStateHttp(request: Request, authorized: boolean, read: () => Z0LiveState = readZ0LiveState): Response | undefined {
  if (new URL(request.url).pathname !== "/z0live/state") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  return Response.json(read(), { headers: { "Cache-Control": "no-store" } });
}

export function z0liveLanesHttp(request: Request, authorized: boolean, read: () => Z0LiveLanes = readZ0LiveLanes): Response | undefined {
  if (new URL(request.url).pathname !== "/z0live/lanes") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  return Response.json(read(), { headers: { "Cache-Control": "no-store" } });
}
