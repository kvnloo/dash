import { describe, expect, test } from "bun:test";
import { createChatResumeGate, type ChatResumeInput } from "./reconnect-chat";

function context(overrides: Partial<ChatResumeInput> = {}): ChatResumeInput {
  return {
    hydrated: true,
    navigationReady: true,
    initialLinkResolved: true,
    initialLinkHandled: false,
    userNavigated: false,
    paired: true,
    currentRoute: "Main",
    activeId: "chat-42",
    conversations: [{ id: "chat-42" }, { id: "chat-older" }],
    ...overrides,
  };
}

describe("cold-start chat restoration", () => {
  test("waits for both persisted state and navigation and initial link resolution", () => {
    const gate = createChatResumeGate();
    expect(gate.decide(context({ hydrated: false }))).toEqual({ kind: "wait" });
    expect(gate.decide(context({ navigationReady: false }))).toEqual({ kind: "wait" });
    expect(gate.decide(context({ initialLinkResolved: false }))).toEqual({ kind: "wait" });
    expect(gate.isSettled()).toBe(false);
    expect(gate.decide(context())).toEqual({ kind: "open", conversationId: "chat-42" });
    expect(gate.isSettled()).toBe(true);
  });

  test("restores the exact saved active chat once, never creating a new identity", () => {
    const chats = [{ id: "other" }, { id: "resume-this-one", sessionId: "opaque-host-session" }];
    const gate = createChatResumeGate();
    const request = context({ activeId: "resume-this-one", conversations: chats });
    expect(gate.decide(request)).toEqual({ kind: "open", conversationId: "resume-this-one" });
    expect(gate.decide(request)).toEqual({ kind: "skip" });
    expect(chats).toEqual([{ id: "other" }, { id: "resume-this-one", sessionId: "opaque-host-session" }]);
  });

  test("does not supersede a pairing link, notification or user navigation", () => {
    for (const changes of [
      { initialLinkHandled: true },
      { userNavigated: true },
      { currentRoute: "Pair" },
      { currentRoute: "Chat" },
      { currentRoute: "Settings" },
      { currentRoute: undefined },
      { paired: false },
    ]) {
      const gate = createChatResumeGate();
      expect(gate.decide(context(changes))).toEqual({ kind: "skip" });
      expect(gate.decide(context())).toEqual({ kind: "skip" });
    }
  });

  test("a deep link handled while waiting takes precedence over the old chat", () => {
    const gate = createChatResumeGate();
    expect(gate.decide(context({ initialLinkResolved: false }))).toEqual({ kind: "wait" });
    expect(gate.decide(context({ initialLinkHandled: true }))).toEqual({ kind: "skip" });
    expect(gate.decide(context())).toEqual({ kind: "skip" });
  });

  test("missing, deleted, ambiguous or blank active IDs never select another chat", () => {
    for (const changes of [
      { activeId: null },
      { activeId: "" },
      { activeId: "   " },
      { activeId: "removed-chat" },
      { activeId: "chat-42", conversations: [] },
      { activeId: "chat-42", conversations: [{ id: "chat-42" }, { id: "chat-42" }] },
    ]) {
      expect(createChatResumeGate().decide(context(changes))).toEqual({ kind: "skip" });
    }
  });

  test("retains a saved ended chat for read-only viewing; never dispatches to host", () => {
    const conversation = { id: "ended", stale: true, messages: [{ id: "user-1", text: "saved" }] };
    const gate = createChatResumeGate();
    expect(gate.decide(context({ activeId: "ended", conversations: [conversation] })))
      .toEqual({ kind: "open", conversationId: "ended" });
    expect(conversation).toEqual({
      id: "ended", stale: true, messages: [{ id: "user-1", text: "saved" }],
    });
  });

  test("cannot steal focus after first decision, including a foreground return", () => {
    const gate = createChatResumeGate();
    expect(gate.decide(context())).toEqual({ kind: "open", conversationId: "chat-42" });
    expect(gate.decide(context({ activeId: "chat-older" }))).toEqual({ kind: "skip" });
    expect(gate.isSettled()).toBe(true);
  });
});
