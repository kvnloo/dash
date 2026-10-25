import { beforeEach, expect, mock, test } from "bun:test";

mock.module("@react-native-async-storage/async-storage", () => ({ default: {
  multiSet: async () => {}, setItem: async () => {}, multiRemove: async () => {},
  getItem: async () => null, getAllKeys: async () => [], removeItem: async () => {},
  multiGet: async (keys: string[]) => keys.map(key => [key, null]),
} }));
Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) });
const app = await import("./app");
const { replyText, replyParts, replySummaries } = await import("./text");

beforeEach(() => {
  app.store.set({ hydrated: true, settings: null, connection: { status: "online", harnesses: [], hosts: [] }, conversations: [], activeId: null });
});

for (const end of ["done", "error", "stop", "lost"] as const) {
  test(`${end} checkpoints the reply and releases the streaming copies`, () => {
    const chat = app.createConversation("omp");
    const turn = app.beginTurn(chat.id, "Check retention");
    app.applyDeltas(new Map([[turn.turnId, { text: "answer", seq: 1 }]]));
    app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 2, text: "", part: { kind: "reasoning", text: "reason" } });
    if (end === "done") app.applyTurnEvent({ type: "done", id: turn.turnId, seq: 3, exitCode: 0 });
    if (end === "error") app.applyTurnEvent({ type: "error", id: turn.turnId, seq: 3, message: "failed" });
    if (end === "stop") app.stopConversation(chat.id, () => {});
    if (end === "lost") app.markTurnLost(turn.turnId);
    expect(app.store.get().conversations[0]?.messages.at(-1)).toMatchObject({ text: "answer", parts: [{ kind: "reasoning", text: "reason" }], endedAt: expect.any(Number) });
    expect(replyText.get(turn.turnId)).toBe("");
    expect(replyParts.get(turn.turnId)).toBe("");
  });
}

test("deleting a chat releases live and lazily loaded detail/summary caches, without touching another chat", () => {
  const removed = app.createConversation("omp"), kept = app.createConversation("omp");
  const a = app.beginTurn(removed.id, "remove"), b = app.beginTurn(kept.id, "keep");
  replyText.set(a.turnId, "removed"); replyText.set(b.turnId, "kept");
  replyParts.set(a.turnId, JSON.stringify([{ kind: "reasoning", text: "removed details" }]));
  const summary = { blockId: "summary", kind: "turn", text: "summary", model: "fixture", durationMs: 1 } as const;
  app.applyTurnEvent({ type: "status", id: a.turnId, seq: 1, text: "", summary });
  app.deleteConversation(removed.id);
  expect(replyText.get(a.turnId)).toBe("");
  expect(replyParts.get(a.turnId)).toBe("");
  expect(replySummaries.get(`${a.turnId}:turn`)).toBe("");
  expect(replyText.get(b.turnId)).toBe("kept");
});

test("settlement observers can still flush the last coalesced text before release", async () => {
  const { onTurnSettled } = await import("./queue");
  const chat = app.createConversation("omp"), turn = app.beginTurn(chat.id, "speak");
  app.applyDeltas(new Map([[turn.turnId, { text: "last sentence", seq: 1 }]]));
  let finalText = "";
  const off = onTurnSettled(id => { if (id === chat.id) finalText = replyText.get(turn.turnId); });
  try { app.applyTurnEvent({ type: "done", id: turn.turnId, seq: 2, exitCode: 0 }); } finally { off(); }
  expect(finalText).toBe("last sentence");
  expect(replyText.get(turn.turnId)).toBe("");
});

test("stale completion cannot discard still-streaming text or parts", () => {
  const chat = app.createConversation("omp"), turn = app.beginTurn(chat.id, "continue");
  app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 10, text: "working" });
  replyText.set(turn.turnId, "newer");
  app.applyTurnEvent({ type: "done", id: turn.turnId, seq: 9, exitCode: 0 });
  expect(replyText.get(turn.turnId)).toBe("newer");
});

test("delete also releases summary blocks older than the persisted 64-block window", () => {
  const chat = app.createConversation("omp"), turn = app.beginTurn(chat.id, "summaries");
  for (let seq = 1; seq <= 70; seq++) app.applyTurnEvent({ type: "status", id: turn.turnId, seq, text: "", summary: { blockId: String(seq), kind: "live", text: "summary", model: "fixture", durationMs: 1 } });
  expect(replySummaries.get(`${turn.turnId}:1`)).not.toBe("");
  app.deleteConversation(chat.id);
  for (let seq = 1; seq <= 70; seq++) expect(replySummaries.get(`${turn.turnId}:${seq}`)).toBe("");
});

test("a replayed done does not evict details explicitly loaded after completion", () => {
  const chat = app.createConversation("omp"), turn = app.beginTurn(chat.id, "details");
  app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 1, text: "", part: { kind: "tool_start", callId: "call", name: "terminal", args: "{}", summary: "test" } });
  replyText.set(turn.turnId, "answer");
  app.applyTurnEvent({ type: "done", id: turn.turnId, seq: 2, exitCode: 0 });
  app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 3, text: "", part: { kind: "tool_detail", callId: "call", args: "{}", text: "loaded on demand", truncated: false } });
  const loaded = replyParts.get(turn.turnId);
  expect(loaded).toContain("loaded on demand");
  app.applyTurnEvent({ type: "done", id: turn.turnId, seq: 2, exitCode: 0 });
  expect(replyParts.get(turn.turnId)).toBe(loaded);
  app.deleteConversation(chat.id);
  expect(replyParts.get(turn.turnId)).toBe("");
});

test("forget and ended-chat cleanup release their cached replies", async () => {
  for (const kind of ["ended", "forget"] as const) {
    const chat = app.createConversation("omp"), turn = app.beginTurn(chat.id, "remove");
    replyText.set(turn.turnId, "retained");
    if (kind === "ended") {
      app.store.set(s => ({ ...s, conversations: s.conversations.map(c => c.id === chat.id ? { ...c, stale: true } : c) }));
      app.clearEndedConversations();
    } else await app.forgetEverything();
    expect(replyText.get(turn.turnId)).toBe("");
  }
});
