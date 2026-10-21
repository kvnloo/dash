import { expect, test } from "bun:test";
import { railColors, railState, railTurns, railWidth, RailSummaryCache } from "./rail-turns";
import type { AssistantMessage, Message } from "../model";
const reply = (text = "Verified.", extra: Partial<AssistantMessage> = {}): AssistantMessage => ({ id: "a", role: "assistant", text, at: 2, state: "done", turnId: "t", seq: 0, ...extra });
const prompt: Message = { id: "u", role: "user", text: "Fix\nDetails", at: 1 };
test("width is bounded monotonic reading volume, stable without chat normalization", () => {
  for (const n of [-1, 0, NaN, Infinity, -Infinity]) expect(railWidth(n)).toBe(8);
  expect(railWidth(1)).toBeCloseTo(9.771104386989682, 5);
  expect(railWidth(12000)).toBe(32);
  expect(railWidth(24000)).toBe(32);
  expect(railWidth(120)).toBeGreaterThan(railWidth(12));
  expect(railWidth(120)).toBeLessThan(railWidth(1200));
});
test("semantic state precedence and exact colours", () => {
  expect(railColors).toEqual({ done: "#777777", "needs-you": "#E8B45D", error: "#F27979", live: "#7BB8F5" });
  expect(railState([])).toBe("done");
  expect(railState([reply()])).toBe("done");
  expect(railState([reply("?", { state: "streaming" })])).toBe("live");
  expect(railState([reply("", { state: "streaming", status: "waiting for approval" })])).toBe("needs-you");
  expect(railState([reply("", { status: "needs owner decision" })])).toBe("needs-you");
  expect(railState([reply("", { state: "error", status: "waiting for clarification" })])).toBe("error");
  expect(railState([reply("Approval completed")])).toBe("done");
});
test("summary cache reads once per immutable message and invalidates new revisions", () => {
  const cache = new RailSummaryCache();
  let reads = 0;
  const message: AssistantMessage = { ...reply(), get text() { reads++; return "<think>private reasoning</think>\n# Result\nDetails"; } };
  expect(cache.get(message)).toBe("Result"); const initial = reads;
  expect(cache.get(message)).toBe("Result"); expect(reads).toBe(initial);
  expect(cache.get(reply("Updated"))).toBe("Updated");
  expect(cache.get(reply(""))).toBe("No result text yet");
  expect(cache.get(reply("x".repeat(201)))).toHaveLength(200);
});
test("turn metadata is scoped, deduplicated, and does not pretend activity equals tools", () => {
  const answer = "```diff\n+ fix\n```\n/home/user/file.ts /home/user/file.ts https://github.com/kvnloo/dash/pull/77\nWhich option?";
  const turns = railTurns([reply("orphan"), prompt, reply(answer, { activity: ["read", "read"] }), { ...prompt, id: "u2", text: "" }]);
  expect(turns).toHaveLength(2);
  expect(turns[0]).toEqual({ id: "u", index: 1, text: "Fix\nDetails", summary: "```diff", characters: answer.length, state: "done", question: true, code: true, activityUpdates: 2, files: ["/home/user/file.ts"], pr: "https://github.com/kvnloo/dash/pull/77" });
  expect(turns[1]).toEqual({ id: "u2", index: 3, text: "Attached files", summary: "No result text yet", characters: 0, state: "done", question: false, code: false, activityUpdates: 0, files: [], pr: undefined });
  expect(railTurns([prompt, reply("No code", { status: "Read file" }), reply("Final")])[0]?.activityUpdates).toBe(1);
  expect(railTurns([prompt, reply("No code")])[0]?.question).toBe(false);
  expect(railTurns([prompt, reply("No code")])[0]?.code).toBe(false);
});
