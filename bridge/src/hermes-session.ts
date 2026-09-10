import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Send a Dash hermes turn over gateway JSON-RPC A2A or the hermes peer API.
// CLI (`hermes chat -q`) is fallback only when those HTTP surfaces are down.

export type HermesTurnInput = {
  text: string;
  cwd: string;
  sessionId?: string;
};

export type HermesPath = "gateway" | "peer" | "cli";

export type EnvMap = Record<string, string | undefined>;

export type LogFn = (event: string, fields?: Record<string, unknown>) => void;

export type GatewayRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: {
    jsonrpc: "2.0";
    id: string;
    method: "SendMessage";
    params: {
      message: {
        messageId: string;
        role: "ROLE_USER";
        parts: Array<{ text: string }>;
        contextId?: string;
      };
    };
  };
};

export type PeerRequest = {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: { message: string };
};

export type HermesSessionResult =
  | { path: "gateway" | "peer"; text: string; sessionId?: string }
  | { path: "cli"; reason: string };

const DEFAULT_A2A_PORT = "9900";
const CARD_TIMEOUT_MS = 4_000;
const SEND_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function jsonHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function firstPeerToken(raw: string): string | undefined {
  for (const part of raw.split(",")) {
    const cut = part.indexOf(":");
    if (cut <= 0) continue;
    const token = part.slice(cut + 1).trim();
    if (token) return token;
  }
  return undefined;
}

export function gatewayOrigin(env: EnvMap): string {
  const explicit = env.HERMES_A2A_URL ?? env.A2A_PUBLIC_URL;
  if (explicit?.trim()) return trimSlash(explicit.trim());
  const host = env.A2A_HOST?.trim();
  const port = env.A2A_PORT?.trim() || DEFAULT_A2A_PORT;
  if (host) return `http://${host}:${port}`;
  return `http://127.0.0.1:${port}`;
}

export function peerOrigin(env: EnvMap): string | undefined {
  const raw = env.HERMES_PEER_URL ?? env.HERMES_PEER_GROOT_URL;
  const trimmed = raw?.trim();
  return trimmed ? trimSlash(trimmed) : undefined;
}

export function a2aBearerToken(env: EnvMap): string | undefined {
  const direct =
    env.A2A_BEARER_TOKEN?.trim() ||
    env.HERMES_A2A_TOKEN?.trim() ||
    env.A2A_MBP_TOKEN?.trim();
  if (direct) return direct;
  const peers = env.A2A_PEER_TOKENS?.trim();
  return peers ? firstPeerToken(peers) : undefined;
}

export function peerBearerToken(env: EnvMap): string | undefined {
  const token = env.HERMES_PEER_KEY?.trim() || env.HERMES_PEER_GROOT_KEY?.trim();
  return token || undefined;
}

export function agentCardUrl(origin: string): string {
  return `${trimSlash(origin)}/.well-known/agent.json`;
}

export function jsonRpcEndpoint(card: unknown, fallbackOrigin: string): string | undefined {
  if (!isRecord(card)) return undefined;
  const interfaces = card.supportedInterfaces;
  if (Array.isArray(interfaces)) {
    for (const entry of interfaces) {
      if (!isRecord(entry)) continue;
      if (entry.protocolBinding !== "JSONRPC") continue;
      if (typeof entry.url === "string" && entry.url.trim()) return entry.url.trim();
    }
    if (interfaces.length > 0) return undefined;
  }
  if (card.protocolBinding === "JSONRPC" && typeof card.url === "string" && card.url.trim()) {
    return card.url.trim();
  }
  if (typeof card.url === "string" && card.url.trim()) return card.url.trim();
  return `${trimSlash(fallbackOrigin)}/`;
}

export function hermesCliArgv(input: HermesTurnInput): string[] {
  return [
    "chat",
    "-q",
    input.text,
    "-Q",
    "--in",
    input.cwd,
    ...(input.sessionId ? ["--resume", input.sessionId] : []),
  ];
}

export function buildGatewayRequest(input: {
  endpoint: string;
  text: string;
  sessionId?: string;
  token?: string;
  requestId?: string;
  messageId?: string;
}): GatewayRequest {
  const message: GatewayRequest["body"]["params"]["message"] = {
    messageId: input.messageId ?? crypto.randomUUID(),
    role: "ROLE_USER",
    parts: [{ text: input.text }],
  };
  if (input.sessionId) message.contextId = input.sessionId;
  return {
    url: input.endpoint,
    method: "POST",
    headers: jsonHeaders(input.token),
    body: {
      jsonrpc: "2.0",
      id: input.requestId ?? "1",
      method: "SendMessage",
      params: { message },
    },
  };
}

export function buildPeerRequest(input: {
  origin: string;
  sessionId: string;
  text: string;
  token?: string;
}): PeerRequest {
  return {
    url: `${trimSlash(input.origin)}/api/sessions/${encodeURIComponent(input.sessionId)}/chat`,
    method: "POST",
    headers: jsonHeaders(input.token),
    body: { message: input.text },
  };
}

function collectText(node: unknown, into: string[]): void {
  if (typeof node === "string") {
    if (node) into.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, into);
    return;
  }
  if (!isRecord(node)) return;
  if (typeof node.text === "string") into.push(node.text);
  if (typeof node.content === "string") into.push(node.content);
  if (node.parts !== undefined) collectText(node.parts, into);
  if (node.artifacts !== undefined) collectText(node.artifacts, into);
  if (node.message !== undefined) collectText(node.message, into);
  if (node.status !== undefined) collectText(node.status, into);
  if (node.task !== undefined) collectText(node.task, into);
}

export function extractA2AText(payload: unknown): string {
  const chunks: string[] = [];
  if (isRecord(payload) && payload.result !== undefined) {
    collectText(payload.result, chunks);
  } else {
    collectText(payload, chunks);
  }
  return chunks.join("\n").trim();
}

export function extractA2ASessionId(payload: unknown): string | undefined {
  const visit = (node: unknown): string | undefined => {
    if (!isRecord(node)) return undefined;
    if (typeof node.contextId === "string" && node.contextId) return node.contextId;
    if (typeof node.session_id === "string" && node.session_id) return node.session_id;
    if (typeof node.sessionId === "string" && node.sessionId) return node.sessionId;
    for (const child of [node.result, node.message, node.task, node.session]) {
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  return visit(payload);
}

function isUnreachable(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("fetch failed") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("enotfound") ||
      message.includes("network") ||
      message.includes("unable to connect")
    );
  }
  return false;
}

function parseJsonText(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return text;
  }
}

type FetchFn = typeof globalThis.fetch;

async function fetchJson(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchFn(url, { ...init, signal: combined });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text ? parseJsonText(text) : undefined };
}


const HERMES_ENV_KEYS = /^(A2A_|HERMES_A2A_|HERMES_PEER_)/;

export function parseHermesEnvFile(text: string): EnvMap {
  const env: EnvMap = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.indexOf("=");
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    if (!HERMES_ENV_KEYS.test(key)) continue;
    let value = line.slice(cut + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function mergeEnv(base: EnvMap, override: EnvMap): EnvMap {
  const out: EnvMap = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined && value !== "") out[key] = value;
  }
  return out;
}

function loadHermesEnvFile(path: string): EnvMap {
  try {
    return parseHermesEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export async function runHermesSession(options: {
  input: HermesTurnInput;
  env?: EnvMap;
  envFile?: string;
  fetch?: FetchFn;
  log: LogFn;
  signal?: AbortSignal;
}): Promise<HermesSessionResult> {
  const override = options.env ?? process.env;
  const home = override.HERMES_HOME?.trim() || join(homedir(), ".hermes");
  const env = mergeEnv(loadHermesEnvFile(options.envFile ?? join(home, ".env")), override);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const origin = gatewayOrigin(env);
  const token = a2aBearerToken(env);

  let gatewayDown = false;
  try {
    const cardResponse = await fetchJson(
      fetchFn,
      agentCardUrl(origin),
      { method: "GET" },
      CARD_TIMEOUT_MS,
      options.signal,
    );
    if (cardResponse.ok) {
      const endpoint = jsonRpcEndpoint(cardResponse.body, origin);
      if (endpoint) {
        const request = buildGatewayRequest({
          endpoint,
          text: options.input.text,
          sessionId: options.input.sessionId,
          token,
        });
        const sent = await fetchJson(
          fetchFn,
          request.url,
          { method: request.method, headers: request.headers, body: JSON.stringify(request.body) },
          SEND_TIMEOUT_MS,
          options.signal,
        );
        if (sent.ok) {
          const text = extractA2AText(sent.body);
          const sessionId = extractA2ASessionId(sent.body) ?? options.input.sessionId;
          options.log("hermes.path", { path: "gateway", origin });
          return { path: "gateway", text, sessionId };
        }
        options.log("hermes.path", {
          path: "gateway",
          origin,
          status: sent.status,
          reason: sent.status === 401 || sent.status === 403 ? "unauthorized" : "http_error",
        });
      } else {
        options.log("hermes.path", { path: "gateway", origin, reason: "not_jsonrpc" });
      }
    } else {
      options.log("hermes.path", {
        path: "gateway",
        origin,
        status: cardResponse.status,
        reason: "card_http_error",
      });
    }
  } catch (error) {
    gatewayDown = isUnreachable(error) || (error instanceof DOMException && error.name === "TimeoutError");
    options.log("hermes.path", {
      path: "gateway",
      origin,
      reason: gatewayDown ? "gateway_down" : "gateway_error",
    });
  }

  const peer = peerOrigin(env);
  if (peer) {
    const sessionId = options.input.sessionId ?? "dash";
    try {
      const request = buildPeerRequest({
        origin: peer,
        sessionId,
        text: options.input.text,
        token: peerBearerToken(env),
      });
      const sent = await fetchJson(
        fetchFn,
        request.url,
        { method: request.method, headers: request.headers, body: JSON.stringify(request.body) },
        SEND_TIMEOUT_MS,
        options.signal,
      );
      if (sent.ok) {
        const text = extractA2AText(sent.body);
        const nextSession = extractA2ASessionId(sent.body) ?? sessionId;
        options.log("hermes.path", { path: "peer", origin: peer });
        return { path: "peer", text, sessionId: nextSession };
      }
      options.log("hermes.path", {
        path: "peer",
        origin: peer,
        status: sent.status,
        reason: sent.status === 401 || sent.status === 403 ? "unauthorized" : "http_error",
      });
    } catch (error) {
      options.log("hermes.path", {
        path: "peer",
        origin: peer,
        reason: isUnreachable(error) ? "peer_down" : "peer_error",
      });
    }
  }

  const reason = gatewayDown ? "gateway_down" : "gateway_unavailable";
  options.log("hermes.path", { path: "cli", reason });
  return { path: "cli", reason };
}
