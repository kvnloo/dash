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
const { profileFromAgent } = await import("../lib/roster");

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

describe("stop while queued", () => {
  test("stops the running turn and removes queued turns before they can send", () => {
    const t = turn();
    app.applyDeltas(new Map([[t.turnId, { text: "Partial", seq: 1 }]]));
    const queued = app.beginTurn(t.conversation.id, "next", { pending: true });
    const canceled: string[] = [];
    app.stopConversation(t.conversation.id, (id) => { canceled.push(id); });
    expect(canceled).toEqual([t.turnId]);
    expect(app.conversationBusy(t.conversation.id)).toBe(false);
    expect(app.flushPendingSends(() => { throw new Error("Stopped queue sent"); })).toBe(0);
    const messages = app.store.get().conversations[0]?.messages;
    expect(messages?.find((m) => m.id === t.messageId)).toMatchObject({ text: "Partial", state: "interrupted", status: "Stopped" });
    expect(messages?.find((m) => m.id === queued.messageId)).toMatchObject({ state: "interrupted" });
  });
  test("offline queued turn can be stopped without sending cancel", () => {
    const t = turn();
    app.parkUnsentTurn(t.turnId);
    const canceled: string[] = [];
    app.stopConversation(t.conversation.id, (id) => { canceled.push(id); });
    expect(canceled).toEqual([]);
    expect(app.conversationBusy(t.conversation.id)).toBe(false);
  });
});

describe("bot target identity", () => {
  test("selection retains host, profile, session and cwd without changing settings", () => {
    const host = {
      id: "self", name: "laptop", hostname: "laptop", online: true, self: true,
      agents: [{ id: "omp:project", name: "Project", kind: "omp", status: "running", cwd: "/work/project", sessionId: "session-project" }],
    } satisfies import("../../../shared/protocol").HostInfo;
    app.setConnection({ hosts: [host], harnesses: [{ id: "omp", name: "OMP", available: true }] });
    const profile = profileFromAgent(host, host.agents[0]);
    const result = app.openBotConversation(profile);
    expect(result).toHaveProperty("conversation");
    if (!("conversation" in result)) throw new Error(result.error);
    expect(result.conversation).toMatchObject({ targetHostId: "self", profileId: "omp:project", sessionId: "session-project", cwd: "/work/project", harness: "omp" });
    expect(app.store.get().settings).toBeNull();
    const again = app.openBotConversation(profile);
    expect(again).toEqual(result);
  });
  test("same harness on another host fails explicitly instead of opening local", () => {
    const host = {
      id: "remote", name: "remote", hostname: "remote", online: true, self: false,
      agents: [{ id: "omp:remote", name: "Remote", kind: "omp", status: "running", sessionId: "remote-session" }],
    } satisfies import("../../../shared/protocol").HostInfo;
    app.setConnection({ hosts: [host], harnesses: [{ id: "omp", name: "OMP", available: true }] });
    const before = app.store.get().conversations;
    expect(app.openBotConversation(profileFromAgent(host, host.agents[0]))).toEqual({ error: expect.stringContaining("remote") });
    expect(app.store.get().conversations).toBe(before);
  });
  test("a stale or unavailable target does not select another profile", () => {
    expect(app.openBotConversation({ id: "gone:omp", targetHostId: "gone", profileId: "omp", harness: "omp", name: "Gone", role: "gone", description: "gone", online: true })).toEqual({ error: expect.any(String) });
    expect(app.store.get().conversations).toHaveLength(0);
  });
});

describe("stream checkpoints and late events", () => {
  test("a saved sequence checkpoint includes the preceding keyed text", async () => {
    const t = turn();
    app.applyDeltas(new Map([[t.turnId, { text: "Before restart", seq: 1 }]]));
    app.applyTurnEvent({ type: "status", id: t.turnId, seq: 2, text: "Working" });
    await new Promise((resolve) => setTimeout(resolve, 450));
    app.store.set((s) => ({ ...s, conversations: [] }));
    await app.hydrate();
    expect(assistant(t.conversation.id)).toMatchObject({ text: "Before restart", seq: 2 });
  });
  test("late status cannot overwrite stopped state", () => {
    const t = turn();
    app.stopConversation(t.conversation.id, () => {});
    app.applyTurnEvent({ type: "status", id: t.turnId, seq: 2, text: "Thinking" });
    expect(assistant(t.conversation.id)).toMatchObject({ state: "interrupted", status: "Stopped" });
  });
  test("an unavailable saved target is rejected locally with an explicit error", () => {
    const c = app.createConversation("omp", { targetHostId: "remote", profileId: "agent" });
    const t = app.beginTurn(c.id, "do work");
    expect(app.rejectUnavailableTurn(t.turnId)).toBe(true);
    expect(assistant(c.id)).toMatchObject({ state: "error", error: expect.stringContaining("unavailable") });
  });
});

describe("project agent actions", () => {
  test("installed harness project row opens a chat in the bridge directory", async () => {
    const host = { id: "self", name: "laptop", hostname: "laptop", online: true, self: true,
      agents: [{ id: "harness:omp", name: "OMP", kind: "omp", status: "available" }],
    } satisfies import("../../../shared/protocol").HostInfo;
    app.setConnection({ hosts: [host], cwd: "/work/actual", harnesses: [{ id: "omp", name: "OMP", available: true }] });
    const { projectsFromHosts } = await import("../lib/project-data");
    const row = projectsFromHosts({ hosts: [host], cwd: "/work/actual", conversations: [], now: 1 })[0]?.agentRows[0];
    if (!row) throw new Error("Missing actual agent row");
    const result = app.openBotConversation(row);
    if (!("conversation" in result)) throw new Error(result.error);
    expect(result.conversation).toMatchObject({ targetHostId: "self", profileId: "harness:omp", cwd: "/work/actual" });
    const t = app.beginTurn(result.conversation.id, "hello");
    app.applyTurnEvent({ type: "session", id: t.turnId, seq: 1, sessionId: "new-session" });
    const current = app.store.get().conversations.find((c) => c.id === result.conversation.id);
    if (!current) throw new Error("Missing target chat");
    expect(app.conversationTargetError(current)).toBeUndefined();
  });
});

describe("outbound target boundary", () => {
  test("voice rejection does not report an opened utterance", async () => {
    mock.module("react-native", () => ({ AppState: { currentState: "active", addEventListener() { return { remove() {} }; } } }));
    const { sendVoiceBegin } = await import("../net/bridge");
    const c = app.createConversation("omp", { targetHostId: "gone", profileId: "agent" });
    const t = app.beginTurn(c.id, "");
    expect(sendVoiceBegin({ turnId: t.turnId, harness: "omp", mime: "audio/m4a" })).toBe(false);
    expect(assistant(c.id)).toMatchObject({ state: "error", error: expect.stringContaining("unavailable") });
  });
  test("rejected chat cannot be parked and retried against the local host", () => {
    const c = app.createConversation("omp", { targetHostId: "gone", profileId: "agent" });
    const t = app.beginTurn(c.id, "hello");
    app.rejectUnavailableTurn(t.turnId);
    expect(app.parkUnsentTurn(t.turnId)).toBe(false);
    expect(assistant(c.id).state).toBe("error");
  });
});
