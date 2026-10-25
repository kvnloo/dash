import { spawnSync } from "node:child_process";
import { test } from "bun:test";

// app.ts imports a native storage module. Run each case in a fresh Bun process:
// mock.module cannot leak into the other app/store test files, and each process
// releases its store singleton, subscribers, persistence timer and keyed maps.
const appUrl = new URL("./app.ts", import.meta.url).href;

function runIsolated(assertions: string[]): void {
  const script = [
    'import assert from "node:assert/strict";',
    'import { mock } from "bun:test";',
    "const persisted = new Map();",
    'mock.module("@react-native-async-storage/async-storage", () => ({',
    "  default: {",
    "    async multiGet(keys) { return keys.map(key => [key, persisted.get(key) ?? null]); },",
    "    async multiSet(entries) { for (const [key, value] of entries) persisted.set(key, value); },",
    "    async setItem(key, value) { persisted.set(key, value); },",
    "    async multiRemove(keys) { for (const key of keys) persisted.delete(key); },",
    "  },",
    "}));",
    "globalThis.requestAnimationFrame = fn => setTimeout(() => fn(0), 0);",
    "const app = await import(" + JSON.stringify(appUrl) + ");",
    'app.store.set({ hydrated: true, settings: null, connection: { status: "online", harnesses: [], hosts: [] }, conversations: [], activeId: null });',
    ...assertions,
    // Timers belong only to this disposable child, not the outer test runner.
    "process.exit(0);",
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: import.meta.dir,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Isolated beginTurn case failed (" + String(result.status ?? result.signal) + ")\n" + result.stderr + "\n" + result.stdout);
  }
}

test("fresh sends generate unique user, assistant and turn identities scoped to their conversations", () => {
  runIsolated([
    'const a = app.createConversation("omp", { id: "chat-a", title: "Host A", targetHostId: "host-a", profileId: "omp:a", sessionId: "session-a", cwd: "/repo/a" });',
    'const b = app.createConversation("hermes", { id: "chat-b", title: "Host B", targetHostId: "host-b", profileId: "hermes:b" });',
    'const first = app.beginTurn(a.id, "Run tests");',
    'const second = app.beginTurn(a.id, "Explain changes");',
    'assert.deepEqual(app.store.get().conversations.map(c => c.id), [a.id, b.id]);',
    'const third = app.beginTurn(b.id, "Other host");',
    'const state = app.store.get();',
    'const messagesA = state.conversations.find(c => c.id === a.id).messages;',
    'const messagesB = state.conversations.find(c => c.id === b.id).messages;',
    'assert.equal(state.conversations.length, 2);',
    'assert.deepEqual(state.conversations.map(c => c.id), [b.id, a.id]);',
    'assert.deepEqual(messagesA.map(m => m.role), ["user", "assistant", "user", "assistant"]);',
    'assert.deepEqual(messagesA.map(m => m.text), ["Run tests", "", "Explain changes", ""]);',
    'assert.deepEqual(messagesB.map(m => m.role), ["user", "assistant"]);',
    'assert.equal(new Set([first.turnId, first.messageId, second.turnId, second.messageId, third.turnId, third.messageId, ...messagesA.map(m => m.id), ...messagesB.map(m => m.id)]).size, 9);',
    'assert.deepEqual([messagesA[1].id, messagesA[1].turnId, messagesA[1].seq, messagesA[1].state], [first.messageId, first.turnId, 0, "streaming"]);',
    'assert.deepEqual([messagesA[3].id, messagesA[3].turnId, messagesA[3].state], [second.messageId, second.turnId, "streaming"]);',
    'assert.deepEqual([messagesB[1].id, messagesB[1].turnId, messagesB[1].state], [third.messageId, third.turnId, "streaming"]);',
    'assert.equal(messagesA[0].delivery, undefined);',
    'assert.equal(messagesA[2].delivery, undefined);',
    'assert.deepEqual(app.locateTurn(first.turnId), { conversationId: a.id, messageId: first.messageId });',
    'assert.deepEqual(app.locateTurn(second.turnId), { conversationId: a.id, messageId: second.messageId });',
    'assert.deepEqual(app.locateTurn(third.turnId), { conversationId: b.id, messageId: third.messageId });',
  ]);
});

test("queued mode retains the exact attachment payload and host identity across promotion", () => {
  runIsolated([
    'const chat = app.createConversation("hermes", { title: "Pinned", targetHostId: "mbp", profileId: "hermes:session:alpha", sessionId: "session-42", cwd: "/work/dash" });',
    'const running = app.beginTurn(chat.id, "Active work");',
    'const original = app.store.get().conversations[0].messages.slice();',
    'const file = { id: "a".repeat(32), name: "fix.patch", mime: "text/x-patch", size: 135 };',
    'const queued = app.beginTurn(chat.id, "Review this patch", { pending: true, mode: "queue", attachments: [file] });',
    'const before = app.store.get().conversations[0];',
    'assert.deepEqual(before.messages.map(m => m.role), ["user", "assistant", "user", "assistant"]);',
    'assert.strictEqual(before.messages[0], original[0]);',
    'assert.strictEqual(before.messages[1], original[1]);',
    'assert.equal(before.messages[2].delivery, "queued");',
    'assert.strictEqual(before.messages[2].attachments[0], file);',
    'assert.equal(before.messages[3].id, queued.messageId);',
    'assert.equal(before.messages[3].turnId, queued.turnId);',
    'assert.equal(before.messages[3].state, "pending");',
    'assert.equal(before.messages[3].seq, 0);',
    'assert.equal(before.title, "Pinned");',
    'assert.deepEqual([before.targetHostId, before.profileId, before.sessionId, before.cwd, before.harness], ["mbp", "hermes:session:alpha", "session-42", "/work/dash", "hermes"]);',
    'assert.deepEqual(app.promotePendingTurn(queued.turnId), { text: "Review this patch", harness: "hermes", sessionId: "session-42", attachments: [file] });',
    'const after = app.store.get().conversations[0];',
    'assert.equal(after.messages[2].delivery, "started");',
    'assert.equal(after.messages[3].state, "streaming");',
    'assert.equal(after.messages[3].id, queued.messageId);',
    'assert.equal(after.messages[3].turnId, queued.turnId);',
    'assert.equal(after.messages[1].turnId, running.turnId);',
    'assert.equal(after.messages[1].state, "streaming");',
    'assert.strictEqual(after.messages[2].attachments[0], file);',
    'assert.deepEqual(app.locateTurn(queued.turnId), { conversationId: chat.id, messageId: queued.messageId });',
    'assert.equal(app.promotePendingTurn(queued.turnId), null);',
    'assert.deepEqual([after.targetHostId, after.profileId, after.sessionId, after.cwd], ["mbp", "hermes:session:alpha", "session-42", "/work/dash"]);',
  ]);
});

test("steer mode is a receipt-bound pair, not a replacement for the running turn", () => {
  runIsolated([
    'const chat = app.createConversation("hermes", { title: "Live agent", targetHostId: "groot", profileId: "hermes:active", sessionId: "live-1" });',
    'const running = app.beginTurn(chat.id, "Working");',
    'const file = { id: "b".repeat(32), name: "note.txt", mime: "text/plain", size: 12 };',
    'const steer = app.beginTurn(chat.id, "Change course", { mode: "steer", attachments: [file] });',
    'const initial = app.store.get().conversations[0];',
    'assert.equal(initial.messages[2].delivery, "steering");',
    'assert.deepEqual(initial.messages[2].attachments, [file]);',
    'assert.deepEqual([initial.messages[3].id, initial.messages[3].turnId, initial.messages[3].state, initial.messages[3].text, initial.messages[3].seq], [steer.messageId, steer.turnId, "streaming", "", 0]);',
    'assert.equal(initial.messages[1].turnId, running.turnId);',
    'app.applyTurnEvent({ type: "status", id: steer.turnId, seq: 1, text: "Steered", delivery: "steered", deliveryAt: 42 });',
    'app.applyTurnEvent({ type: "done", id: steer.turnId, seq: 2, exitCode: 0 });',
    'const after = app.store.get().conversations[0];',
    'assert.equal(after.messages[2].delivery, "steered");',
    'assert.equal(after.messages[2].deliveryAt, 42);',
    'assert.equal(after.messages[3].delivery, "steered");',
    'assert.equal(after.messages[3].state, "done");',
    'assert.equal(after.messages[3].text, "");',
    'assert.equal(after.messages[3].error, undefined);',
    'assert.equal(after.messages[1].state, "streaming");',
    'assert.deepEqual(app.locateTurn(running.turnId), { conversationId: chat.id, messageId: running.messageId });',
    'assert.deepEqual(app.locateTurn(steer.turnId), { conversationId: chat.id, messageId: steer.messageId });',
    'assert.equal(app.store.get().conversations.length, 1);',
    'assert.deepEqual([after.targetHostId, after.profileId, after.sessionId], ["groot", "hermes:active", "live-1"]);',
  ]);
});

test("first text or attachment titles the local chat once; a session retains its host title", () => {
  runIsolated([
    'const file = { id: "c".repeat(32), name: "screenshot.png", mime: "image/png", size: 2048 };',
    'const fromFile = app.createConversation("omp");',
    'const first = app.beginTurn(fromFile.id, "", { attachments: [file] });',
    'const fileChat = app.store.get().conversations.find(c => c.id === fromFile.id);',
    'assert.equal(fileChat.title, "screenshot.png");',
    'assert.equal(fileChat.messages[0].text, "");',
    'assert.strictEqual(fileChat.messages[0].attachments[0], file);',
    'assert.equal(fileChat.messages[1].id, first.messageId);',
    'app.beginTurn(fromFile.id, "Later text", { attachments: [] });',
    'assert.equal(app.store.get().conversations.find(c => c.id === fromFile.id).title, "screenshot.png");',
    'const textChat = app.createConversation("omp");',
    'app.beginTurn(textChat.id, "  Investigate startup\\nwith repro  ");',
    'assert.equal(app.store.get().conversations.find(c => c.id === textChat.id).title, "Investigate startup");',
    'const hosted = app.createConversation("hermes", { title: "Remote agent title", sessionId: "remote-session" });',
    'app.beginTurn(hosted.id, "Should not rename a host session");',
    'assert.equal(app.store.get().conversations.find(c => c.id === hosted.id).title, "Remote agent title");',
    'assert.equal(app.store.get().conversations.length, 3);',
  ]);
});

test("queue preview, message order and unrelated conversations survive interleaved sends", () => {
  runIsolated([
    'const other = app.createConversation("omp", { id: "other-chat" });',
    'app.beginTurn(other.id, "Keep this history");',
    'const savedUser = app.store.get().conversations[0].messages[0];',
    'const chat = app.createConversation("omp", { id: "queue-chat", title: "Queue title" });',
    'app.store.set(s => ({ ...s, conversations: s.conversations.map(c => c.id === chat.id ? { ...c, queuePreview: "Existing preview" } : c) }));',
    'const a = app.beginTurn(chat.id, "First queued", { pending: true, mode: "queue" });',
    'const b = app.beginTurn(chat.id, "Second queued", { pending: true });',
    'const queue = app.store.get().conversations.find(c => c.id === chat.id);',
    'assert.equal(queue.queuePreview, "Existing preview\\n\\nFirst queued\\n\\nSecond queued");',
    'assert.deepEqual(queue.messages.map(m => m.text), ["First queued", "", "Second queued", ""]);',
    'assert.deepEqual(queue.messages.filter(m => m.role === "user").map(m => m.delivery), ["queued", "queued"]);',
    'assert.deepEqual(queue.messages.filter(m => m.role === "assistant").map(m => m.state), ["pending", "pending"]);',
    'assert.deepEqual(queue.messages.filter(m => m.role === "assistant").map(m => m.turnId), [a.turnId, b.turnId]);',
    'app.beginTurn(other.id, "Append without duplicating");',
    'const state = app.store.get();',
    'assert.deepEqual(state.conversations.map(c => c.id), [other.id, chat.id]);',
    'assert.equal(new Set(state.conversations.map(c => c.id)).size, 2);',
    'assert.strictEqual(state.conversations[0].messages[0], savedUser);',
    'assert.deepEqual(state.conversations[0].messages.map(m => m.text), ["Keep this history", "", "Append without duplicating", ""]);',
    'assert.equal(state.conversations[1].queuePreview, "Existing preview\\n\\nFirst queued\\n\\nSecond queued");',
    'assert.equal(state.conversations[1].title, "Queue title");',
    'assert.deepEqual(app.locateTurn(a.turnId), { conversationId: chat.id, messageId: a.messageId });',
    'assert.deepEqual(app.locateTurn(b.turnId), { conversationId: chat.id, messageId: b.messageId });',
  ]);
});
