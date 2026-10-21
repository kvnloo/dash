import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReplyPart } from "../../shared/protocol";
import { HARNESSES, type Sink } from "./harnesses";
import { PartEmitter, hermesParts, acpParts, cap, redact, redactValue, PREVIEW_BYTES, DETAIL_BYTES, record } from "./reply-parts";
import { ToolDetails } from "./tool-details";
import { parseHermesHistory } from "./hermes-sessions";

function capture() { const parts: ReplyPart[] = []; const sink: Sink = { part: p => parts.push(p), session() {}, delta() {}, status() {}, error() {} }; return { parts, sink }; }
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
for (const name of ["codex", "claude"]) test(`recorded ${name} stream retains identity, real args and output`, () => {
  const { sink, parts } = capture();
  const parser = HARNESSES.find(h => h.id === name)?.parser(sink);
  if (!parser) throw new Error(name);
  fixture(`${name}-parts.jsonl`).trim().split("\n").forEach(line => parser.line(line)); parser.end();
  expect(parts.filter(p => p.kind === "tool_start")).toHaveLength(1);
  const started = parts.find(p => p.kind === "tool_start");
  expect(started?.kind === "tool_start" ? started.args : "").toContain("printf dash-protocol-sample");
  expect(parts.filter(p => p.kind === "tool_output").map(p => p.kind === "tool_output" ? p.text : "").join("")).toContain("dash-protocol-sample");
  expect(parts.find(p => p.kind === "tool_finish")).toMatchObject({ status: "ok" });
});
test("recorded Hermes gateway stream maps arguments, output and native duration", () => {
  const { parts } = capture(); const emitter = new PartEmitter(p => parts.push(p));
  fixture("hermes-parts.jsonl").trim().split("\n").forEach(line => hermesParts(JSON.parse(line), emitter));
  expect(parts.find(p => p.kind === "tool_start")).toMatchObject({ name: "terminal", args: '{"command":"printf dash-protocol-sample"}' });
  expect(parts.find(p => p.kind === "tool_finish")).toMatchObject({ status: "ok", durationMs: 197 });
});
test("recorded native Hermes ACP emits content wrappers, not rawInput/rawOutput", () => {
  const { parts } = capture(); const emitter = new PartEmitter(p => parts.push(p));
  const updates: unknown = JSON.parse(fixture("acp-parts.json"));
  if (!Array.isArray(updates)) throw new Error("fixture");
  for (const update of updates) if (record(update)) acpParts(update, emitter);
  expect(parts.find(p => p.kind === "tool_start")).toMatchObject({ name: "terminal", args: "$ printf dash-protocol-sample" });
  expect(parts.find(p => p.kind === "tool_output")).toMatchObject({ text: "terminal result\n- **output:** dash-protocol-sample\n- **exit_code:** 0" });
  expect(parts.find(p => p.kind === "tool_finish")).toMatchObject({ status: "ok" });
});
for (const name of ["omp", "pi"]) test(`${name} source-contract fixture tails cumulative tool output once`, () => {
  const { parts, sink } = capture(); const parser = HARNESSES.find(h => h.id === name)?.parser(sink); if (!parser) throw new Error(name);
  [ { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "inspect" } }, { type: "tool_execution_start", toolCallId: "one", toolName: "bash", args: { command: "printf ok" } }, { type: "tool_execution_update", toolCallId: "one", partialResult: { content: [{ type: "text", text: "a\n" }] } }, { type: "tool_execution_end", toolCallId: "one", result: { content: [{ type: "text", text: "a\nb\n" }] }, isError: true } ].forEach(event => parser.line(JSON.stringify(event)));
  expect(parts[0]).toEqual({ kind: "reasoning", text: "inspect" });
  expect(parts.filter(p => p.kind === "tool_output").map(p => p.kind === "tool_output" ? p.text : "").join("")).toBe("a\nb\n");
  expect(parts.at(-1)).toMatchObject({ kind: "tool_finish", status: "error" });
});
test("reasoning aliases, ACP thoughts and parallel same-name identity", () => {
  const parts: ReplyPart[] = []; let now = 10; const emitter = new PartEmitter(p => parts.push(p), () => now);
  for (const type of ["thinking", "reasoning", "thinking_delta", "reasoning_delta"]) hermesParts({ type, text: "thought" }, emitter);
  acpParts({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "ACP thought" } }, emitter);
  emitter.start("a", "terminal", {}); now = 20; emitter.start("b", "terminal", {}); now = 50;
  emitter.finish("a"); emitter.finish("b", true);
  expect(parts.filter(p => p.kind === "reasoning")).toHaveLength(5);
  expect(parts.slice(-2)).toEqual([{ kind: "tool_finish", callId: "a", status: "ok", durationMs: 40 }, { kind: "tool_finish", callId: "b", status: "error", durationMs: 30 }]);
});
test("secrets split across output chunks never leave the producer; UTF8 caps are bytes", () => {
  const parts: ReplyPart[] = []; const emitter = new PartEmitter(p => parts.push(p));
  emitter.start("a", "terminal", { api_key: "private-value" });
  emitter.output("a", "sk-abcdefghijk"); expect(parts).toHaveLength(1);
  emitter.output("a", "lmnopqrstuv\n");
  expect(JSON.stringify(parts)).not.toContain("abcdefghijkl");
  expect(JSON.stringify(parts)).not.toContain("private-value");
  expect(redact("Bearer abc123" )).toBe("Bearer [REDACTED]");
  expect(redactValue({ token: "private", nested: { password: "private" } })).toEqual({ token: "[REDACTED]", nested: { password: "[REDACTED]" } });
  expect(new TextEncoder().encode(cap("🦆".repeat(30), 9)).length).toBe(8);
});
test("bounded preview, full request, aggregate budget and unknown-call rejection", () => {
  const cache = new ToolDetails(); cache.preview({ kind: "tool_start", callId: "a", name: "terminal", summary: "command", args: "{}" });
  const preview = cache.preview({ kind: "tool_output", callId: "a", text: "x".repeat(PREVIEW_BYTES + 100), truncated: false });
  expect(preview).toMatchObject({ truncated: true });
  expect(preview?.kind === "tool_output" ? preview.text.length : 0).toBe(PREVIEW_BYTES);
  expect(cache.get("a")).toMatchObject({ kind: "tool_detail", text: "x".repeat(PREVIEW_BYTES + 100), truncated: false });
  cache.preview({ kind: "tool_output", callId: "a", text: "x".repeat(DETAIL_BYTES), truncated: false });
  const detail = cache.get("a");
  expect(detail?.kind === "tool_detail" ? detail.text.length : 0).toBe(DETAIL_BYTES - 2);
  expect(detail).toMatchObject({ truncated: true });
  expect(cache.get("not-owned")).toBeUndefined();
});
test("stored CLI reasoning and tool-only assistant rows survive history backfill", () => {
  const history = parseHermesHistory([{ id: 1, role: "user", content: "check", timestamp: 1 }, { id: 2, role: "assistant", content: "", reasoning_content: "inspect", tool_calls: JSON.stringify([{ id: "call", function: { name: "terminal", arguments: '{"command":"printf ok"}' } }]), timestamp: 2 }, { id: 3, role: "tool", tool_call_id: "call", content: "ok", timestamp: 3 }, { id: 4, role: "assistant", content: "done", timestamp: 4 }]);
  expect(history).toHaveLength(2);
  expect(history[1]?.text).toBe("done");
  expect(history[1]?.parts?.map(p => p.kind)).toEqual(["reasoning", "tool_start", "tool_output", "tool_finish"]);
});
