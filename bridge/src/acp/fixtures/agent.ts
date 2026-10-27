import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const mode = process.argv[2];
if (process.env.DASH_ACP_FIXTURE_PID) writeFileSync(process.env.DASH_ACP_FIXTURE_PID, String(process.pid));
let promptId: unknown;
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const update = (update: unknown) => send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update } });
createInterface({ input: process.stdin }).on("line", (line) => {
  const request: unknown = JSON.parse(line);
  if (!record(request)) process.exit(10);
  const reply = (result: unknown) => send({ jsonrpc: "2.0", id: request.id, result });
  if (request.method === "initialize") {
    if (!record(request.params) || !record(request.params.clientCapabilities)) process.exit(9);
    const capabilities = request.params.clientCapabilities;
    if ((record(capabilities.fs) && capabilities.fs.readTextFile) || capabilities.terminal) process.exit(9);
    reply({ protocolVersion: 1, agentCapabilities: { loadSession: mode !== "no-load" }, authMethods: [] });
  } else if (request.method === "session/new") {
    if (mode === "auth") send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "credential secret must not be logged" } });
    else reply({ sessionId: "fixture-session" });
  } else if (request.method === "session/load") {
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "old replay" } });
    if (mode === "usage") update({ sessionUpdate: "usage_update", size: 500000, used: 150000 });
    reply({});
  } else if (request.method === "session/prompt") {
    promptId = request.id;
    if (mode === "hang") return;
    if (mode === "exit") process.exit(7);
    if (mode === "malformed") { process.stdout.write("not json\n"); return; }
    if (mode === "permission") {
      send({ jsonrpc: "2.0", id: "permission", method: "session/request_permission", params: { sessionId: "fixture-session", options: [{ optionId: "yes", kind: "allow_once" }] } });
      return;
    }
    if (mode === "fs") { send({ jsonrpc: "2.0", id: "fs", method: "fs/read_text_file", params: { path: "/etc/passwd" } }); return; }
    if (mode === "parts") {
      update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "inspect protocol" } });
      update({ sessionUpdate: "tool_call", toolCallId: "sample-tool", title: "terminal", status: "in_progress", rawInput: { command: "printf sample", api_key: "fixture-private-value" } });
      update({ sessionUpdate: "tool_call_update", toolCallId: "sample-tool", status: "completed", rawOutput: "sample output\n" + "x".repeat(10000) });
    }
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "DASH_ACP_OK" } });
    update({ sessionUpdate: "tool_call", title: "fixture tool", status: "pending" });
    if (mode === "orphan") {
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
      update({ sessionUpdate: "tool_call", title: `child:${child.pid}`, status: "pending" });
      child.unref();
    }
    if (mode === "usage") {
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "not-our-session", update: { sessionUpdate: "usage_update", size: 10, used: 10 } } });
      update({ sessionUpdate: "usage_update", size: 500000, used: 160000 });
    }
    reply({ stopReason: "end_turn" });
    if (mode === "orphan") process.exit(0);
  } else if (request.id === "permission" || request.id === "fs") {
    const result = request.result;
    const error = request.error;
    const denied = (record(result) && record(result.outcome) && result.outcome.outcome === "cancelled") || (record(error) && error.code === -32601);
    if (!denied) process.exit(8);
    update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "DENIED" } });
    send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "end_turn" } });
  } else if (request.method === "session/cancel") {
    send({ jsonrpc: "2.0", id: promptId, result: { stopReason: "cancelled" } });
  }
});
