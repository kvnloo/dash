import { createInterface } from "node:readline";

const SESSION_ID = "fixture-permission-session";
const PERMISSION_ID = "fixture-permission-request";
const FS_ID = "fixture-unavailable-fs";
const mode = process.argv[2] ?? "permission";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rpcId(value: unknown): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}

function send(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

function reply(id: string | number, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function update(text: string): void {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: SESSION_ID,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });
}

function fail(): never {
  process.stderr.write("Invalid permission fixture exchange\n");
  process.exit(13);
}

let initialized = false;
let sessionReady = false;
let promptId: string | number | undefined;
let waitingFor: "permission" | "fs" | undefined;
let finished = false;

function complete(text: string): void {
  if (promptId === undefined || finished) fail();
  finished = true;
  waitingFor = undefined;
  update(text);
  reply(promptId, { stopReason: "end_turn" });
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", line => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    fail();
  }
  if (!record(parsed) || parsed.jsonrpc !== "2.0") fail();

  if (parsed.method === "initialize" && rpcId(parsed.id)) {
    if (initialized || !record(parsed.params) || !record(parsed.params.clientCapabilities)) fail();
    const capabilities = parsed.params.clientCapabilities;
    // The ACP client must not offer privileged filesystem or terminal access.
    if (capabilities.terminal !== undefined || capabilities.fs !== undefined) fail();
    initialized = true;
    reply(parsed.id, { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [] });
    return;
  }

  if (parsed.method === "session/new" && rpcId(parsed.id)) {
    if (!initialized || sessionReady) fail();
    sessionReady = true;
    reply(parsed.id, { sessionId: SESSION_ID });
    return;
  }

  if (parsed.method === "session/prompt" && rpcId(parsed.id)) {
    if (!sessionReady || promptId !== undefined || !record(parsed.params) ||
        parsed.params.sessionId !== SESSION_ID) fail();
    promptId = parsed.id;
    if (mode === "fs") {
      waitingFor = "fs";
      send({
        jsonrpc: "2.0",
        id: FS_ID,
        method: "fs/read_text_file",
        params: { sessionId: SESSION_ID, path: "/etc/passwd" },
      });
      return;
    }
    waitingFor = "permission";
    send({
      jsonrpc: "2.0",
      id: PERMISSION_ID,
      method: "session/request_permission",
      params: {
        sessionId: SESSION_ID,
        toolCall: { toolCallId: "fixture-approval-tool", title: "Fixture safe action" },
        options: [
          { optionId: "yes", name: "Allow once", kind: "allow_once" },
          { optionId: "no", name: "Reject once", kind: "reject_once" },
        ],
      },
    });
    return;
  }

  if (parsed.method === "session/cancel" && waitingFor !== undefined) {
    if (!record(parsed.params) || parsed.params.sessionId !== SESSION_ID) fail();
    waitingFor = undefined;
    finished = true;
    if (promptId === undefined) fail();
    reply(promptId, { stopReason: "cancelled" });
    return;
  }

  if (parsed.id === FS_ID && waitingFor === "fs") {
    if (!record(parsed.error) || parsed.error.code !== -32601) fail();
    complete("FS_UNAVAILABLE");
    return;
  }

  if (parsed.id === PERMISSION_ID && waitingFor === "permission") {
    if (!record(parsed.result) || !record(parsed.result.outcome)) fail();
    const outcome = parsed.result.outcome;
    if (outcome.outcome === "cancelled" && outcome.optionId === undefined) {
      complete("DENIED");
      return;
    }
    if (outcome.outcome === "selected" && outcome.optionId === "yes") {
      complete("ALLOWED");
      return;
    }
    if (outcome.outcome === "selected" && outcome.optionId === "no") {
      complete("DENIED");
      return;
    }
    fail();
  }

  // An unknown/late response must never turn a denied fixture into an approval.
  fail();
});
