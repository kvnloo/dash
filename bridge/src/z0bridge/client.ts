// Vendored from kvnloo/z0bridge@99f513b client/index.ts. Do not edit here; re-copy on upgrade.
/**
 * Typed z0bridge v1 client. Fetch-only, no Node imports, so apps can import or vendor it.
 * For token discovery on the host see `./local.ts`.
 */
import type {
  ApiErrorBody, CreateSessionRequest, HarnessInfo, Health, MessageList, SessionDetail, SessionList,
  StartTurnRequest, StartTurnResponse, TurnEvent, TurnInfo,
} from "./types";

export type * from "./types";

export class Z0BridgeError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export interface ClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  /** Per-request timeout for non-streaming calls. Default 15 s (session create may take longer). */
  timeoutMs?: number;
}

export interface ListSessionsQuery { harness?: string; profile?: string; q?: string; limit?: number; cursor?: string }

const enc = encodeURIComponent;

export class Z0BridgeClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  constructor(private readonly options: ClientOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs = this.options.timeoutMs ?? 15_000, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.options.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await response.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    if (!response.ok) {
      const error = (parsed as ApiErrorBody | undefined)?.error;
      throw new Z0BridgeError(response.status, error?.code ?? "http_error", error?.message ?? `HTTP ${response.status}`);
    }
    return parsed as T;
  }

  health(): Promise<Health> { return this.call("GET", "/v1/health", undefined, 2_000); }
  async harnesses(): Promise<HarnessInfo[]> { return (await this.call<{ harnesses: HarnessInfo[] }>("GET", "/v1/harnesses")).harnesses; }

  listSessions(query: ListSessionsQuery = {}): Promise<SessionList> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    const qs = params.toString();
    return this.call("GET", `/v1/sessions${qs ? `?${qs}` : ""}`);
  }

  getSession(harness: string, profile: string, id: string): Promise<SessionDetail> {
    return this.call("GET", `/v1/sessions/${enc(harness)}/${enc(profile)}/${enc(id)}`);
  }

  messages(harness: string, profile: string, id: string, options: { after?: string; limit?: number } = {}): Promise<MessageList> {
    const params = new URLSearchParams();
    if (options.after !== undefined) params.set("after", options.after);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const qs = params.toString();
    return this.call("GET", `/v1/sessions/${enc(harness)}/${enc(profile)}/${enc(id)}/messages${qs ? `?${qs}` : ""}`);
  }

  createSession(request: CreateSessionRequest): Promise<SessionDetail> {
    return this.call("POST", "/v1/sessions", request, Math.max(this.options.timeoutMs ?? 0, 180_000));
  }

  startTurn(harness: string, profile: string, id: string, request: StartTurnRequest): Promise<StartTurnResponse> {
    return this.call("POST", `/v1/sessions/${enc(harness)}/${enc(profile)}/${enc(id)}/turns`, request);
  }

  turn(turnId: string): Promise<TurnInfo> { return this.call("GET", `/v1/turns/${enc(turnId)}`); }
  cancelTurn(turnId: string): Promise<TurnInfo> { return this.call("POST", `/v1/turns/${enc(turnId)}/cancel`, {}); }

  /** Stream a turn's events (SSE) until `done` or `error`. Resume with `after` = last seq seen. */
  async *events(turnId: string, options: { after?: number; signal?: AbortSignal } = {}): AsyncGenerator<TurnEvent> {
    const response = await this.fetchFn(`${this.base}/v1/turns/${enc(turnId)}/events${options.after ? `?after=${options.after}` : ""}`, {
      headers: { authorization: `Bearer ${this.options.token}`, accept: "text/event-stream" },
      signal: options.signal,
    });
    if (!response.ok || !response.body) {
      let error: ApiErrorBody["error"] | undefined;
      try { error = ((await response.json()) as ApiErrorBody).error; } catch { /* no body */ }
      throw new Z0BridgeError(response.status, error?.code ?? "http_error", error?.message ?? `HTTP ${response.status}`);
    }
    for await (const event of parseSse(response.body)) {
      yield event;
      if (event.type === "done" || event.type === "error") return;
    }
  }
}

/** Minimal SSE parser: yields the JSON `data` of each event. Comments and `retry` are ignored. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<TurnEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      for (let cut = buffer.indexOf("\n\n"); cut >= 0; cut = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (data) yield JSON.parse(data) as TurnEvent;
      }
    }
  } finally { reader.releaseLock(); }
}
