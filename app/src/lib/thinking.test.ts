import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message } from "../model";
import { conversationThinking, messageThinking } from "./thinking";

const reply = (patch: Partial<AssistantMessage>): AssistantMessage => ({ id: "a", role: "assistant", text: "", at: 1, state: "streaming", turnId: "t", seq: 0, ...patch });

describe("messageThinking", () => {
  test("a reply in flight with no text yet is thinking", () => {
    expect(messageThinking(reply({}))).toEqual({ phase: "thinking" });
  });
  test("text arriving is streaming (live text counts before the store has it)", () => {
    expect(messageThinking(reply({ text: "Hel" }))).toEqual({ phase: "streaming" });
    expect(messageThinking(reply({}), { liveText: "Hel" })).toEqual({ phase: "streaming" });
  });
  test("a tool status names the tool", () => {
    expect(messageThinking(reply({ status: "Running terminal · ls -la" }))).toEqual({ phase: "tool", tool: "terminal" });
    expect(messageThinking(reply({ status: "Running read_file" }))).toEqual({ phase: "tool", tool: "read_file" });
  });
  test("queued behind a host owner or a pending send waits, never shown as work", () => {
    expect(messageThinking(reply({ handoff: "queued" }))).toEqual({ phase: "waiting-approval" });
    expect(messageThinking(reply({ state: "pending" }))).toEqual({ phase: "waiting-approval" });
    expect(messageThinking(reply({ status: "Waiting for approval" }))).toEqual({ phase: "waiting-approval" });
  });
  test("finished or failed replies are idle; so is everything while offline", () => {
    for (const state of ["done", "error", "interrupted"] as const) expect(messageThinking(reply({ state, text: "x" }))).toEqual({ phase: "idle" });
    expect(messageThinking(reply({ text: "x" }), { connection: "offline" })).toEqual({ phase: "idle" });
  });
});

describe("conversationThinking", () => {
  test("uses the latest reply, ignoring user turns after it", () => {
    const messages: Message[] = [reply({ id: "1", state: "done", text: "old" }), { id: "u", role: "user", text: "next", at: 2 }, reply({ id: "2", status: "Running terminal" })];
    expect(conversationThinking(messages)).toEqual({ phase: "tool", tool: "terminal" });
  });
  test("an empty chat is idle", () => {
    expect(conversationThinking([])).toEqual({ phase: "idle" });
  });
});
