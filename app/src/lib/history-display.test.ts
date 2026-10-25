import { expect, test } from "bun:test";
import type { HistoryMessage } from "../../../shared/protocol";
import { parseConversation, type Conversation } from "../model";
import { hydrateLiveConversation } from "./live-sessions";
import { unwrapHermesHistoryText } from "./history-display";

// Exact upstream Hermes prompt_builder.py marker, as stored in user-role history rows.
const OPEN = "[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]";
const CLOSE = "[/OUT-OF-BAND USER MESSAGE]";
const wrapped = (text: string) => `${OPEN}\n${text}\n${CLOSE}`;
const base: Conversation = {
  id: "dash-121", harness: "hermes", title: "Steering history",
  createdAt: 1, updatedAt: 1, sessionId: "hermes-session", messages: [],
};

test("exact Hermes mid-turn envelope shows only user text, preserving whitespace and newlines", () => {
  const userText = "  stop this step\n\nRun the smaller test instead.\n";
  expect(unwrapHermesHistoryText(wrapped(userText))).toBe(userText);
  expect(unwrapHermesHistoryText(`\n\n${wrapped(userText)}`)).toBe(userText);
  expect(unwrapHermesHistoryText(wrapped(""))).toBe("");
  expect(unwrapHermesHistoryText(userText)).toBe(userText);
  expect(unwrapHermesHistoryText(unwrapHermesHistoryText(wrapped(userText)))).toBe(userText);
});

test("partial, quoted, malformed and nested-looking envelopes are not silently stripped", () => {
  const plain = wrapped("keep exactly");
  for (const text of [
    `This is a quote:\n${plain}`,
    `${plain}\nextra text`,
    `\n${plain}`,
    `${OPEN}\ntruncated`,
    `[OUT-OF-BAND USER MESSAGE]\nlegacy\n${CLOSE}`,
    `${OPEN}\ntruncated\n[/OUT-OF-BAND USER MESSAGE ]`,
    "[QUEUED USER MESSAGE]\nkeep wrapper-looking user prose",
  ]) expect(unwrapHermesHistoryText(text)).toBe(text);
});

test("Hermes bridge history hydration projects wrapped user rows but never rewrites wire input", () => {
  const envelope = wrapped("Inspect logs\nthen retry");
  const history: HistoryMessage[] = [
    { id: "u1", role: "user", text: "original turn", at: 2 },
    { id: "a1", role: "assistant", text: "running", at: 3 },
    { id: "u2", role: "user", text: envelope, at: 4 },
    { id: "a2", role: "assistant", text: "acknowledged", at: 5 },
  ];
  const before = JSON.stringify(history);
  const rendered = hydrateLiveConversation(base, history);
  expect(rendered.messages.map(m => m.text)).toEqual([
    "original turn", "running", "Inspect logs\nthen retry", "acknowledged",
  ]);
  expect(rendered.messages.map(m => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
  expect(JSON.stringify(history)).toBe(before);
  expect(hydrateLiveConversation({ ...base, harness: "omp" }, history).messages[2]?.text).toBe(envelope);
});

test("Metro restart restores old wrapped Hermes history as plain text", () => {
  const envelope = wrapped("Change direction now");
  const onDisk: Conversation = {
    ...base, messages: [
      { id: "u", role: "user", text: envelope, at: 2 },
      { id: "a", role: "assistant", text: "done", at: 3, state: "done", turnId: "t", seq: 1 },
    ],
  };
  const restored = parseConversation(JSON.parse(JSON.stringify(onDisk)));
  expect(restored?.messages[0]?.text).toBe("Change direction now");
  expect(restored?.messages[1]?.text).toBe("done");
  expect(onDisk.messages[0]?.text).toBe(envelope);
  expect(parseConversation({ ...onDisk, harness: "omp" })?.messages[0]?.text).toBe(envelope);
});

test("unconfirmed queued text stays verbatim across restart for safe replay", () => {
  const envelope = wrapped("literal text queued intentionally");
  const onDisk: Conversation = {
    ...base, messages: [
      { id: "u", role: "user", text: envelope, at: 2, delivery: "queued" },
      { id: "a", role: "assistant", text: "", at: 2, state: "pending", turnId: "t", seq: 0 },
    ],
  };
  const restored = parseConversation(JSON.parse(JSON.stringify(onDisk)));
  expect(restored?.messages[0]?.text).toBe(envelope);
  expect(restored?.messages[1]).toMatchObject({ state: "pending", turnId: "t" });
  expect(hydrateLiveConversation(onDisk, [
    { id: "history", role: "user", text: wrapped("other"), at: 3 },
  ])).toBe(onDisk);
});
