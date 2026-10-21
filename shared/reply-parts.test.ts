import { expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage, type ReplyPart } from "./protocol";
import { parseReplyPart, parseReplyParts } from "./reply-parts";
const parts: ReplyPart[] = [{ kind: "reasoning", text: "inspect" }, { kind: "tool_start", callId: "a", name: "read_file", summary: "x", args: "{}" }, { kind: "tool_output", callId: "a", text: "ok", truncated: true }, { kind: "tool_finish", callId: "a", status: "ok", durationMs: 12 }, { kind: "tool_detail", callId: "a", args: "{}", text: "full", truncated: false }];
test("reply parts round trip through optional v1 status payload", () => {
  for (const part of parts) expect(parseServerMessage({ type: "status", id: "turn", seq: 1, text: "", part })).toEqual({ type: "status", id: "turn", seq: 1, text: "", part });
  expect(parseClientMessage({ type: "tool_detail", id: "turn", callId: "a" })).toEqual({ type: "tool_detail", id: "turn", callId: "a" });
  expect(parseServerMessage({ type: "status", id: "turn", seq: 2, text: "Working" })).toEqual({ type: "status", id: "turn", seq: 2, text: "Working" });
});
test("malformed parts and mixed status authorities fail closed", () => {
  for (const raw of [null, [], 1, {}, { kind: "unknown" }, { kind: "tool_finish", callId: "a", status: "ok", durationMs: -1 }, { kind: "tool_finish", callId: "a", status: "ok", durationMs: Infinity }, { kind: "tool_output", callId: "a", text: "x" }, { kind: "tool_start", callId: "a", name: 3, summary: "x", args: "{}" }]) expect(parseReplyPart(raw)).toBeNull();
  expect(parseReplyParts([parts[0], {}])).toBeUndefined();
  expect(parseServerMessage({ type: "status", id: "t", seq: 1, text: "", part: parts[0], acp: { sessionId: "s", update: {} } })).toBeNull();
  expect(parseServerMessage({ type: "history", harness: "hermes", sessionId: "s", messages: [{ id: "a", role: "assistant", text: "done", at: 1, parts }] })).not.toBeNull();
  expect(parseServerMessage({ type: "history", harness: "hermes", sessionId: "s", messages: [{ id: "a", role: "assistant", text: "done", at: 1, parts: [{}] }] })).toBeNull();
});
