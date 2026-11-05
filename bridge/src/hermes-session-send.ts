/**
 * Scoped z0bridge send-to-session transport for gateway-hosted Hermes turns.
 *
 * z0bridge PR #5 exposes /send with next_turn and steer (not steer_or_next).
 * This is deliberately separate from the older ACP /turns client and from the
 * native hermes-live fallback. Only preflight connection absence permits that fallback.
 * After attempting POST, every refusal or unknown outcome is final.
 */
import { readLocalCredential } from "./z0bridge-identity";
import { PartEmitter } from "./reply-parts";
import { TurnPhase } from "./turn-phase";
import type { LiveResult, LiveSink } from "./hermes-live";

export type HermesSendMode = "next_turn" | "steer";
export type SendDelivery = "queued" | "steered" | "started";
export type SendOptions = {
  profile: string;
  sessionId: string;
  text: string;
  mode: HermesSendMode;
  /** The bridge's existing chat-turn ID. Reuse it for retries, never generate a new one. */
  submissionId: string;
  sink: LiveSink;
  signal?: AbortSignal;
  delivery?(state: SendDelivery, explanation: string): void;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
};

type SendReceipt = { sendId: string; mode: HermesSendMode; accepted: SendDelivery; eventsUrl: string };
type SendEvent =
  | { seq: number; type: "status"; text: string }
  | { seq: number; type: "delta"; text: string }
  | { seq: number; type: "tool"; toolCallId: string; title?: string; status?: string }
  | { seq: number; type: "done"; stopReason: string }
  | { seq: number; type: "error"; code: string };

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loopbackUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") return undefined;
    return url.origin;
  } catch { return undefined; }
}

function validId(value: string, max = 128): boolean {
  return value.length > 0 && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function parseReceipt(value: unknown, mode: HermesSendMode): SendReceipt {
  if (!object(value) || typeof value.sendId !== "string" || !validId(value.sendId) ||
      value.mode !== mode || typeof value.eventsUrl !== "string" ||
      value.eventsUrl !== "/v1/sends/" + value.sendId + "/events" ||
      (mode === "steer" ? value.accepted !== "steered" : value.accepted !== "queued" && value.accepted !== "started")) {
    throw new Error("Invalid z0bridge send receipt; outcome unknown. Check session history before resending.");
  }
  const accepted: SendDelivery = value.accepted === "queued" ? "queued"
    : value.accepted === "steered" ? "steered" : "started";
  return { sendId: value.sendId, mode, accepted, eventsUrl: value.eventsUrl };
}

function parseEvent(text: string): SendEvent {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch {
    throw new Error("Invalid z0bridge send event; outcome unknown. Check session history.");
  }
  if (!object(raw) || typeof raw.seq !== "number" || !Number.isSafeInteger(raw.seq) || raw.seq < 1) {
    throw new Error("Invalid z0bridge send event sequence; outcome unknown. Check session history.");
  }
  switch (raw.type) {
    case "status":
    case "delta":
      if (typeof raw.text !== "string") break;
      return { seq: raw.seq, type: raw.type, text: raw.text };
    case "tool":
      if (typeof raw.toolCallId !== "string" || !raw.toolCallId || raw.toolCallId.length > 256 ||
          (raw.title !== undefined && typeof raw.title !== "string") ||
          (raw.status !== undefined && typeof raw.status !== "string")) break;
      return {
        seq: raw.seq, type: "tool", toolCallId: raw.toolCallId,
        ...(typeof raw.title === "string" ? { title: raw.title } : {}),
        ...(typeof raw.status === "string" ? { status: raw.status } : {}),
      };
    case "done":
      if (typeof raw.stopReason !== "string") break;
      return { seq: raw.seq, type: "done", stopReason: raw.stopReason };
    case "error":
      if (typeof raw.code !== "string" || !/^[a-z_]{1,64}$/.test(raw.code)) break;
      return { seq: raw.seq, type: "error", code: raw.code };
  }
  throw new Error("Invalid z0bridge send event; outcome unknown. Check session history.");
}

/** Stream SSE frames, including UTF-8/CRLF/chunk boundaries. Never buffer a full reply. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let fields: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(done ? undefined : value, { stream: !done });
      for (let cut = pending.indexOf("\n"); cut >= 0; cut = pending.indexOf("\n")) {
        const line = pending.slice(0, cut).replace(/\r$/, "");
        pending = pending.slice(cut + 1);
        if (line === "") {
          if (fields.length) yield fields.join("\n");
          fields = [];
          size = 0;
        } else if (line.startsWith("data:")) {
          const data = line.slice(5).replace(/^ /, "");
          size += data.length;
          if (size > 131_072) throw new Error("Oversized z0bridge send event; outcome unknown.");
          fields.push(data);
        }
      }
      if (pending.length > 131_072) throw new Error("Oversized z0bridge send event; outcome unknown.");
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function errorCode(response: Response): Promise<string> {
  try {
    const result: unknown = await response.json();
    if (object(result) && object(result.error) &&
        typeof result.error.code === "string" && /^[a-z_]{1,64}$/.test(result.error.code)) {
      return result.error.code;
    }
  } catch { /* refuse without reflecting response bodies */ }
  return "http_error";
}

async function preflight(fetcher: typeof fetch, base: string, signal?: AbortSignal): Promise<boolean> {
  let response: Response;
  try {
    response = await fetcher(base + "/v1/health", {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2_000)]) : AbortSignal.timeout(2_000),
    });
  } catch {
    if (signal?.aborted) throw new Error("z0bridge send cancelled before admission.");
    return false;
  }
  if (!response.ok) return false;
  let value: unknown;
  try { value = await response.json(); } catch { /* invalid service */ }
  if (!object(value) || value.name !== "z0bridge") {
    throw new Error("The configured send endpoint is not z0bridge; refusing to send.");
  }
  return true;
}

function assertSendInput(options: SendOptions): void {
  if (!validId(options.profile, 64) || !validId(options.sessionId, 128) ||
      !validId(options.submissionId) || !options.text.trim() ||
      options.text.length > 100_000 || options.text.trimStart().startsWith("/")) {
    throw new Error("Invalid Hermes send target, submission ID or text; nothing was sent.");
  }
}

/**
 * Returns undefined only for an unconfigured/disabled transport or for a daemon that cannot
 * be reached before POST. The owner can then choose the existing hermes-live fallback.
 * Any exception after a POST attempt means NO fallback and NO different submission ID.
 */
export async function sendViaZ0Bridge(options: SendOptions): Promise<LiveResult | undefined> {
  const env = options.env ?? process.env;
  if (env.DASH_Z0BRIDGE === "0") return undefined;
  const credentialFile = env.DASH_Z0BRIDGE_SEND_CREDENTIAL_FILE || env.DASH_Z0BRIDGE_CREDENTIAL_FILE;
  if (!credentialFile) return undefined;
  const base = loopbackUrl(env.DASH_Z0BRIDGE_URL || "http://127.0.0.1:4787");
  if (!base) throw new Error("z0bridge send requires a loopback HTTP endpoint; no fallback attempted.");
  assertSendInput(options);
  if (options.signal?.aborted) throw new Error("z0bridge send cancelled before admission.");
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!await preflight(fetcher, base, options.signal)) return undefined;
  // Fail closed when a running daemon has no correctly scoped private credential.
  const credential = readLocalCredential(credentialFile, ["hermes:session.send"]);
  if (!credential) throw new Error("Missing private Dash credential with hermes:session.send; no fallback attempted.");

  // A network error during POST can mean z0bridge accepted the send. Never resubmit via CLI.
  let admission: Response;
  try {
    admission = await fetcher(base + "/v1/sessions/hermes/" +
      encodeURIComponent(options.profile) + "/" + encodeURIComponent(options.sessionId) + "/send", {
      method: "POST", redirect: "error",
      headers: { authorization: "Bearer " + credential.credential, "content-type": "application/json" },
      body: JSON.stringify({ text: options.text, mode: options.mode, submissionId: options.submissionId }),
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("z0bridge send outcome unknown after POST; check session history before resending. No fallback attempted.");
  }
  if (admission.status !== 202) {
    const code = await errorCode(admission);
    throw new Error("z0bridge refused send (HTTP " + admission.status + ", " + code + "). No fallback attempted.");
  }
  let rawReceipt: unknown;
  try { rawReceipt = await admission.json(); } catch { /* outcome unknown */ }
  const receipt = parseReceipt(rawReceipt, options.mode);
  options.delivery?.(receipt.accepted, receipt.accepted === "steered"
    ? "Steered the running Hermes turn. Applied at its next tool boundary."
    : receipt.accepted === "started" ? "Next Hermes turn started." : "Queued for the next Hermes turn.");
  const phase = new TurnPhase(text => options.sink.status(text));
  const parts = new PartEmitter(part => options.sink.part?.(part));
  const knownTools = new Set<string>();
  const streamSignal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(30 * 60_000)])
    : AbortSignal.timeout(30 * 60_000);
  let after = 0;
  let streamed = "";
  let started = receipt.accepted === "started";
  // Reconnect ONLY the observer SSE, never POST /send. Last sequence is replay-deduped.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (streamSignal.aborted) throw new Error("Stopped following z0bridge; the accepted turn may still be running. Check history.");
    let response: Response;
    try {
      response = await fetcher(base + receipt.eventsUrl + (after ? "?after=" + after : ""), {
        headers: { authorization: "Bearer " + credential.credential, accept: "text/event-stream",
          ...(after ? { "last-event-id": String(after) } : {}) },
        redirect: "error", signal: streamSignal,
      });
    } catch {
      if (streamSignal.aborted) throw new Error("Stopped following z0bridge; the accepted turn may still be running. Check history.");
      continue;
    }
    if (!response.ok || !response.body) {
      const code = await errorCode(response);
      throw new Error("z0bridge send stream refused (HTTP " + response.status + ", " + code + "). No fallback attempted.");
    }
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
      throw new Error("z0bridge returned a non-SSE send stream; outcome unknown. Check history.");
    }
    for await (const data of sseData(response.body)) {
      const event = parseEvent(data);
      if (event.seq <= after) continue;
      if (event.seq !== after + 1) throw new Error("z0bridge send event gap; outcome unknown. Check session history.");
      after = event.seq;
      if (!started && options.mode === "next_turn" &&
          ((event.type === "status" && /^(starting|running)$/.test(event.text)) ||
           event.type === "delta" || event.type === "tool")) {
        started = true;
        options.delivery?.("started", "Next Hermes turn started.");
      }
      switch (event.type) {
        case "status":
          if (event.text === "thinking" || event.text === "starting") phase.thinking();
          else if (event.text === "running") phase.text();
          else options.sink.status(event.text.slice(0, 240));
          break;
        case "delta":
          if (options.mode === "steer") throw new Error("z0bridge steer included foreign turn text; refusing to render it.");
          streamed += event.text;
          phase.text();
          options.sink.delta(event.text);
          break;
        case "tool": {
          if (options.mode === "steer") break; // A steer owns no tool stream.
          const name = (event.title || "tool").slice(0, 120);
          if (!knownTools.has(event.toolCallId)) {
            knownTools.add(event.toolCallId);
            parts.start(event.toolCallId, name, "");
            phase.start(name, event.toolCallId);
          }
          if (event.status === "completed" || event.status === "failed") {
            parts.finish(event.toolCallId, event.status === "failed");
            phase.complete(event.toolCallId, name);
            knownTools.delete(event.toolCallId);
          }
          break;
        }
        case "error":
          throw new Error("z0bridge send failed (" + event.code.slice(0, 80) +
            "); check history before resending. No fallback attempted.");
        case "done":
          if (event.stopReason !== "end_turn") {
            throw new Error("z0bridge send stopped (" + event.stopReason.slice(0, 80) +
              "); check history before resending. No fallback attempted.");
          }
          if (options.mode === "next_turn" && !streamed.trim()) {
            throw new Error("Hermes finished without a reply; check history before resending.");
          }
          phase.text();
          return { text: streamed, sessionId: options.sessionId, exitCode: 0 };
      }
    }
  }
  throw new Error("z0bridge send stream ended without a final receipt; the turn may still run. Check history, do not resend.");
}
