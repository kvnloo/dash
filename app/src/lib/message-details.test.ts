import { expect, test } from "bun:test";
import { splitThinking, appendActivity } from "./message-details";
test("thinking is separate, including unfinished streamed thinking", () => {
  expect(splitThinking("<think>Check the test</think>\nResult")).toEqual({ text: "Result", thinking: "Check the test" });
  expect(splitThinking("<think>Still checking")).toEqual({ text: "", thinking: "Still checking" });
  expect(splitThinking("```xml\n<think>literal</think>\n``` + result").thinking).toBe("");
});
test("activity deduplicates consecutive statuses and bounds retained entries", () => {
  expect(appendActivity(["Read file"], "Read file")).toEqual(["Read file"]);
  expect(appendActivity(Array.from({ length: 32 }, (_, i) => String(i)), "Next")).toHaveLength(32);
  expect(appendActivity([], "")).toEqual([]);
});
