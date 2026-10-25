import { describe, expect, test } from "bun:test";
import { parseReplyPart, parseReplyParts, type ReplyPart } from "./reply-parts";

const CALL_ID = "session/🧪:call%2F007";
const start: Extract<ReplyPart, { kind: "tool_start" }> = {
  kind: "tool_start",
  callId: CALL_ID,
  name: "read_file",
  summary: "Read exactly one file",
  args: '{"path":"a/b","literal":"\\n"}',
};
const output: Extract<ReplyPart, { kind: "tool_output" }> = {
  kind: "tool_output",
  callId: CALL_ID,
  text: "first\r\nsecond",
  truncated: false,
};
const finish: Extract<ReplyPart, { kind: "tool_finish" }> = {
  kind: "tool_finish",
  callId: CALL_ID,
  status: "error",
  durationMs: 0.25,
};
const detail: Extract<ReplyPart, { kind: "tool_detail" }> = {
  kind: "tool_detail",
  callId: CALL_ID,
  args: start.args,
  text: "full detail",
  truncated: true,
};
const validParts: ReplyPart[] = [
  { kind: "reasoning", text: "\nThink before acting.\n" },
  { ...start, truncated: true },
  output,
  finish,
  detail,
];

const requiredStringFields: { label: string; value: Record<string, unknown>; fields: string[] }[] = [
  { label: "reasoning", value: { kind: "reasoning", text: "" }, fields: ["text"] },
  { label: "tool_start", value: start, fields: ["callId", "name", "summary", "args"] },
  { label: "tool_output", value: output, fields: ["callId", "text"] },
  { label: "tool_finish", value: finish, fields: ["callId"] },
  { label: "tool_detail", value: detail, fields: ["callId", "args", "text"] },
];

describe("ReplyPart variant and identity boundaries", () => {
  test("accepts every real variant without changing text, ids, args or flags", () => {
    for (const part of validParts) expect(parseReplyPart(part)).toEqual(part);
    expect(parseReplyPart({ ...start })).toEqual(start);
    expect(parseReplyPart({ ...start, truncated: false })).toEqual({
      ...start,
      truncated: false,
    });
    expect(parseReplyPart({ ...output, truncated: true })).toEqual({
      ...output,
      truncated: true,
    });
    expect(parseReplyPart({ ...detail, truncated: false })).toEqual({
      ...detail,
      truncated: false,
    });
    expect(parseReplyPart({ ...finish, status: "ok", durationMs: 0 })).toEqual({
      ...finish,
      status: "ok",
      durationMs: 0,
    });
  });

  test("preserves exact call ids, including empty and non-normalized strings", () => {
    for (const callId of ["", "  spaced  ", "a/b", "CALL:AbC%2f😀"]) {
      for (const part of [start, output, finish, detail]) {
        const raw = { ...part, callId };
        expect(parseReplyPart(raw)).toEqual(raw);
      }
    }
  });

  test("never admits stray target, option or session fields as ReplyPart state", () => {
    const raw = {
      ...start,
      targetId: "other-target",
      optionId: "other-option",
      sessionId: "other-session",
      nested: { callId: "forged-call" },
    };
    expect(parseReplyPart(raw)).toEqual(start);
    expect(parseReplyPart(raw)).not.toEqual(raw);
  });

  test("rejects non-record values and missing or unknown kind without coercion", () => {
    for (const raw of [
      undefined, null, false, 0, "", "reasoning", [], [start],
      {}, { kind: undefined }, { kind: null }, { kind: [] },
      { kind: 1, text: "not a part" }, { kind: "Reasoning", text: "not a part" },
      { kind: "status", text: "not a part" },
      { kind: "tool_call", callId: CALL_ID, text: "not a part" },
      { kind: "tool_start " },
    ]) {
      expect(parseReplyPart(raw)).toBeNull();
    }
  });
});

for (const fixture of requiredStringFields) {
  test(fixture.label + " rejects each absent or mistyped required string independently", () => {
    expect(parseReplyPart(fixture.value)).not.toBeNull();
    for (const field of fixture.fields) {
      const missing = { ...fixture.value };
      delete missing[field];
      expect(parseReplyPart(missing)).toBeNull();
      for (const bad of [undefined, null, false, 0, [], {}]) {
        expect(parseReplyPart({ ...fixture.value, [field]: bad })).toBeNull();
      }
    }
  });
}

describe("ReplyPart enum, numeric and truncation boundaries", () => {
  test("tool_finish requires a recognized status and finite nonnegative duration", () => {
    for (const status of [undefined, null, "OK", "cancelled", "", true, 1, [], {}]) {
      expect(parseReplyPart({ ...finish, status })).toBeNull();
    }
    for (const durationMs of [
      undefined, null, "0", false, [], {}, -0.001, NaN, Infinity, -Infinity,
    ]) {
      expect(parseReplyPart({ ...finish, durationMs })).toBeNull();
    }
    expect(parseReplyPart({ ...finish, durationMs: Number.MAX_VALUE })).toEqual({
      ...finish,
      durationMs: Number.MAX_VALUE,
    });
  });

  test("tool_output and tool_detail require explicit boolean truncation flags", () => {
    for (const value of [output, detail]) {
      const missing = { ...value };
      delete missing.truncated;
      expect(parseReplyPart(missing)).toBeNull();
      for (const truncated of [undefined, null, 0, 1, "false", [], {}]) {
        expect(parseReplyPart({ ...value, truncated })).toBeNull();
      }
    }
  });

  test("tool_start rejects malformed optional truncation instead of silently dropping it", () => {
    // Expected regression until Hermes tightens the parser's optional-field gate.
    for (const truncated of [undefined, null, 0, 1, "true", [], {}]) {
      expect(parseReplyPart({ ...start, truncated })).toBeNull();
    }
  });
});

describe("parseReplyParts all-or-nothing collection boundaries", () => {
  test("preserves all variants, order and exact per-call flags in a single batch", () => {
    expect(parseReplyParts(validParts)).toEqual(validParts);
    expect(parseReplyParts([])).toEqual([]);
    expect(parseReplyParts([output, { ...output, callId: "next-call", truncated: true }])).toEqual([
      output,
      { ...output, callId: "next-call", truncated: true },
    ]);
  });

  test("rejects non-arrays rather than manufacturing an empty parts list", () => {
    for (const raw of [undefined, null, false, 0, "", "[]", {}, { 0: start, length: 1 }]) {
      expect(parseReplyParts(raw)).toBeUndefined();
    }
  });

  test("rejects an invalid element at every position, never returns a partial batch", () => {
    for (let index = 0; index < validParts.length; index++) {
      const input: unknown[] = [...validParts];
      input[index] = { kind: "unknown", callId: "other-call" };
      expect(parseReplyParts(input)).toBeUndefined();
    }
    expect(parseReplyParts([start, null, finish])).toBeUndefined();
    expect(parseReplyParts([start, [output], finish])).toBeUndefined();
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = output;
    expect(parseReplyParts(sparse)).toBeUndefined();
  });

  test("a rejected batch does not corrupt a subsequent valid parse", () => {
    expect(parseReplyParts([start, { ...finish, durationMs: -1 }])).toBeUndefined();
    expect(parseReplyParts([start, output, finish])).toEqual([start, output, finish]);
  });
});
