import { beforeEach, expect, mock, test } from "bun:test";
mock.module("@react-native-async-storage/async-storage", () => ({ default: { async getItem() { return null; }, async multiGet() { return []; }, async multiSet() {}, async setItem() {}, async multiRemove() {} } }));
const app = await import("./app");
const { parseConversation } = await import("../model");
beforeEach(() => app.store.set({ hydrated: true, settings: null, connection: { status: "online", harnesses: [], hosts: [] }, conversations: [], activeId: null }));
test("steer receipt marks its user, has no fake reply, survives restore and stale replay", () => {
  const chat = app.createConversation("hermes"); const original = app.beginTurn(chat.id, "long tool"); const steer = app.beginTurn(chat.id, "change course", { mode: "steer" });
  expect(app.store.get().conversations[0]?.messages.at(-2)).toMatchObject({ delivery: "steering" });
  app.applyTurnEvent({ type: "status", id: steer.turnId, seq: 2, text: "Steered the running turn.", delivery: "steered", deliveryAt: 42 });
  app.applyTurnEvent({ type: "status", id: steer.turnId, seq: 1, text: "stale", delivery: "queued" });
  app.applyTurnEvent({ type: "done", id: steer.turnId, seq: 3, exitCode: 0 });
  const restored = parseConversation(JSON.parse(JSON.stringify(app.store.get().conversations[0])));
  expect(restored?.messages.at(-2)).toMatchObject({ text: "change course", delivery: "steered", deliveryAt: 42 });
  expect(restored?.messages.at(-1)).toMatchObject({ state: "done", text: "", delivery: "steered", error: undefined });
  expect(restored?.messages.find(m => m.id === original.messageId)).toMatchObject({ state: "streaming" });
});
test("fallback is visibly pending until actual start, error is not labelled steered", () => {
  const chat = app.createConversation("hermes"); const turn = app.beginTurn(chat.id, "changed", { mode: "steer" });
  app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 1, text: "The turn stopped accepting steering; queued for the next turn instead.", delivery: "queued" });
  expect(app.store.get().conversations[0]?.messages.at(-2)).toMatchObject({ delivery: "queued" });
  app.applyTurnEvent({ type: "status", id: turn.turnId, seq: 2, text: "Next turn started.", delivery: "started" });
  expect(app.store.get().conversations[0]?.messages.at(-2)).toMatchObject({ delivery: "started" });
  app.applyTurnEvent({ type: "error", id: turn.turnId, seq: 3, message: "outcome unknown" });
  expect(app.store.get().conversations[0]?.messages.at(-2)).toMatchObject({ delivery: "failed" });
});
test("local queue stays pending until promoted", () => {
  const chat = app.createConversation("hermes"); const turn = app.beginTurn(chat.id, "later", { pending: true });
  expect(app.store.get().conversations[0]?.messages.at(-2)).toMatchObject({ delivery: "queued" });
  expect(app.store.get().conversations[0]?.messages.at(-1)).toMatchObject({ state: "pending" });
  expect(app.promotePendingTurn(turn.turnId)?.text).toBe("later");
  expect(app.store.get().conversations[0]?.messages.at(-1)).toMatchObject({ state: "streaming" });
});
