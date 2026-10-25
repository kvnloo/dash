import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ReplyPart } from "../../../shared/protocol";
import { appendReplyPart, partsFor, replyParts } from "./text";

const ORDER = "dash2-155:order";
const DETAIL = "dash2-155:detail";
const LIMITS = "dash2-155:limits";
const FIRST_TURN = "dash2-155:first";
const SECOND_TURN = "dash2-155:second";
const keys = [ORDER, DETAIL, LIMITS, FIRST_TURN, SECOND_TURN];

const startA: ReplyPart = {
  kind: "tool_start", callId: "a", name: "terminal", summary: "first", args: "{}",
};
const startB: ReplyPart = {
  kind: "tool_start", callId: "b", name: "read_file", summary: "second", args: "{}",
};

// text.ts uses a singleton keyed store with rAF-coalesced notifications. Keep
// this test's frame shim scoped and drain the queued callbacks on teardown.
let previousFrame: PropertyDescriptor | undefined;
const frames: FrameRequestCallback[] = [];

beforeEach(() => {
  previousFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback): number => {
      frames.push(callback);
      return frames.length;
    },
  });
  for (const key of keys) replyParts.clear(key);
});

afterEach(() => {
  for (const key of keys) replyParts.clear(key);
  for (const frame of frames.splice(0)) frame(0);
  if (previousFrame) Object.defineProperty(globalThis, "requestAnimationFrame", previousFrame);
  else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
});

test("reasoning coalesces in place; outputs append by call id and retain order and truncation", () => {
  appendReplyPart(ORDER, startA);
  appendReplyPart(ORDER, { kind: "reasoning", text: "inspect " });
  appendReplyPart(ORDER, { kind: "tool_output", callId: "a", text: "one", truncated: false });
  appendReplyPart(ORDER, startB);
  appendReplyPart(ORDER, { kind: "reasoning", text: "then test" });
  appendReplyPart(ORDER, { kind: "tool_output", callId: "b", text: "other", truncated: false });
  appendReplyPart(ORDER, { kind: "tool_output", callId: "a", text: " two", truncated: true });
  appendReplyPart(ORDER, { kind: "tool_output", callId: "a", text: " three", truncated: false });

  expect(partsFor(ORDER)).toEqual([
    startA,
    { kind: "reasoning", text: "inspect then test" },
    { kind: "tool_output", callId: "a", text: "one two three", truncated: true },
    startB,
    { kind: "tool_output", callId: "b", text: "other", truncated: false },
  ]);
});

test("tool_detail replaces same-call output/detail; later deltas and other calls survive", () => {
  const finishA: ReplyPart = { kind: "tool_finish", callId: "a", status: "ok", durationMs: 12 };
  const firstDetail: ReplyPart = {
    kind: "tool_detail", callId: "a", args: "{\"mode\":1}", text: "snapshot-1", truncated: false,
  };
  const secondDetail: ReplyPart = {
    kind: "tool_detail", callId: "a", args: "{\"mode\":2}", text: "snapshot-2", truncated: true,
  };
  appendReplyPart(DETAIL, startA);
  appendReplyPart(DETAIL, startB);
  appendReplyPart(DETAIL, { kind: "tool_output", callId: "a", text: "partial", truncated: false });
  appendReplyPart(DETAIL, { kind: "tool_output", callId: "b", text: "B", truncated: false });
  appendReplyPart(DETAIL, finishA);
  appendReplyPart(DETAIL, firstDetail);

  expect(partsFor(DETAIL)).toEqual([
    startA, startB,
    { kind: "tool_output", callId: "b", text: "B", truncated: false },
    finishA, firstDetail,
  ]);

  appendReplyPart(DETAIL, { kind: "tool_output", callId: "a", text: "after ", truncated: false });
  appendReplyPart(DETAIL, { kind: "tool_output", callId: "a", text: "snapshot", truncated: true });
  appendReplyPart(DETAIL, { kind: "tool_output", callId: "b", text: " plus", truncated: false });
  expect(partsFor(DETAIL)).toEqual([
    startA, startB,
    { kind: "tool_output", callId: "b", text: "B plus", truncated: false },
    finishA, firstDetail,
    { kind: "tool_output", callId: "a", text: "after snapshot", truncated: true },
  ]);

  appendReplyPart(DETAIL, secondDetail);
  expect(partsFor(DETAIL)).toEqual([
    startA, startB,
    { kind: "tool_output", callId: "b", text: "B plus", truncated: false },
    finishA, secondDetail,
  ]);
});

test("reasoning retains its last 131072 chars; output retains its last 1048576 chars", () => {
  appendReplyPart(LIMITS, { kind: "reasoning", text: "DROP" + "r".repeat(131_072) });
  appendReplyPart(LIMITS, { kind: "reasoning", text: "END" });
  const reasoning = partsFor(LIMITS)[0];
  if (reasoning?.kind !== "reasoning") throw new Error("Missing bounded reasoning");
  expect(reasoning.text).toHaveLength(131_072);
  expect(reasoning.text).toBe("r".repeat(131_069) + "END");

  appendReplyPart(LIMITS, {
    kind: "tool_output", callId: "large", text: "DROP" + "o".repeat(1_048_576), truncated: false,
  });
  appendReplyPart(LIMITS, {
    kind: "tool_output", callId: "large", text: "END", truncated: true,
  });
  appendReplyPart(LIMITS, {
    kind: "tool_output", callId: "large", text: "more", truncated: false,
  });
  const output = partsFor(LIMITS).find(part => part.kind === "tool_output");
  if (output?.kind !== "tool_output") throw new Error("Missing bounded output");
  expect(output.text).toHaveLength(1_048_576);
  expect(output.text.startsWith("oooo")).toBe(true);
  expect(output.text.endsWith("oENDmore")).toBe(true);
  expect(output.text.includes("DROP")).toBe(false);
  expect(output.truncated).toBe(true);
  expect(partsFor(LIMITS).map(part => part.kind)).toEqual(["reasoning", "tool_output"]);
});

test("malformed saved payloads fail closed and append recovers without foreign parts", () => {
  replyParts.set(FIRST_TURN, "{not-json");
  expect(partsFor(FIRST_TURN)).toEqual([]);
  replyParts.set(FIRST_TURN, JSON.stringify({ parts: [{ kind: "reasoning", text: "wrong container" }] }));
  expect(partsFor(FIRST_TURN)).toEqual([]);
  replyParts.set(FIRST_TURN, JSON.stringify([
    { kind: "reasoning", text: "valid" },
    { kind: "tool_output", callId: "a", text: "bad", truncated: "no" },
  ]));
  expect(partsFor(FIRST_TURN)).toEqual([]);

  appendReplyPart(FIRST_TURN, { kind: "reasoning", text: "recovered" });
  expect(partsFor(FIRST_TURN)).toEqual([{ kind: "reasoning", text: "recovered" }]);
  expect(partsFor(SECOND_TURN)).toEqual([]);
});

test("saved metadata is parsed away; identical call ids remain isolated by turn", () => {
  replyParts.set(FIRST_TURN, JSON.stringify([
    { kind: "tool_output", callId: "same", text: "first", truncated: false, turnId: SECOND_TURN, secret: "discard" },
  ]));
  replyParts.set(SECOND_TURN, JSON.stringify([
    { kind: "tool_output", callId: "same", text: "second", truncated: false },
  ]));
  expect(partsFor(FIRST_TURN)).toEqual([
    { kind: "tool_output", callId: "same", text: "first", truncated: false },
  ]);

  appendReplyPart(FIRST_TURN, { kind: "tool_output", callId: "same", text: "+delta", truncated: false });
  appendReplyPart(SECOND_TURN, { kind: "tool_detail", callId: "same", args: "{}", text: "second-detail", truncated: true });
  expect(partsFor(FIRST_TURN)).toEqual([
    { kind: "tool_output", callId: "same", text: "first+delta", truncated: false },
  ]);
  expect(partsFor(SECOND_TURN)).toEqual([
    { kind: "tool_detail", callId: "same", args: "{}", text: "second-detail", truncated: true },
  ]);
  replyParts.clear(FIRST_TURN);
  expect(partsFor(FIRST_TURN)).toEqual([]);
  expect(partsFor(SECOND_TURN)).toHaveLength(1);
});
