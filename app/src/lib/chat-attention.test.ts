import { test, expect } from "bun:test";
import { chatAttention, chatPriority } from "./chat-attention";
import type { Conversation } from "../model";
const chat: Conversation = { id: "c", harness: "omp", title: "Fix", createdAt: 0, updatedAt: 0, messages: [] };
test("prioritize last-turn errors and running replies, not old failures", () => {
  const failed: Conversation = { ...chat, messages: [{ id: "a", role: "assistant", text: "", state: "error", at: 0, turnId: "t", seq: 0 }] };
  expect(chatAttention(failed)).toBe("Needs attention");
  expect(chatPriority(failed)).toBeLessThan(chatPriority(chat));
  expect(chatAttention({ ...failed, stale: true })).toBeNull();
  expect(chatAttention({ ...failed, messages: [...failed.messages, { id: "u", role: "user", text: "retry", at: 1 }] })).toBeNull();
});
