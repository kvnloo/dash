import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Keep native persistence synthetic and scoped to this test file. No device, bridge,
// settings store, or live connection is involved.
const KEYS = {
  settings: "dash.settings.v1",
  conversations: "dash.conversations.v1",
  activeId: "dash.activeId.v1",
};
const persisted = new Map<string, string>();
const readBatches: string[][] = [];
const writes: string[] = [];

mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    async multiGet(keys: string[]) {
      readBatches.push([...keys]);
      return keys.map((key) => [key, persisted.get(key) ?? null]);
    },
    async multiSet(entries: [string, string][]) {
      for (const [key, value] of entries) {
        writes.push(key);
        persisted.set(key, value);
      }
    },
    async setItem(key: string, value: string) {
      writes.push(key);
      persisted.set(key, value);
    },
    async multiRemove(keys: string[]) {
      for (const key of keys) {
        writes.push(key);
        persisted.delete(key);
      }
    },
  },
}));

// Keyed reply hydration normally schedules a UI-frame notification. Make it
// deterministic without leaving a real frame/timer running for sibling tests.
const originalAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
Object.defineProperty(globalThis, "requestAnimationFrame", {
  configurable: true,
  value: (callback: FrameRequestCallback): number => {
    callback(0);
    return 1;
  },
});

const app = await import("./app");
const { replyText } = await import("./text");
const seededTurns = new Set<string>();

function emptyState(): import("./app").AppState {
  return {
    hydrated: false,
    settings: null,
    connection: { status: "idle", harnesses: [], hosts: [] },
    conversations: [],
    activeId: null,
  };
}

function legacyChat(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    harness: "omp",
    title: "Saved " + id,
    createdAt: 100,
    updatedAt: 200,
    messages: [],
    ...overrides,
  };
}

function seed(conversations: unknown, activeId?: string, settings?: unknown): void {
  const encoded = JSON.stringify(conversations);
  if (encoded !== undefined) persisted.set(KEYS.conversations, encoded);
  if (activeId === undefined) persisted.delete(KEYS.activeId);
  else persisted.set(KEYS.activeId, activeId);
  if (settings === undefined) persisted.delete(KEYS.settings);
  else {
    const encodedSettings = JSON.stringify(settings);
    if (encodedSettings !== undefined) persisted.set(KEYS.settings, encodedSettings);
  }
}

beforeEach(() => {
  persisted.clear();
  readBatches.length = 0;
  writes.length = 0;
  app.store.set(emptyState());
});

afterEach(() => {
  for (const id of seededTurns) replyText.clear(id);
  seededTurns.clear();
  app.store.set(emptyState());
  persisted.clear();
  readBatches.length = 0;
  writes.length = 0;
});

afterAll(() => {
  mock.restore();
  if (originalAnimationFrame) {
    Object.defineProperty(globalThis, "requestAnimationFrame", originalAnimationFrame);
  } else {
    Reflect.deleteProperty(globalThis, "requestAnimationFrame");
  }
});

describe("app conversation persistence hydration", () => {
  test("restores multiple legacy chats, explicit activeId, and each chat's own target", async () => {
    const recent = legacyChat("chat-recent", {
      harness: "hermes",
      targetHostId: "host-one",
      profileId: "hermes:one",
      sessionId: "session-one",
      cwd: "/work/one",
      messages: [
        { id: "user-one", role: "user", text: "Hello", at: 110 },
        { id: "assistant-one", role: "assistant", text: "Hi", at: 120, state: "done", turnId: "turn-one" },
      ],
    });
    const older = legacyChat("chat-older", {
      targetHostId: "host-two",
      profileId: "omp:two",
      sessionId: "session-two",
      cwd: "/work/two",
      messages: [
        { id: "user-two", role: "user", text: "Status?", at: 130 },
        { id: "assistant-two", role: "assistant", text: "Ready", at: 140, state: "done", turnId: "turn-two", seq: 4 },
      ],
    });
    seed([recent, older], "chat-older", {
      address: "fixture-host:4747",
      token: "synthetic-token",
      harness: "hermes",
      cwd: "/settings-only",
    });

    const changes: import("./app").AppState[] = [];
    const unsubscribe = app.store.subscribe(() => changes.push(app.store.get()));
    try {
      await app.hydrate();
    } finally {
      unsubscribe();
    }

    const state = app.store.get();
    expect(readBatches).toEqual([[KEYS.settings, KEYS.conversations, KEYS.activeId]]);
    expect(writes).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(state.hydrated).toBe(true);
    expect(state.activeId).toBe("chat-older");
    expect(state.conversations.map((chat) => chat.id)).toEqual(["chat-recent", "chat-older"]);
    expect(state.conversations[0]).toMatchObject({
      harness: "hermes", targetHostId: "host-one", profileId: "hermes:one",
      sessionId: "session-one", cwd: "/work/one",
    });
    expect(state.conversations[1]).toMatchObject({
      harness: "omp", targetHostId: "host-two", profileId: "omp:two",
      sessionId: "session-two", cwd: "/work/two",
    });
    expect(state.conversations[0]?.messages.map((message) => message.id)).toEqual(["user-one", "assistant-one"]);
    expect(state.conversations[1]?.messages.map((message) => message.id)).toEqual(["user-two", "assistant-two"]);
    expect(state.conversations[0]?.messages[1]).toMatchObject({ state: "done", text: "Hi", seq: 0 });
    expect(state.conversations[0]?.deliverQueuedAsOne).toBe(true);
    expect(state.settings).toMatchObject({
      address: "fixture-host:4747", harness: "hermes",
      cwd: "/settings-only", inAppFeedback: true,
    });
    expect(state.connection.status).toBe("idle");
    expect(app.streamingTurns()).toEqual([]);
  });

  test("drops malformed rows and messages without manufacturing phantom turns", async () => {
    const valid = legacyChat("good-chat", {
      messages: [
        null,
        "not-a-message",
        { id: "missing-role", text: "ghost", at: 1 },
        { id: "bad-user", role: "user", text: 123, at: 2 },
        { id: "bad-assistant", role: "assistant", text: "ghost", at: 3, state: "streaming" },
        { id: "wrong-state", role: "assistant", text: "ghost", at: 4, state: "running", turnId: "phantom-turn" },
        { id: "valid-user", role: "user", text: "Real request", at: 5 },
        { id: "valid-assistant", role: "assistant", text: "Real answer", at: 6, state: "done", turnId: "real-turn", seq: 2 },
      ],
    });
    seed([
      null,
      17,
      { id: "invalid-chat", harness: "omp", title: "Invalid", createdAt: 1, updatedAt: 2, messages: "no array" },
      valid,
      { id: "other-invalid", harness: 7, title: "Wrong type", createdAt: 1, updatedAt: 2, messages: [] },
    ], "phantom-chat", { address: 404, token: "x", harness: "omp" });

    await app.hydrate();
    const state = app.store.get();
    expect(state.hydrated).toBe(true);
    expect(state.settings).toBeNull();
    expect(state.activeId).toBeNull();
    expect(state.conversations.map((chat) => chat.id)).toEqual(["good-chat"]);
    expect(state.conversations[0]?.messages.map((message) => message.id)).toEqual(["valid-user", "valid-assistant"]);
    expect(app.locateTurn("phantom-turn")).toBeNull();
    expect(app.locateTurn("real-turn")).toEqual({
      conversationId: "good-chat", messageId: "valid-assistant",
    });
    expect(app.streamingTurns()).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("bad JSON and non-array persistence replace stale in-memory state safely", async () => {
    const ephemeral = {
      id: "memory-only", harness: "hermes", title: "Unsaved",
      createdAt: 1, updatedAt: 2, messages: [],
    } satisfies import("../model").Conversation;
    app.store.set({
      ...emptyState(),
      conversations: [ephemeral],
      activeId: ephemeral.id,
      settings: { address: "old:4747", token: "synthetic", harness: "omp", inAppFeedback: true },
    });
    persisted.set(KEYS.settings, "{broken");
    persisted.set(KEYS.conversations, "[broken");
    persisted.set(KEYS.activeId, ephemeral.id);

    await expect(app.hydrate()).resolves.toBeUndefined();
    expect(app.store.get()).toMatchObject({
      hydrated: true, settings: null, activeId: null, conversations: [],
    });

    persisted.set(KEYS.conversations, JSON.stringify(legacyChat("not-an-array")));
    await expect(app.hydrate()).resolves.toBeUndefined();
    expect(app.store.get().conversations).toEqual([]);
    expect(app.store.get().activeId).toBeNull();
    expect(writes).toEqual([]);
  });

  test("missing, empty, and orphaned active IDs never select a different chat", async () => {
    const rows = [legacyChat("first"), legacyChat("second")];
    for (const activeId of [undefined, "", "deleted-chat", "first "]) {
      seed(rows, activeId);
      await app.hydrate();
      expect(app.store.get().hydrated).toBe(true);
      expect(app.store.get().conversations.map((chat) => chat.id)).toEqual(["first", "second"]);
      expect(app.store.get().activeId).toBeNull();
    }
    expect(writes).toEqual([]);
  });

  test("rehydrates two independent streaming text snapshots into keyed store only", async () => {
    const one = legacyChat("chat-stream-one", {
      messages: [
        { id: "u-stream-one", role: "user", text: "Question A", at: 21 },
        { id: "a-stream-one", role: "assistant", text: "Partial A", at: 22, state: "streaming", turnId: "turn-stream-one", seq: 7 },
      ],
    });
    const two = legacyChat("chat-stream-two", {
      messages: [
        { id: "u-stream-two", role: "user", text: "Question B", at: 31 },
        { id: "a-stream-two", role: "assistant", text: "Partial B", at: 32, state: "streaming", turnId: "turn-stream-two", seq: 3 },
      ],
    });
    seededTurns.add("turn-stream-one");
    seededTurns.add("turn-stream-two");
    seed([one, two], "chat-stream-two");
    const notified: string[] = [];
    const offOne = replyText.subscribe("turn-stream-one", () => notified.push("one"));
    const offTwo = replyText.subscribe("turn-stream-two", () => notified.push("two"));
    try {
      await app.hydrate();
      expect(replyText.get("turn-stream-one")).toBe("Partial A");
      expect(replyText.get("turn-stream-two")).toBe("Partial B");
      expect(notified).toEqual(["one", "two"]);
      expect(app.streamingTurns()).toEqual([
        { id: "turn-stream-one", seq: 7 },
        { id: "turn-stream-two", seq: 3 },
      ]);
      expect(app.locateTurn("turn-stream-one")).toEqual({
        conversationId: "chat-stream-one", messageId: "a-stream-one",
      });
      expect(app.locateTurn("turn-stream-two")).toEqual({
        conversationId: "chat-stream-two", messageId: "a-stream-two",
      });
      expect(app.store.get().conversations.map((chat) => chat.messages.length)).toEqual([2, 2]);
      expect(app.store.get().conversations[0]?.messages[1]).toMatchObject({
        state: "streaming", text: "Partial A", seq: 7,
      });
      expect(app.store.get().conversations[1]?.messages[1]).toMatchObject({
        state: "streaming", text: "Partial B", seq: 3,
      });
      expect(app.store.get().activeId).toBe("chat-stream-two");
      expect(writes).toEqual([]);
    } finally {
      offOne();
      offTwo();
    }
  });
});
