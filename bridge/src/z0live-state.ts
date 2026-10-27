import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
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

/** Newest session file by mtime; read-only, bounded tail, never the broker DB or its tokens. */
export function readZ0LiveState(dir = Z0LIVE_SESSIONS_DIR, now = Date.now() / 1000): Z0LiveState {
  try {
    let newest: { name: string; mtime: number } | undefined;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) continue;
      const mtime = statSync(join(dir, name)).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { name, mtime };
    }
    if (!newest) return Z0LIVE_OFF;
    return parseZ0LiveSession(newest.name.slice(0, -".jsonl".length), tail(join(dir, newest.name)), now);
  } catch { return Z0LIVE_OFF; }
}

export function z0liveStateHttp(request: Request, authorized: boolean, read: () => Z0LiveState = readZ0LiveState): Response | undefined {
  if (new URL(request.url).pathname !== "/z0live/state") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  return Response.json(read(), { headers: { "Cache-Control": "no-store" } });
}
