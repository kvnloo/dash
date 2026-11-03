import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseZ0LiveSession, z0liveOrbPhase, Z0LIVE_OFF, type Z0LiveOrb, type Z0LiveState } from "../../shared/z0live-state";

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

function newestSession(dir: string): { id: string; jsonl: string } | undefined {
  let newest: { name: string; mtime: number } | undefined;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const mtime = statSync(join(dir, name)).mtimeMs;
    if (!newest || mtime > newest.mtime) newest = { name, mtime };
  }
  if (!newest) return undefined;
  return { id: newest.name.slice(0, -".jsonl".length), jsonl: tail(join(dir, newest.name)) };
}

/** Newest session file by mtime; read-only, bounded tail, never the broker DB or its tokens. */
export function readZ0LiveState(dir = Z0LIVE_SESSIONS_DIR, now = Date.now() / 1000): Z0LiveState {
  try {
    const s = newestSession(dir);
    return s ? parseZ0LiveSession(s.id, s.jsonl, now) : Z0LIVE_OFF;
  } catch { return Z0LIVE_OFF; }
}

/** What the over-any-app orb needs: liveness, orb phase and mute. No transcript, no tool names. */
export type Z0LiveOrbSnapshot = { live: boolean; orb: Z0LiveOrb; muted: boolean; sessionId?: string };
export const Z0LIVE_ORB_OFF: Z0LiveOrbSnapshot = { live: false, orb: "idle", muted: false };

export function readZ0LiveOrb(dir = Z0LIVE_SESSIONS_DIR, now = Date.now() / 1000): Z0LiveOrbSnapshot {
  try {
    const s = newestSession(dir);
    if (!s) return Z0LIVE_ORB_OFF;
    const state = parseZ0LiveSession(s.id, s.jsonl, now);
    if (!state.live) return Z0LIVE_ORB_OFF;
    return { live: true, orb: z0liveOrbPhase(s.id, s.jsonl, now), muted: state.muted, sessionId: state.sessionId };
  } catch { return Z0LIVE_ORB_OFF; }
}

export function z0liveStateHttp(request: Request, authorized: boolean, read: () => Z0LiveState = readZ0LiveState): Response | undefined {
  if (new URL(request.url).pathname !== "/z0live/state") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  return Response.json(read(), { headers: { "Cache-Control": "no-store" } });
}

export const Z0LIVE_EVENTS_POLL_MS = 500;
/** Well under the bridge's 180 s idle timeout, so an idle stream is never cut. */
export const Z0LIVE_EVENTS_HEARTBEAT_MS = 15_000;

/**
 * GET /z0live/events: server-sent events for the native orb service, which holds this stream
 * while Dash is backgrounded. One event type, `z0live`, carrying a full Z0LiveOrbSnapshot:
 * sent once on connect and again whenever live/orb/muted changes. A comment heartbeat keeps
 * the connection (and the client's read timeout) alive.
 */
export function z0liveEventsHttp(
  request: Request,
  authorized: boolean,
  read: () => Z0LiveOrbSnapshot = readZ0LiveOrb,
  pollMs = Z0LIVE_EVENTS_POLL_MS,
  heartbeatMs = Z0LIVE_EVENTS_HEARTBEAT_MS,
): Response | undefined {
  if (new URL(request.url).pathname !== "/z0live/events") return undefined;
  if (!authorized) return new Response("unauthorized", { status: 401 });
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

  const encoder = new TextEncoder();
  let timers: ReturnType<typeof setInterval>[] = [];
  const stop = () => { for (const t of timers) clearInterval(t); timers = []; };
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      let last = "";
      const send = (text: string) => {
        try { ctrl.enqueue(encoder.encode(text)); } catch { stop(); }
      };
      const check = () => {
        const snap = read();
        const key = JSON.stringify(snap);
        if (key === last) return;
        last = key;
        send(`event: z0live\ndata: ${key}\n\n`);
      };
      send(": z0live-events\n\n");
      check();
      timers = [setInterval(check, pollMs), setInterval(() => send(": heartbeat\n\n"), heartbeatMs)];
      request.signal.addEventListener("abort", stop);
    },
    cancel: stop,
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
