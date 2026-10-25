import { expect, test } from "bun:test";
import { TurnPhase } from "./turn-phase";
import { acpToolPhase } from "./acp/phase";
import { parseLiveLine, sendIntoLiveSession, type LiveSpawn } from "./hermes-live";
import { streamHermesSession } from "./hermes-stream";

function phaseSink() {
  const statuses: string[] = [];
  const phase = new TurnPhase(text => statuses.push(text));
  return { statuses, phase };
}

test("parallel same-name tools remain active until their own completion", () => {
  const { phase, statuses } = phaseSink();
  phase.thinking(); phase.start("terminal", "1"); phase.start("terminal", "2");
  phase.complete("1"); phase.thinking(); phase.complete("2"); phase.text(); phase.text();
  expect(statuses).toEqual(["Thinking", "Running terminal", "Running terminal, terminal", "Running terminal", "Thinking", ""]);
});

test("clarify is a user wait, not a running tool; partial ACP updates retain the name", () => {
  const { phase, statuses } = phaseSink();
  phase.start("clarify", "q"); phase.complete("q");
  phase.start("terminal", "t"); phase.start("tool", "t"); phase.complete("t");
  expect(statuses).toEqual(["Waiting for clarification", "Thinking", "Running terminal", "Thinking"]);
});

test("ACP completion without title, reasoning, explicit wait and streamed recovery", () => {
  const { phase, statuses } = phaseSink();
  acpToolPhase(phase, { toolCallId: "a", title: "terminal", status: "in_progress" });
  acpToolPhase(phase, { toolCallId: "b", title: "read_file", status: "pending" });
  acpToolPhase(phase, { toolCallId: "a", status: "completed" });
  acpToolPhase(phase, { toolCallId: "b", status: "failed" });
  phase.waiting(); phase.thinking(); phase.text();
  expect(statuses).toEqual(["Running terminal", "Running terminal, read_file", "Running read_file", "Thinking", "Waiting for approval or clarification", "Thinking", ""]);
});

test("live parser accepts identity, ignores nested output and handles reasoning without exposing it", () => {
  expect(parseLiveLine(JSON.stringify({ type: "tool_use", name: "terminal", tool_call_id: "a" }))).toEqual({ kind: "tool", name: "terminal", id: "a" });
  expect(parseLiveLine(JSON.stringify({ type: "tool_result", name: "terminal", tool_call_id: "a", output: { type: "tool_use", name: "not_a_real_event" } }))).toEqual({ kind: "tool-done", name: "terminal", id: "a" });
  expect(parseLiveLine('{"type":"thinking","text":"private reasoning"}')).toEqual({ kind: "thinking" });
  expect(parseLiveLine('{"type":"clarification.request"}')).toEqual({ kind: "waiting" });
});

test("gateway-live phase sequence preserves tools across nested results and text", async () => {
  const lines = [
    { type: "tool_use", name: "terminal", tool_call_id: "a" },
    { type: "tool_use", name: "read_file", tool_call_id: "b" },
    { type: "tool_result", tool_call_id: "a", output: { type: "text", text: "not assistant text" } },
    { type: "tool_result", tool_call_id: "b" }, { type: "thinking" },
    { type: "approval.request" }, { type: "text", text: "ok" }, { type: "result", exit_code: 0, text: "ok" },
  ];
  const body = (s: string) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); } });
  const spawn: LiveSpawn = () => ({ stdin: { write() {}, end() {} }, stdout: body(lines.map(v => JSON.stringify(v)).join("\n")), stderr: body(""), exited: Promise.resolve(0), kill() {} });
  const statuses: string[] = []; const text: string[] = [];
  await sendIntoLiveSession({ argv: ["fixture"], home: "/fixture", sessionId: "s", text: "hi", spawn, sink: { status: s => statuses.push(s), delta: t => text.push(t) } });
  expect(statuses).toEqual(["Thinking", "Running terminal", "Running terminal, read_file", "Running read_file", "Thinking", "Waiting for approval or clarification", ""]);
  expect(text).toEqual(["ok"]);
});

test("native API tracks concurrent calls, _thinking, approval and final text", async () => {
  const events = [
    ["tool.started", { tool_name: "terminal", tool_call_id: "a" }],
    ["tool.started", { tool_name: "read_file", tool_call_id: "b" }],
    ["tool.completed", { tool_call_id: "a" }], ["tool.failed", { tool_call_id: "b" }],
    ["tool.progress", { tool_name: "_thinking" }], ["clarification.request", {}],
    ["assistant.delta", { delta: "ok" }], ["done", {}],
  ];
  const statuses: string[] = [];
  await streamHermesSession({ api: { url: "http://fixture", key: "fixture" }, sessionId: "s", text: "hi", sink: { status: s => statuses.push(s), delta() {} },
    fetch: async input => String(input).endsWith("/stream") ? new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("")) : Response.json({ session: { id: "s" } }),
  });
  expect(statuses).toEqual(["Thinking", "Running terminal", "Running terminal, read_file", "Running read_file", "Thinking", "Waiting for approval or clarification", ""]);
});
