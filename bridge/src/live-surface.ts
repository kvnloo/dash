import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LiveArtifact, LiveClientMessage, LiveEvent, LiveReceipt, LiveServerMessage } from "../../shared/live";

/**
 * Live surface: Dash's fast lane of a Hermes chat. The bridge forwards it to z0bridge (`--fx`) on
 * this host, which runs a libfx worker attached to the Hermes session. Hermes stays in charge:
 * the worker asks it through its `hermes` tool, and every worker turn and tap lands in Hermes as
 * a receipt. The phone never learns z0bridge's address or token.
 */
export interface LiveSurfaceOptions {
  baseUrl?: string;
  tokenFile?: string;
  /** Hermes profile for chats that carry none. */
  defaultProfile?: string;
  fetch?: typeof fetch;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

type Send = (message: LiveServerMessage) => void;
type Z0Event = { seq: number; type: string; [key: string]: unknown };

const enc = encodeURIComponent;

/** Dash profile ids → Hermes profile names (`hermes:session:<profile>:<id>`, `hermes:<profile>`, or a bare name). */
export function hermesProfileOf(profileId: string | undefined, fallback: string): string {
  if (!profileId) return fallback;
  const session = /^hermes:session:([^:]+):/.exec(profileId);
  if (session?.[1]) return decodeURIComponent(session[1]);
  const plain = /^hermes:([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/.exec(profileId);
  if (plain?.[1]) return plain[1];
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profileId) ? profileId : fallback;
}

/** Minimal SSE reader for z0bridge turn streams. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<Z0Event> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (data) yield JSON.parse(data) as Z0Event;
      }
    }
  } finally { reader.releaseLock(); }
}

export class LiveSurface {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly profile: string;

  constructor(private options: LiveSurfaceOptions = {}) {
    this.base = (options.baseUrl ?? process.env.DASH_Z0BRIDGE_URL ?? "http://127.0.0.1:4787").replace(/\/+$/, "");
    this.fetchFn = options.fetch ?? fetch;
    this.profile = options.defaultProfile ?? process.env.DASH_LIVE_HERMES_PROFILE ?? "default";
  }

  private token(): string {
    const file = this.options.tokenFile ?? process.env.DASH_Z0BRIDGE_TOKEN_FILE ?? join(homedir(), ".config", "z0bridge", "token");
    return readFileSync(file, "utf8").trim();
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    const response = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token()}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `z0bridge HTTP ${response.status}`;
      try { message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message; } catch { /* not json */ }
      throw new Error(message);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** The fx0 HTML of one version, already wrapped in fx0's embedded CSP by z0bridge. */
  private async artifact(profile: string, worker: string, meta: Record<string, unknown>): Promise<LiveArtifact> {
    const version = Number(meta.version);
    const response = await this.fetchFn(`${this.base}/v1/sessions/fx/${enc(profile)}/${enc(worker)}/artifacts/${version}?prepared=1`, {
      headers: { authorization: `Bearer ${this.token()}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`artifact v${version} unavailable`);
    return {
      kind: "html", version, bytes: Number(meta.bytes), sha256: String(meta.sha256), createdAt: Number(meta.createdAt),
      ...(typeof meta.title === "string" ? { title: meta.title } : {}), html: await response.text(),
    };
  }

  async handle(message: LiveClientMessage, send: Send): Promise<void> {
    try {
      switch (message.type) {
        case "live_open": return await this.open(message, send);
        case "live_turn": {
          const text = message.askHermes
            ? `Use the hermes tool to ask Hermes exactly this, then relay its answer in one or two sentences: ${message.text}`
            : message.text;
          const started = await this.call<{ turnId: string }>("POST", `/v1/sessions/fx/${enc(message.profileId)}/${enc(message.workerId)}/turns`, { text, messageId: message.id });
          return await this.stream(message.id, message.profileId, message.workerId, started.turnId, send);
        }
        case "live_intent": {
          const result = await this.call<{ receipt: LiveReceipt; turnId?: string }>("POST", `/v1/sessions/fx/${enc(message.profileId)}/${enc(message.workerId)}/intents`, { intent: message.intent, continue: message.continue === true });
          send({ type: "live_event", id: message.id, seq: 1, workerId: message.workerId, event: { type: "receipt", receipt: compactReceipt(result.receipt) } });
          if (result.turnId) await this.stream(message.id, message.profileId, message.workerId, result.turnId, send, 1);
          else send({ type: "live_event", id: message.id, seq: 2, workerId: message.workerId, event: { type: "done", stopReason: "recorded" } });
          return;
        }
        case "live_receipts": {
          const { receipts } = await this.call<{ receipts: LiveReceipt[] }>("GET", `/v1/sessions/fx/${enc(message.profileId)}/${enc(message.workerId)}/receipts`);
          send({ type: "live_receipts", id: message.id, workerId: message.workerId, receipts: receipts.map(compactReceipt) });
          return;
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unavailable";
      this.options.log?.("live.error", { type: message.type, reason: reason.slice(0, 160) });
      send({ type: "live_error", id: message.id, message: /ENOENT|ECONNREFUSED|Unable to connect|fetch failed/i.test(reason) ? "Live surface needs z0bridge running with --fx on this host." : reason.slice(0, 300) });
    }
  }

  private async open(message: Extract<LiveClientMessage, { type: "live_open" }>, send: Send): Promise<void> {
    const profile = hermesProfileOf(message.profileId, this.profile);
    let parent: { id: string; title?: string };
    if (message.sessionId) parent = await this.call("GET", `/v1/sessions/hermes/${enc(profile)}/${enc(message.sessionId)}`);
    else parent = await this.call("POST", "/v1/sessions", { harness: "hermes", profile, title: `Dash live surface ${new Date().toISOString().slice(0, 16).replace("T", " ")} ${Math.random().toString(36).slice(2, 6)}` }, 180_000);
    const listed = await this.call<{ sessions: { id: string }[] }>("GET", `/v1/sessions?harness=fx&profile=${enc(profile)}&q=${enc(parent.id)}&limit=5`);
    let worker: { id: string; parent?: { id: string } } | undefined;
    for (const candidate of listed.sessions) {
      const detail = await this.call<{ id: string; parent?: { id: string } }>("GET", `/v1/sessions/fx/${enc(profile)}/${enc(candidate.id)}`);
      if (detail.parent?.id === parent.id) { worker = detail; break; }
    }
    const attached = worker ?? await this.call<{ id: string }>("POST", "/v1/sessions", { harness: "fx", profile, parent: { harness: "hermes", profile, id: parent.id } });
    const metas = await this.call<{ artifacts: Record<string, unknown>[] }>("GET", `/v1/sessions/fx/${enc(profile)}/${enc(attached.id)}/artifacts`);
    const artifacts = await Promise.all(metas.artifacts.slice(-6).map(meta => this.artifact(profile, attached.id, meta)));
    const harnesses = await this.call<{ harnesses: { id: string; version?: string }[] }>("GET", "/v1/harnesses").catch(() => ({ harnesses: [] }));
    const model = harnesses.harnesses.find(h => h.id === "fx")?.version;
    send({ type: "live_opened", id: message.id, workerId: attached.id, profileId: profile, parentSessionId: parent.id, ...(parent.title ? { parentTitle: parent.title } : {}), ...(model ? { model } : {}), artifacts });
  }

  private async stream(id: string, profile: string, worker: string, turnId: string, send: Send, offset = 0): Promise<void> {
    const response = await this.fetchFn(`${this.base}/v1/turns/${enc(turnId)}/events`, {
      headers: { authorization: `Bearer ${this.token()}`, accept: "text/event-stream" },
    });
    if (!response.ok || !response.body) throw new Error(`turn stream HTTP ${response.status}`);
    let seq = offset;
    for await (const raw of readSse(response.body)) {
      const event = await this.map(profile, worker, raw);
      if (event) send({ type: "live_event", id, seq: ++seq, workerId: worker, event });
      if (raw.type === "done" || raw.type === "error") return;
    }
  }

  private async map(profile: string, worker: string, raw: Z0Event): Promise<LiveEvent | null> {
    switch (raw.type) {
      case "status": return { type: "status", text: String(raw.text ?? "") };
      case "delta": return { type: "delta", text: String(raw.text ?? "") };
      case "tool": return { type: "tool", id: String(raw.toolCallId ?? ""), ...(typeof raw.title === "string" ? { name: raw.title } : {}), ...(typeof raw.status === "string" ? { status: raw.status } : {}) };
      case "artifact": return { type: "artifact", artifact: await this.artifact(profile, worker, raw.artifact as Record<string, unknown>) };
      case "control": return { type: "control", control: raw.control as never };
      case "hermes": return { type: "hermes", phase: raw.phase as "asking", ...(typeof raw.text === "string" ? { text: raw.text } : {}) };
      case "receipt": return { type: "receipt", receipt: compactReceipt(raw.receipt as LiveReceipt) };
      case "done": return { type: "done", stopReason: String(raw.stopReason ?? "end_turn") };
      case "error": return { type: "error", message: String(raw.message ?? "worker turn failed") };
      default: return null;
    }
  }
}

function compactReceipt(receipt: LiveReceipt): LiveReceipt {
  return {
    kind: receipt.kind, summary: String(receipt.summary).slice(0, 400), decisions: receipt.decisions ?? [], artifacts: receipt.artifacts ?? [], at: receipt.at,
    ...(receipt.hermes ? { hermes: { child: receipt.hermes.child, messageId: receipt.hermes.messageId } } : {}),
  };
}
