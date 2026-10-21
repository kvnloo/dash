import { expect, test } from "bun:test";
import { detailsOf, reducePart, EMPTY_DETAILS, readDetails, wrappedTail, toolStackLabel } from "./reply-details";
import { parseConversation } from "../model";

test("renderer model separates reasoning, tool stack, args/output, status and duration", () => {
  let state = reducePart(EMPTY_DETAILS, { kind: "reasoning", text: "inspect" });
  for (const id of ["a", "b", "c"]) state = reducePart(state, { kind: "tool_start", callId: id, name: "terminal", summary: "printf ok", args: "{}" });
  state = reducePart(state, { kind: "tool_output", callId: "a", text: "partial", truncated: true });
  state = reducePart(state, { kind: "tool_detail", callId: "a", args: '{"command":"printf ok"}', text: "full output", truncated: false });
  state = reducePart(state, { kind: "tool_finish", callId: "a", status: "error", durationMs: 12000 });
  expect(state.reasoning).toBe("inspect");
  expect(state.tools[0]).toMatchObject({ status: "error", durationMs: 12000, output: "full output", truncated: false });
  expect(state.tools[1]?.status).toBe("live");
  expect(toolStackLabel(state.tools)).toBe("3 tools · 12.0 s");
  expect(reducePart(state, { kind: "tool_start", callId: "a", name: "terminal", summary: "updated", args: "{}" }).tools[0]).toMatchObject({ status: "error", summary: "updated" });
});
test("compact renderer tails three wrapped visual rows, not the first lines", () => {
  expect(wrappedTail("old\n1234567890\nlatest\n", 5)).toBe("67890\nlates\nt");
  expect(wrappedTail("🦆🦆🦆", 2)).toBe("🦆🦆\n🦆");
  expect(wrappedTail("abc", 0)).toBe("a\nb\nc");
  expect(readDetails("malformed")).toEqual(EMPTY_DETAILS);
  expect(readDetails(JSON.stringify([{ kind: "reasoning", text: "thought" }])).reasoning).toBe("thought");
  expect(detailsOf().tools).toEqual([]);
});
test("per-chat detail preference and persisted parts survive reload", () => {
  const conversation = parseConversation({ id: "chat", harness: "hermes", title: "Chat", createdAt: 1, updatedAt: 1, detailMode: "Full", messages: [{ id: "m", role: "assistant", state: "done", text: "answer", at: 1, turnId: "t", parts: [{ kind: "reasoning", text: "thought" }] }] });
  expect(conversation?.detailMode).toBe("Full");
  expect(conversation?.messages[0]?.role === "assistant" ? conversation.messages[0].parts : []).toEqual([{ kind: "reasoning", text: "thought" }]);
});
