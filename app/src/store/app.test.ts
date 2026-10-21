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

test("actual tool/thinking statuses survive completion and replay cannot duplicate them", () => {
  const chat = app.createConversation("omp");
  const turn = app.beginTurn(chat.id, "Read the file");
  app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 1, text: "Read app/src/model.ts" });
  app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 1, text: "Replay must not appear" });
  app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 2, text: "Checking the result" });
  replyText.set(turn.turnId, "The test passed.");
  app.applyTurnEvent({ type: "done", id: turn.turnId, seq: 3, exitCode: 0 });
  const reply = app.store.get().conversations.find(c => c.id === chat.id)?.messages.find(m => m.id === turn.messageId);
  expect(reply).toMatchObject({ state: "done", status: undefined, activity: ["Read app/src/model.ts", "Checking the result"] });
});

describe("host roster reconciliation", () => {
  const agent = { id: "hermes:session:clean:owner", name: "Debug Hermes crashing", kind: "hermes", status: "available" as const, sessionId: "owner", profileId: "clean", cwd: "/project", lastActivityAt: 1700000000000, messageCount: 3 };
  const host = { id: "groot", name: "groot", hostname: "groot", online: true, self: true, agents: [agent] };
  test("every refresh updates titles/activity, marks ended without deleting history, and revives", () => {
    app.setConnection({ hosts: [host], harnesses: [{ id: "hermes", name: "Hermes", available: true }] });
    const first = app.store.get().conversations[0]!;
    expect(first).toMatchObject({ title: agent.name, profileName: "clean", updatedAt: agent.lastActivityAt, stale: false });
    const history = [{ id: "h1", role: "user" as const, text: "previous", at: 1699999999999 }];
    app.applyLiveHistory("hermes", "owner", history, "groot", agent.id);
    app.setConnection({ hosts: [{ ...host, agents: [] }] });
    expect(app.store.get().conversations[0]).toMatchObject({ id: first.id, stale: true, messages: history });
    expect(app.conversationTargetError(app.store.get().conversations[0]!)).toContain("ended");
    app.setConnection({ status: "offline" }); // no successful roster, no extra reconciliation
    expect(app.store.get().conversations).toHaveLength(1);
    app.setConnection({ hosts: [{ ...host, agents: [{ ...agent, name: "New real title", lastActivityAt: agent.lastActivityAt + 10000 }] }] });
    expect(app.store.get().conversations).toHaveLength(1);
    expect(app.store.get().conversations[0]).toMatchObject({ id: first.id, title: "New real title", stale: false, messages: history });
  });
  test("history from a bridge that names itself by OS hostname lands in the MagicDNS-keyed chat", () => {
    // groot's tailnet label is "0": the roster keys it "0", an older bridge replies hostId "groot".
    const renamed = { ...host, id: "0", name: "0", hostname: "groot" };
    app.setConnection({ host: "groot", hosts: [renamed], harnesses: [{ id: "hermes", name: "Hermes", available: true }] });
    const chat = app.store.get().conversations[0]!;
    expect(chat.targetHostId).toBe("0");
    const history = [{ id: "h1", role: "assistant" as const, text: "real transcript", at: agent.lastActivityAt }];
    app.applyLiveHistory("hermes", "owner", history, "groot", agent.id);
    expect(app.store.get().conversations[0]!.messages).toMatchObject([{ id: "h1", role: "assistant", text: "real transcript", state: "done" }]);
    expect(app.rosterHostId("groot", app.store.get().connection)).toBe("0");
    expect(app.rosterHostId("0", app.store.get().connection)).toBe("0");
    expect(app.rosterHostId("mbp", app.store.get().connection)).toBe("mbp");
    expect(app.conversationTargetError(app.store.get().conversations[0]!)).toBeUndefined();
  });
  test("old unscoped OMP chat becomes ended and Clear ended preserves new chats", () => {
    const old = app.createConversation("omp", { sessionId: "dead-omp" });
    app.beginTurn(old.id, "saved message");
    app.setConnection({ hosts: [host] });
    const ended = app.store.get().conversations.find(c => c.id === old.id)!;
    expect(ended.stale).toBe(true);
    expect(app.conversationTargetError(ended)).toContain("ended");
    app.clearEndedConversations();
    expect(app.store.get().conversations).toHaveLength(1);
    expect(app.store.get().activeId).toBeNull();
  });
  test("a CLI-held Hermes chat says so, and clears when the CLI closes or the chat ends", () => {
    app.setConnection({ hosts: [{ ...host, agents: [{ ...agent, openIn: "CLI" }] }], harnesses: [{ id: "hermes", name: "Hermes", available: true }] });
    const held = app.store.get().conversations[0]!;
    expect(held.openIn).toBe("CLI");
    expect(app.conversationTargetError(held)).toBeUndefined(); // replies are allowed: they queue on the host
    app.setConnection({ hosts: [host] });
    expect(app.store.get().conversations[0]?.openIn).toBeUndefined();
    app.setConnection({ hosts: [{ ...host, agents: [{ ...agent, openIn: "CLI" }] }] });
    app.setConnection({ hosts: [{ ...host, agents: [] }] });
    expect(app.store.get().conversations[0]).toMatchObject({ stale: true, openIn: undefined });
  });
  test("a queued handoff reply is shown as waiting, then settles like any turn", () => {
    app.setConnection({ hosts: [{ ...host, agents: [{ ...agent, openIn: "CLI" }] }], harnesses: [{ id: "hermes", name: "Hermes", available: true }] });
    const c = app.store.get().conversations[0]!;
    const t = app.beginTurn(c.id, "reply from the phone");
    app.applyTurnEvent({ type: "status", id: t.turnId, seq: 1, text: "Open in CLI on groot · reply queued until it closes", handoff: { state: "queued", surface: "cli", host: "groot" } });
    const waiting = () => app.store.get().conversations[0]!.messages.find(m => m.id === t.messageId);
    expect(waiting()).toMatchObject({ state: "streaming", handoff: "queued", status: "Open in CLI on groot · reply queued until it closes" });
    app.applyTurnEvent({ type: "status", id: t.turnId, seq: 2, text: "CLI on groot closed · sending queued reply", handoff: { state: "sending", surface: "cli", host: "groot" } });
    expect(waiting()).toMatchObject({ handoff: "sending" });
    app.applyTurnEvent({ type: "status", id: t.turnId, seq: 3, text: "Thinking" });
    const after = waiting();
    expect(after?.role === "assistant" ? after.handoff : "not an assistant").toBeUndefined();
    replyText.set(t.turnId, "done");
    app.applyTurnEvent({ type: "done", id: t.turnId, seq: 4, exitCode: 0 });
    expect(waiting()).toMatchObject({ state: "done", handoff: undefined });
  });
  test("a new Hermes chat adopts the host profile identity from its ACP session event", () => {
    app.setConnection({ hosts: [host], harnesses: [{ id: "hermes", name: "Hermes", available: true }] });
    const fresh = app.createConversation("hermes", { profileId: "hermes:default", targetHostId: "groot" });
    const t = app.beginTurn(fresh.id, "hello");
    app.applyTurnEvent({ type: "session", id: t.turnId, seq: 1, sessionId: "new-acp", hostId: "groot", profileId: "hermes:session:clean:new-acp", harnessId: "hermes", transport: "acp" });
    expect(app.store.get().conversations.find(c => c.id === fresh.id)).toMatchObject({ sessionId: "new-acp", profileId: "hermes:session:clean:new-acp" });
    const before = app.store.get().conversations.length;
    app.setConnection({ hosts: [{ ...host, agents: [agent, { ...agent, id: "hermes:session:clean:new-acp", sessionId: "new-acp", name: "Hello" }] }] });
    // Merged into the phone's chat, not adopted as a duplicate row.
    expect(app.store.get().conversations.filter(c => c.sessionId === "new-acp")).toHaveLength(1);
    expect(app.store.get().conversations.length).toBe(before);
    const omp = app.createConversation("omp");
    const o = app.beginTurn(omp.id, "x");
    app.applyTurnEvent({ type: "session", id: o.turnId, seq: 1, sessionId: "omp-1", profileId: "default", transport: "acp" });
    expect(app.store.get().conversations.find(c => c.id === omp.id)?.profileId).toBeUndefined();
  });
  test("same session id in two profiles stays distinct; history cannot cross targets", () => {
    const other = { ...agent, id: "hermes:session:other:owner", profileId: "other" };
    app.setConnection({ hosts: [{ ...host, agents: [agent, other] }] });
    expect(new Set(app.store.get().conversations.map(c => c.id)).size).toBe(2);
    app.applyLiveHistory("hermes", "owner", [{ id: "h", role: "assistant", text: "only clean", at: agent.lastActivityAt }], "groot", agent.id);
    expect(app.store.get().conversations.find(c => c.profileId === other.id)?.messages).toHaveLength(0);
    app.applyLiveHistory("hermes", "owner", [{ id: "h2", role: "assistant", text: "new latest", at: agent.lastActivityAt + 1 }], "groot", agent.id);
    expect(app.store.get().conversations.find(c => c.profileId === agent.id)?.messages.at(-1)?.text).toBe("new latest");
  });
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
    const agent = host.agents[0];
    if (!agent) throw new Error("Missing fixture agent");
    const profile = profileFromAgent(host, agent);
    const result = app.openAgentConversation(profile);
    expect(result).toHaveProperty("conversation");
    if (!("conversation" in result)) throw new Error(result.error);
    expect(result.conversation).toMatchObject({ targetHostId: "self", profileId: "omp:project", sessionId: "session-project", cwd: "/work/project", harness: "omp" });
    expect(app.store.get().settings).toBeNull();
    const again = app.openAgentConversation(profile);
    expect(again).toEqual(result);
  });
  test("same harness on another host fails explicitly instead of opening local", () => {
    const host = {
      id: "remote", name: "remote", hostname: "remote", online: true, self: false,
      agents: [{ id: "omp:remote", name: "Remote", kind: "omp", status: "running", sessionId: "remote-session" }],
    } satisfies import("../../../shared/protocol").HostInfo;
    app.setConnection({ hosts: [host], harnesses: [{ id: "omp", name: "OMP", available: true }] });
    const before = app.store.get().conversations;
    const agent = host.agents[0];
    if (!agent) throw new Error("Missing fixture agent");
    expect(app.openAgentConversation(profileFromAgent(host, agent))).toEqual({ error: expect.stringContaining("remote") });
    expect(app.store.get().conversations).toBe(before);
  });
  test("a stale or unavailable target does not select another profile", () => {
    expect(app.openAgentConversation({ id: "gone:omp", targetHostId: "gone", profileId: "omp", harness: "omp", name: "Gone", role: "gone", description: "gone", online: true })).toEqual({ error: expect.any(String) });
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
    const result = app.openAgentConversation(row);
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
    mock.module("react-native", () => ({ Platform: { OS: "android" }, AppState: { currentState: "active", addEventListener() { return { remove() {} }; } } }));
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
