import { expect, test } from "bun:test";
import type { Message } from "../model";
import { assistantFaceIds } from "./bot-message-face";

const assistant = (id: string): Message => ({ id, role: "assistant", text: id, at: 1, state: "done", turnId: id, seq: 1 });
const user = (id: string): Message => ({ id, role: "user", text: id, at: 1 });
test("only the last assistant in each run owns a face; user messages never do", () => {
  expect([...assistantFaceIds([user("u"), assistant("a"), assistant("b"), user("v"), assistant("c")])]).toEqual(["b", "c"]);
  expect([...assistantFaceIds([])]).toEqual([]);
});
test("hidden queued and steered replies do not hide the preceding visible face", () => {
  const queued: Message = { id: "q", role: "assistant", text: "", at: 1, state: "streaming", turnId: "q", seq: 1, delivery: "queued" };
  const steered: Message = { ...queued, id: "s", delivery: "steered" };
  expect([...assistantFaceIds([assistant("a"), queued, steered])]).toEqual(["a"]);
});
