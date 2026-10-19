import { beforeEach, describe, expect, mock, test } from "bun:test";

const persisted = new Map<string, string>();
mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    async multiGet(keys: string[]) { return keys.map((key) => [key, persisted.get(key) ?? null]); },
    async multiSet(entries: [string, string][]) { for (const [key, value] of entries) persisted.set(key, value); },
    async setItem(key: string, value: string) { persisted.set(key, value); },
    async multiRemove(keys: string[]) { for (const key of keys) persisted.delete(key); },
  },
}));
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0) });
const app = await import("./app");
const { replyText } = await import("./text");

beforeEach(() => {
  app.store.set({ hydrated: true, settings: null, connection: { status: "online", harnesses: [], hosts: [] }, conversations: [], activeId: null });
});

function turn() {
  const conversation = app.createConversation("omp");
  return { conversation, ...app.beginTurn(conversation.id, "hello") };
}
function assistant(conversationId: string) {
  const message = app.store.get().conversations.find((c) => c.id === conversationId)?.messages.at(-1);
  if (message?.role !== "assistant") throw new Error("Missing assistant");
  return message;
}

describe("turn completion", () => {
  test("done preserves a partial-output error", () => {
    const t = turn();
    app.applyDeltas(new Map([[t.turnId, { text: "Partial output", seq: 1 }]]));
    app.applyTurnEvent({ type: "error", id: t.turnId, seq: 2, message: "Provider failed" });
    app.applyTurnEvent({ type: "done", id: t.turnId, seq: 3, exitCode: 1 });
    expect(assistant(t.conversation.id)).toMatchObject({ state: "error", text: "Partial output", error: "Provider failed" });
  });
  test("nonzero exit fails even when there is output", () => {
    const t = turn();
    app.applyDeltas(new Map([[t.turnId, { text: "Attempted", seq: 1 }]]));
    app.applyTurnEvent({ type: "done", id: t.turnId, seq: 2, exitCode: 7 });
    expect(assistant(t.conversation.id)).toMatchObject({ state: "error", text: "Attempted" });
    expect(assistant(t.conversation.id).error).toContain("7");
  });
  test("successful completion materializes streaming text", () => {
    const t = turn();
    app.applyDeltas(new Map([[t.turnId, { text: "Answer", seq: 1 }]]));
    app.applyTurnEvent({ type: "done", id: t.turnId, seq: 2, exitCode: 0 });
    expect(assistant(t.conversation.id)).toMatchObject({ state: "done", text: "Answer", error: undefined });
  });
  test("empty success remains an explicit error", () => {
    const t = turn();
    app.applyTurnEvent({ type: "done", id: t.turnId, seq: 1, exitCode: 0 });
    expect(assistant(t.conversation.id)).toMatchObject({ state: "error", error: "No response" });
  });
});

describe("keyed streaming", () => {
  test("deltas reach voice subscribers without changing conversation state", () => {
    const t = turn();
    const snapshot = app.store.get();
    app.applyDeltas(new Map([[t.turnId, { text: "one", seq: 1 }]]));
    app.applyDeltas(new Map([[t.turnId, { text: "two", seq: 2 }]]));
    expect(replyText.get(t.turnId)).toBe("onetwo");
    expect(app.store.get()).toBe(snapshot);
    expect(app.streamingTurns()).toEqual([{ id: t.turnId, seq: 2 }]);
  });
  test("replayed deltas are ignored", () => {
    const t = turn();
    app.applyDeltas(new Map([[t.turnId, { text: "one", seq: 1 }]]));
    app.applyDeltas(new Map([[t.turnId, { text: "one", seq: 1 }]]));
    expect(replyText.get(t.turnId)).toBe("one");
  });
});
