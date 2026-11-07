/**
 * Fail-closed Hermes reply boundary. A transport that admitted a request must not
 * treat a status message, user echo, or uncorrelated RPC response as an agent reply.
 */
export type HermesReply = { text: string; sessionId?: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function usable(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function agentRole(value: unknown): boolean {
  return value === "ROLE_AGENT" || value === "agent" || value === "assistant";
}

function appendContent(value: unknown, output: string[]): void {
  if (usable(value)) {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) appendContent(item, output);
    return;
  }
  if (!record(value)) return;
  if (usable(value.text)) output.push(value.text);
  if (value.content !== undefined) appendContent(value.content, output);
  if (value.parts !== undefined) appendContent(value.parts, output);
}

function appendMessage(value: unknown, output: string[], requireRole: boolean): void {
  if (!record(value)) return;
  if (value.role === undefined ? requireRole : !agentRole(value.role)) return;
  appendContent(value, output);
}

function stateName(value: unknown): string | undefined {
  const state = record(value) ? value.state : value;
  return typeof state === "string"
    ? state.toLowerCase().replace(/^task_state_/, "").replace(/^task-/, "")
    : undefined;
}

function terminalStatus(path: "gateway" | "peer", value: unknown): void {
  const state = stateName(value);
  if (state === "completed" || state === "succeeded" || (path === "peer" && (state === "ok" || state === "success"))) return;
  if (state === "failed" || state === "rejected" || state === "canceled" || state === "cancelled") {
    throw new Error("Hermes " + path + " task " + state + ". No fallback attempted.");
  }
  throw new Error("Hermes " + path + " did not confirm a final reply (state " +
    (state ?? "unknown") + "). The turn may still be running; inspect history before retrying.");
}

function errorEnvelope(path: "gateway" | "peer", error: unknown): never {
  const code = record(error) && (typeof error.code === "number" || typeof error.code === "string")
    ? " (" + String(error.code) + ")" : "";
  const detail = record(error) && usable(error.message) ? ": " + error.message.slice(0, 240) : "";
  throw new Error("Hermes " + path + " request error" + code + detail + ". No fallback attempted.");
}

function contextIdentity(objects: readonly unknown[], expected?: string): string | undefined {
  const found = new Set<string>();
  for (const obj of objects) {
    if (!record(obj)) continue;
    for (const key of ["contextId", "sessionId", "session_id"]) {
      const value = obj[key];
      if (usable(value)) found.add(value);
    }
  }
  if (found.size > 1) {
    throw new Error("Hermes returned conflicting session identities. No fallback attempted.");
  }
  const actual = found.values().next().value;
  if (expected && actual && expected !== actual) {
    throw new Error("Hermes returned a different session identity. Check the original session; do not resend.");
  }
  return actual ?? expected;
}

/** Enforce same-origin discovery before attaching a profile's bearer token. */
export function sameOriginGatewayEndpoint(endpoint: string, configuredOrigin: string): string {
  let expected: URL;
  let candidate: URL;
  try {
    expected = new URL(configuredOrigin);
    candidate = new URL(endpoint, expected);
  } catch {
    throw new Error("Hermes gateway advertised an invalid JSON-RPC endpoint.");
  }
  if (!["http:", "https:"].includes(expected.protocol) ||
      !["http:", "https:"].includes(candidate.protocol) ||
      expected.origin !== candidate.origin ||
      expected.username || expected.password || candidate.username || candidate.password ||
      candidate.hash) {
    throw new Error("Hermes gateway advertised a different or unsafe origin. No bearer token sent.");
  }
  return candidate.href;
}

/** Only a correlated JSON-RPC result containing final agent content is success. */
export function decodeGatewayReply(payload: unknown, requestId: string, expectedSessionId?: string): HermesReply {
  if (!record(payload) || payload.jsonrpc !== "2.0") {
    throw new Error("Hermes gateway returned an invalid JSON-RPC envelope.");
  }
  if (payload.id !== requestId) {
    throw new Error("Hermes gateway returned an uncorrelated JSON-RPC response. No fallback attempted.");
  }
  if (payload.error !== undefined) errorEnvelope("gateway", payload.error);
  if (!record(payload.result)) {
    throw new Error("Hermes gateway returned no JSON-RPC result. No fallback attempted.");
  }
  const result = payload.result;
  const task = record(result.task) ? result.task : result;
  if (task.status !== undefined) terminalStatus("gateway", task.status);

  const parts: string[] = [];
  if (task.artifacts !== undefined) appendContent(task.artifacts, parts);
  if (record(task.status)) appendMessage(task.status.message, parts, true);
  appendMessage(task.message, parts, true);
  if (task !== result) appendMessage(result.message, parts, true);
  if (agentRole(task.role)) appendContent(task, parts);
  if (usable(task.text)) parts.push(task.text);
  const text = parts.join("\n").trim();
  if (!text) throw new Error("Hermes gateway returned no final agent reply. No fallback attempted.");

  const statusMessage = record(task.status) ? task.status.message : undefined;
  const sessionId = contextIdentity([result, task, result.message, task.message, statusMessage], expectedSessionId);
  return { text, ...(sessionId ? { sessionId } : {}) };
}

/** Native peer/API response: never mistake 202/queued/failed or a user echo for a reply. */
export function decodePeerReply(payload: unknown, expectedSessionId?: string): HermesReply {
  if (!record(payload)) throw new Error("Hermes peer returned an invalid response.");
  if (payload.error !== undefined) errorEnvelope("peer", payload.error);
  const result = record(payload.result) ? payload.result : payload;
  if (result.status !== undefined) terminalStatus("peer", result.status);
  const parts: string[] = [];
  if (record(result.message)) appendMessage(result.message, parts, false);
  else if (usable(result.message)) parts.push(result.message);
  if (parts.length === 0 && usable(result.reply)) parts.push(result.reply);
  if (parts.length === 0 && usable(result.text)) parts.push(result.text);
  const text = parts.join("\n").trim();
  if (!text) throw new Error("Hermes peer returned an empty reply. No fallback attempted.");
  const sessionId = contextIdentity([result, result.message], expectedSessionId);
  return { text, ...(sessionId ? { sessionId } : {}) };
}

/** The native API must prove the exact session; reported cwd/profile must not drift. */
export function verifyNativeHermesSession(
  payload: unknown,
  expected: { sessionId: string; cwd: string; profileId?: string },
): void {
  if (!record(payload) || !record(payload.session) || payload.session.id !== expected.sessionId) {
    throw new Error("Hermes API does not own this profile/session. No send attempted.");
  }
  const session = payload.session;
  if (usable(session.cwd) && session.cwd !== expected.cwd) {
    throw new Error("Hermes API session belongs to a different working directory. No send attempted.");
  }
  const profile = session.profileId ?? session.profile_id;
  if (expected.profileId && usable(profile) && profile !== expected.profileId) {
    throw new Error("Hermes API session belongs to a different profile. No send attempted.");
  }
}
