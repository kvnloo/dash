// Runs in an isolated subprocess so module stubs cannot affect the application suite.
import { expect, mock } from "bun:test";
import type { LiveIntent } from "../../../shared/live";
import type { sendChat as ChatSend } from "../net/bridge";
const sent: Parameters<typeof ChatSend>[0][] = [];
const liveSent: { conversationId: string; intent: LiveIntent }[] = [];
let online = true;
mock.module("@react-native-async-storage/async-storage", () => ({ default: { multiSet: async () => {}, setItem: async () => {}, removeItem: async () => {}, getAllKeys: async () => [], getItem: async () => null } }));
mock.module("../net/bridge", () => ({ sendChat: (payload: Parameters<typeof ChatSend>[0]) => { sent.push(payload); return online; }, sendLiveIntent: (conversationId: string, intent: LiveIntent) => { liveSent.push({ conversationId, intent }); return online; } }));
function loadFixtureModules() {
  const { sendInlineIntent }: typeof import("./inline-intent") = require("./inline-intent");
  const { store }: typeof import("../store/app") = require("../store/app");
  const { beginOpen, applyLiveMessage }: typeof import("../store/live") = require("../store/live");
  return { sendInlineIntent, store, beginOpen, applyLiveMessage };
}
const { sendInlineIntent, store, beginOpen, applyLiveMessage } = loadFixtureModules();
const intent: LiveIntent = { controlId: "next", value: "inspect", label: "Inspect changes", surface: "dash-inline-genui" };
function reset(harness = "omp", stale = false) {
  store.set({ hydrated: true, settings: null, activeId: "chat", connection: { status: "online", harnesses: [], hosts: [] }, conversations: [{ id: "chat", title: "Source", harness, sessionId: "original-session", cwd: "/owned/project", createdAt: 1, updatedAt: 2, stale, messages: [{ id: "answer", role: "assistant", state: "done", turnId: "source", text: "choice", at: 1, seq: 1 }] }] });
}
for (const harness of ["omp", "hermes"]) {
  reset(harness);
  expect(sendInlineIntent("source", intent)).toBe(true);
  expect(sent.at(-1)).toMatchObject({ harness, sessionId: "original-session", cwd: "/owned/project" });
  expect(sent.at(-1)?.text).toContain(JSON.stringify(intent));
  expect(store.get().conversations[0]?.messages.at(-2)).toMatchObject({ role: "user", text: sent.at(-1)?.text });
  expect(sendInlineIntent("source", intent)).toBe(false); // newly running turn prevents double-send
}
reset(); store.set(s => ({ ...s, activeId: "different" })); expect(sendInlineIntent("source", intent)).toBe(false);
reset("omp", true); expect(sendInlineIntent("source", intent)).toBe(false);
reset(); store.set(s => ({ ...s, connection: { ...s.connection, status: "offline" } })); expect(sendInlineIntent("source", intent)).toBe(false);
reset(); expect(sendInlineIntent("missing", intent)).toBe(false);
expect(sendInlineIntent("source", { ...intent, controlId: "bad id" })).toBe(false);
reset(); online = false; expect(sendInlineIntent("source", intent)).toBe(false);
expect(store.get().conversations[0]?.messages.at(-1)).toMatchObject({ state: "error" }); online = true;
reset("hermes");
applyLiveMessage({ type: "live_opened", id: beginOpen("chat"), workerId: "worker", profileId: "profile", parentSessionId: "original-session", artifacts: [] });
expect(sendInlineIntent("source", intent)).toBe(true);
expect(liveSent).toEqual([{ conversationId: "chat", intent }]);
console.log("intent routing assertions passed (network/storage stubs; real stores and routing function)");
