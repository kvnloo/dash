import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { AssistantMessage, Conversation, Message, UserMessage } from "../model";
import { chatRow } from "./chat-row";

const base: Conversation = {
  id: "chat-1",
  harness: "hermes",
  title: " ",
  createdAt: 1,
  updatedAt: 2,
  messages: [],
};

function user(id: string, text: string): UserMessage {
  return { id, role: "user", text, at: 1 };
}

function reply(
  id: string,
  state: AssistantMessage["state"],
  text: string,
  extra: Partial<AssistantMessage> = {},
): AssistantMessage {
  return { id, role: "assistant", state, text, at: 2, turnId: id, seq: 0, ...extra };
}

/** Count only reads of message slots, not constant-time length or method lookups. */
function observedSlots(messages: Message[]) {
  let reads = 0;
  const tracked: Message[] = new Proxy(messages, {
    get(target, key, receiver) {
      if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { messages: tracked, reads: () => reads };
}

function largeTranscript(): Conversation {
  const payload = "x".repeat(4_096);
  const messages: Message[] = Array.from({ length: 4_096 }, (_, index) => user(`u-${index}`, payload));
  messages.push(reply("last-done", "done", `\n  Built the package. Further details follow.\n${"y".repeat(262_144)}`));
  messages.push(reply("live", "streaming", "partial", { status: "Running terminal   · lint  " }));
  return {
    ...base,
    id: "large-chat",
    title: "   Delivery fix   ",
    cwd: "/srv/projects/dash/",
    targetHostId: "host-42",
    profileId: "harness:hermes",
    messages,
  };
}

test("small transcript keeps the exact title, Windows target and first literal reply sentence", () => {
  const completed = reply("a", "done", `\n  \n Saved the patch! Follow-up notes.\n${"detail".repeat(50_000)}`);
  const messages: Message[] = [user("u1", "Please repair"), completed, user("u2", "Next request")];
  messages.forEach(message => Object.freeze(message));
  Object.freeze(messages);
  const chat: Conversation = { ...base, title: "  Pairing repair  ", cwd: " C:\\work\\dash\\ ", messages };
  Object.freeze(chat);

  expect(chatRow(chat, "Hermes CLI", "online")).toEqual({
    title: "Pairing repair",
    folder: "Folder · dash",
    folderPath: "C:\\work\\dash\\",
    outcome: "Saved the patch!",
    outcomeLabel: "Last reply",
    activity: "No active turn",
    needsAttention: false,
  });
  expect(chat.messages[1]).toBe(completed);
  expect(chat.cwd).toBe(" C:\\work\\dash\\ ");
});

test("4,096 older turns and a large reply tail leave the current row exact and read only recent slots", () => {
  const source = largeTranscript();
  source.messages.forEach(message => Object.freeze(message));
  Object.freeze(source.messages);
  const tracked = observedSlots(source.messages);
  const chat: Conversation = { ...source, messages: tracked.messages };
  Object.freeze(chat);

  expect(chatRow(chat, "Hermes", "online")).toEqual({
    title: "Delivery fix",
    folder: "Folder · dash",
    folderPath: "/srv/projects/dash/",
    outcome: "Built the package.",
    outcomeLabel: "Last reply",
    activity: "Running terminal · lint",
    needsAttention: false,
  });
  // Reverse outcome scan: streaming + done; latest assistant, thinking, and
  // active-status scans: one slot each. A full-history rescan breaks this.
  expect(tracked.reads()).toBeLessThanOrEqual(8);
  expect(chat.targetHostId).toBe("host-42");
  expect(chat.profileId).toBe("harness:hermes");
  expect(chat.messages).toBe(tracked.messages);
});

test("no completed reply has a linear, source-derived three-scan upper bound", () => {
  for (const count of [8, 4_096]) {
    const messages: Message[] = Array.from({ length: count }, (_, i) => user(`prompt-${i}`, "x".repeat(128)));
    const tracked = observedSlots(messages);
    expect(chatRow({ ...base, messages: tracked.messages }, "Hermes", "online")).toEqual({
      title: "Hermes",
      folder: "Folder unknown",
      folderPath: undefined,
      outcome: "No summary yet",
      outcomeLabel: null,
      activity: "No active turn",
      needsAttention: false,
    });
    // One reverse search for a done answer, findLast for an assistant,
    // one reverse streaming scan, plus chatAttention's last-element lookup.
    expect(tracked.reads()).toBeLessThanOrEqual(count * 3 + 2);
  }
});

test("older answer and prompt payloads are lazy; empty completions fall back correctly", () => {
  let historicalReads = 0;
  let promptReads = 0;
  const old: AssistantMessage = {
    ...reply("historical", "done", ""),
    get text() {
      historicalReads += 1;
      return "Do not open the historical transcript.";
    },
  };
  const latestPrompt: UserMessage = {
    id: "user-current",
    role: "user",
    at: 5,
    get text() {
      promptReads += 1;
      return "Unrelated current prompt body";
    },
  };
  const chat: Conversation = {
    ...base,
    messages: [
      old,
      reply("completed", "done", "Correct target. Later content."),
      reply("empty", "done", "  \n   "),
      latestPrompt,
    ],
  };
  expect(chatRow(chat, "Hermes", "online").outcome).toBe("Correct target.");
  expect(historicalReads).toBe(0);
  expect(promptReads).toBe(0);
});

test("disconnected and stale rows preserve last known outcome without reading live status", () => {
  let statusReads = 0;
  const live: AssistantMessage = {
    ...reply("live", "streaming", ""),
    get status() {
      statusReads += 1;
      return "Running remote tool";
    },
  };
  const chat: Conversation = {
    ...base,
    cwd: "/workspace/dash",
    openIn: "CLI",
    messages: [reply("done", "done", "Saved."), live],
  };
  const offline = chatRow(chat, "Hermes", "offline");
  expect(offline.outcome).toBe("Saved.");
  expect(offline.folderPath).toBe("/workspace/dash");
  expect(offline.activity).toBe("Activity unknown · offline");
  expect(offline.needsAttention).toBe(false);
  const stale = chatRow({ ...chat, stale: true }, "Hermes", "online");
  expect(stale.outcome).toBe("Saved.");
  expect(stale.activity).toBe("Ended");
  expect(stale.needsAttention).toBe(false);
  expect(statusReads).toBe(0);
});

test("chat-row's pure boundary does not import transport or schedule global timers", () => {
  const source = readFileSync(new URL("./chat-row.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/from\s+["'][^"']*(?:\/net\/|\/store\/|\/screens\/)/);
  expect(source).not.toMatch(/\b(?:fetch|WebSocket|setTimeout|setInterval|requestAnimationFrame)\s*\(/);
});

/**
 * OPTIONAL profiling recipe — NOT RUN:
 *   DASH_CHAT_ROW_PROFILE=1 bun test app/src/lib/chat-row.performance-lane.test.ts
 * Input: 4,096 user messages sharing a 4,096-character payload, one completed
 * 262,144-character tail, and one streaming reply. Warm up with 100 calls;
 * sample 1,000 identical calls. No elapsed-time assertion or memory budget.
 * Elapsed time: NOT RUN. Heap: NOT RUN. Android device: NOT RUN.
 */
if (process.env.DASH_CHAT_ROW_PROFILE === "1") {
  test("optional 1,000-call sampling only; not a performance pass/fail gate", () => {
    const chat = largeTranscript();
    for (let i = 0; i < 100; i += 1) chatRow(chat, "Hermes", "online");
    const before = performance.now();
    for (let i = 0; i < 1_000; i += 1) chatRow(chat, "Hermes", "online");
    const elapsed = performance.now() - before;
    console.info(`chatRow / 1,000 calls (milliseconds, no pass threshold): ${elapsed}`);
  });
}
