import type { HermesFetch } from "./hermes-session";

/**
 * One reply into an existing Hermes session over the native API's SSE endpoint
 * (`POST /api/sessions/{id}/chat/stream`). Deltas reach the phone as Hermes writes
 * them, tool steps show as status, and a long turn is never cut by a total timeout:
 * only silence (no frame and no keepalive) for `idleMs` ends it.
 */
export type HermesStreamSink = {
  delta(text: string): void;
  status(text: string): void;
};

export type HermesStreamResult = { text: string; sessionId: string; streamed: boolean };

export class HermesQueued extends Error {
  constructor() { super("Hermes queued this turn with its live owner. Refresh history; do not resend."); }
}

const IDLE_MS = 90_000;
const IDENTITY_TIMEOUT_MS = 4_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse complete SSE frames out of `buffer`; returns the frames and the unparsed tail. */
export function takeSseFrames(buffer: string): { frames: { event: string; data: unknown }[]; rest: string } {
  const frames: { event: string; data: unknown }[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith(":")) continue; // keepalive comment
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length === 0) continue;
    let parsed: unknown = data.join("\n");
    try { parsed = JSON.parse(data.join("\n")); } catch { /* plain text data */ }
    frames.push({ event, data: parsed });
  }
  return { frames, rest };
}

function toolLabel(data: Record<string, unknown>): string {
  const name = typeof data.tool_name === "string" ? data.tool_name : "a tool";
  const preview = typeof data.preview === "string" && data.preview.trim() ? ` · ${data.preview.trim().slice(0, 80)}` : "";
  return `Running ${name}${preview}`;
}

export async function streamHermesSession(options: {
  api: { url: string; key: string };
  sessionId: string;
  text: string;
  sink: HermesStreamSink;
  fetch?: HermesFetch;
  signal?: AbortSignal;
  idleMs?: number;
}): Promise<HermesStreamResult> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${options.api.key}` };
  const base = `${options.api.url.replace(/\/+$/, "")}/api/sessions/${encodeURIComponent(options.sessionId)}`;
  const identity = await fetchFn(base, { method: "GET", headers, signal: AbortSignal.any([AbortSignal.timeout(IDENTITY_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]) });
  const identityBody: unknown = identity.ok ? await identity.json() : undefined;
  if (!record(identityBody) || !record(identityBody.session) || identityBody.session.id !== options.sessionId) throw new Error("Hermes API does not own this profile/session. No send attempted.");

  const idle = new AbortController();
  const signal = AbortSignal.any([idle.signal, ...(options.signal ? [options.signal] : [])]);
  const idleMs = options.idleMs ?? IDLE_MS;
  let idleTimer = setTimeout(() => idle.abort(new Error("idle")), idleMs);
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => idle.abort(new Error("idle")), idleMs); };

  try {
    const response = await fetchFn(`${base}/chat/stream`, { method: "POST", headers: { ...headers, Accept: "text/event-stream" }, body: JSON.stringify({ message: options.text }), signal });
    if (response.status === 202) throw new HermesQueued();
    if (!response.ok) throw new Error(`Hermes API HTTP ${response.status}. No fallback attempted; the host may still own this session.`);
    if (!response.body) throw new Error("Hermes API returned no stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamed = "";
    let final: string | undefined;
    let sessionId = options.sessionId;
    let failure: string | undefined;
    let finished = false;
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) break;
      touch();
      buffer += decoder.decode(chunk.value, { stream: true });
      const { frames, rest } = takeSseFrames(buffer);
      buffer = rest;
      for (const { event, data } of frames) {
        const body = record(data) ? data : {};
        switch (event) {
          case "assistant.delta":
            if (typeof body.delta === "string" && body.delta) { streamed += body.delta; options.sink.delta(body.delta); }
            break;
          case "tool.started":
            // Text Hermes wrote before a tool call is its own paragraph, not glued to the next.
            if (streamed && !streamed.endsWith("\n\n")) { const gap = streamed.endsWith("\n") ? "\n" : "\n\n"; streamed += gap; options.sink.delta(gap); }
            options.sink.status(toolLabel(body));
            break;
          case "tool.progress":
            if (body.tool_name === "_thinking") options.sink.status("Thinking");
            break;
          case "tool.completed":
          case "tool.failed":
            options.sink.status("");
            break;
          case "assistant.completed":
            if (typeof body.content === "string") final = body.content;
            if (typeof body.session_id === "string" && body.session_id) sessionId = body.session_id;
            break;
          case "run.failed":
            failure ??= typeof body.error === "string" ? body.error : "Hermes reported the turn failed.";
            break;
          case "run.cancelled":
            failure ??= "Hermes cancelled the turn.";
            break;
          case "error":
            failure = typeof body.message === "string" ? body.message : "Hermes stream error.";
            break;
          case "done":
            finished = true;
            break;
          default:
            break;
        }
      }
    }
    if (failure) throw new Error(`Hermes: ${failure}`);
    // A reply Hermes did not stream token by token still arrives once, whole.
    if (!streamed.trim() && final) options.sink.delta(final);
    const text = streamed.trim() ? streamed : final ?? "";
    if (!text.trim()) throw new Error("Hermes finished without a reply.");
    return { text, sessionId, streamed: Boolean(streamed.trim()) };
  } catch (error) {
    if (idle.signal.aborted && !options.signal?.aborted) throw new Error(`Hermes went quiet for ${Math.round(idleMs / 1000)}s. The reply may still land; refresh history before resending.`);
    throw error;
  } finally {
    clearTimeout(idleTimer);
  }
}
