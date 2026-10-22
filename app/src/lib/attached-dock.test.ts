import { expect, test } from "bun:test";
import { attachedConversation, deliveryPlan, PEEK_IDLE, peekTransition } from "./attached-dock";
import type { Conversation } from "../model";

const a: Conversation = { id: "a", title: "Real session", harness: "hermes", sessionId: "native-a", profileId: "clean", createdAt: 0, updatedAt: 0, messages: [] };
const b: Conversation = { ...a, id: "b", sessionId: "native-b" };
test("navigation is not a detach; selection resolves exact session identity", () => {
  expect(attachedConversation([a, b], "a")).toBe(a);
  expect(attachedConversation([a, b], "b")).toBe(b);
  expect(attachedConversation([a, b], null)).toBeUndefined();
  expect(attachedConversation([b], "a")).toBeUndefined();
});
test("outside-chat delivery uses the same busy queue / steer policy", () => {
  expect(deliveryPlan("queue", false, "idle", false)).toBe("send");
  expect(deliveryPlan("queue", true, "streaming", true)).toBe("queue");
  expect(deliveryPlan("queue", false, "thinking", false)).toBe("wait");
  expect(deliveryPlan("steer", true, "thinking", false)).toBe("send");
});
test("peek opens on a new revision or send, tucks at six seconds, and ignores token repeats", () => {
  const open = peekTransition(PEEK_IDLE, { kind: "activity", revision: "reply:1", now: 100 });
  expect(open).toEqual({ expanded: true, revision: "reply:1", until: 6100 });
  expect(peekTransition(open, { kind: "activity", revision: "reply:1", now: 4000 })).toBe(open);
  expect(peekTransition(open, { kind: "tick", now: 6099 })).toBe(open);
  expect(peekTransition(open, { kind: "tick", now: 6100 }).expanded).toBe(false);
  const tucked = peekTransition(open, { kind: "tuck" });
  expect(tucked.expanded).toBe(false);
  expect(peekTransition(tucked, { kind: "activity", revision: "reply:1", now: 8000 })).toBe(tucked);
  expect(peekTransition(tucked, { kind: "send", now: 9000 }).until).toBe(15000);
  expect(peekTransition(tucked, { kind: "activity", revision: "reply:done", now: 9000 }).expanded).toBe(true);
});
