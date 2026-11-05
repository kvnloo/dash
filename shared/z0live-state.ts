/**
 * Read-only projection of the z0live broker's live call, parsed from the session JSONL the broker
 * appends (`sessions/SESSION_ID.jsonl`). Dependency-free; the bridge parses, the app validates.
 * Never carries tool arguments, results, tokens or audio: only phase, tool name and a short
 * transcript tail.
 */

export type Z0LivePhase = "connecting" | "listening" | "speaking" | "thinking" | "tool";
export type Z0LiveLine = { role: "user" | "assistant"; text: string };
export type Z0LiveState =
  | { live: false }
  | { live: true; sessionId: string; phase: Z0LivePhase; tool?: string; muted: boolean; transcript: Z0LiveLine[]; updated: number };

export const Z0LIVE_OFF: Z0LiveState = { live: false };
/** Heartbeats arrive every ~20 s; the broker itself flushes after 120 idle seconds. */
export const Z0LIVE_STALE_SECONDS = 60;
export const Z0LIVE_TAIL = 3;
export const Z0LIVE_LINE_MAX = 280;

const SESSION = /^[A-Za-z0-9_-]{1,128}$/;
const TOOL = /^[\w.:-]{1,64}$/;

type Event = { type: string; ts: number; text: string; data: Record<string, unknown> };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function event(line: string): Event | undefined {
  let value: unknown;
  try { value = JSON.parse(line); } catch { return undefined; }
  if (!record(value) || typeof value.type !== "string") return undefined;
  const ts = typeof value.ts === "number" ? value.ts : typeof value.ts === "string" ? Date.parse(value.ts) / 1000 : NaN;
  if (!Number.isFinite(ts)) return undefined;
  return { type: value.type, ts, text: typeof value.text === "string" ? value.text : "", data: record(value.data) ? value.data : {} };
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > Z0LIVE_LINE_MAX ? `${flat.slice(0, Z0LIVE_LINE_MAX - 1)}…` : flat;
}

/** Parse one session's JSONL tail. `now` is Unix seconds. */
export function parseZ0LiveSession(sessionId: string, jsonl: string, now: number): Z0LiveState {
  if (!SESSION.test(sessionId)) return Z0LIVE_OFF;
  let last = -Infinity;
  let ended = false;
  let connected = false;
  let floor: "user" | "assistant" | "quiet" = "quiet";
  let audio = false;
  let muted = false;
  const pending = new Map<string, string>();
  const transcript: Z0LiveLine[] = [];
  for (const line of jsonl.split("\n")) {
    const e = line.trim() ? event(line) : undefined;
    if (!e) continue;
    last = Math.max(last, e.ts);
    if (e.data.session_end === true) ended = true;
    const source = e.data.source;
    if (e.type === "app_state") {
      if (source === "session_ready") connected = false;
      if (source === "connected" || source === "active_session_heartbeat") connected = true;
      if (source === "session_end") ended = true;
      if (source === "output_audio_buffer.started") audio = true;
      if (source === "output_audio_buffer.stopped" || source === "output_audio_buffer.cleared") audio = false;
      if (source === "mute" && typeof e.data.muted === "boolean") muted = e.data.muted;
      const f = e.data.floor;
      if (f === "user" || f === "assistant" || f === "quiet") floor = f;
    } else if (e.type === "floor") {
      const s = e.data.state;
      if (s === "user" || s === "assistant" || s === "quiet") floor = s;
      connected = true;
    } else if (e.type === "tool_call") {
      const name = typeof e.data.name === "string" ? e.data.name : e.text;
      const id = typeof e.data.call_id === "string" ? e.data.call_id : typeof e.data.id === "string" || typeof e.data.id === "number" ? String(e.data.id) : name;
      if (TOOL.test(name)) pending.set(id, name);
      connected = true;
    } else if (e.type === "tool_result") {
      const name = typeof e.data.name === "string" ? e.data.name : "";
      const id = typeof e.data.call_id === "string" ? e.data.call_id : typeof e.data.id === "string" || typeof e.data.id === "number" ? String(e.data.id) : name;
      if (!pending.delete(id)) for (const [key, value] of pending) if (value === name) { pending.delete(key); break; }
    } else if ((e.type === "user_transcript" || e.type === "assistant_transcript") && e.text.trim()) {
      transcript.push({ role: e.type === "user_transcript" ? "user" : "assistant", text: clip(e.text) });
      if (transcript.length > Z0LIVE_TAIL) transcript.shift();
      connected = true;
    } else if (e.type === "cancel" || e.type === "barge_in") {
      pending.clear();
    }
  }
  if (ended || now - last > Z0LIVE_STALE_SECONDS || last - now > Z0LIVE_STALE_SECONDS) return Z0LIVE_OFF;
  const tool = [...pending.values()].at(-1);
  const awaiting = transcript.at(-1)?.role === "user";
  const phase: Z0LivePhase = !connected ? "connecting"
    : floor === "user" ? "listening"
    : floor === "assistant" || audio ? "speaking"
    : tool ? "tool"
    : awaiting ? "thinking"
    : "listening";
  return { live: true, sessionId, phase, ...(phase === "tool" && tool ? { tool } : {}), muted, transcript, updated: last };
}

/** Validate what the bridge sent; anything off-shape is "no call". */
export function parseZ0LiveState(value: unknown): Z0LiveState {
  if (!record(value) || value.live !== true) return Z0LIVE_OFF;
  const { sessionId, phase, tool, muted, transcript, updated } = value;
  if (typeof sessionId !== "string" || !SESSION.test(sessionId)) return Z0LIVE_OFF;
  if (phase !== "connecting" && phase !== "listening" && phase !== "speaking" && phase !== "thinking" && phase !== "tool") return Z0LIVE_OFF;
  if (typeof updated !== "number" || !Array.isArray(transcript)) return Z0LIVE_OFF;
  const lines: Z0LiveLine[] = [];
  for (const line of transcript.slice(-Z0LIVE_TAIL)) {
    if (record(line) && (line.role === "user" || line.role === "assistant") && typeof line.text === "string") lines.push({ role: line.role, text: clip(line.text) });
  }
  return { live: true, sessionId, phase, ...(phase === "tool" && typeof tool === "string" && TOOL.test(tool) ? { tool } : {}), muted: muted === true, transcript: lines, updated };
}
