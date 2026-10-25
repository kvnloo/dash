import { expect, test } from "bun:test";
import type { ReplyPart } from "../../../shared/protocol";
import {
  EMPTY_DETAILS,
  detailsOf,
  readDetails,
  reducePart,
  toolStackLabel,
  wrappedTail,
} from "./reply-details";

const REASONING_CAP = 131_072;
const OUTPUT_CAP = 1_048_576;
const TOOL_CAP = 128;

function toolStart(callId: string): ReplyPart {
  return {
    kind: "tool_start",
    callId,
    name: "terminal",
    summary: "call " + callId,
    args: "{}",
  };
}

/**
 * Optional local profiling recipe — NOT RUN (connector-only worker).
 * First: bun test app/src/lib/reply-details.performance-lane.test.ts
 * Then, from the repository root, with Bun installed:
 *
 * bun -e '
 * import { detailsOf, wrappedTail } from "./app/src/lib/reply-details.ts";
 * const parts = [
 *   ...Array.from({ length: 128 }, (_, i) => ({
 *     kind: "tool_start", callId: "t" + i, name: "terminal",
 *     summary: "synthetic", args: "{}",
 *   })),
 *   { kind: "tool_output", callId: "t0",
 *     text: "x".repeat(1048576) + "END", truncated: false },
 *   { kind: "reasoning", text: "r".repeat(131072) + "END" },
 * ];
 * const wrapped = "w".repeat(200000) + "\nKEEP";
 * const sample = () => { detailsOf(parts); wrappedTail(wrapped, 80); };
 * for (let i = 0; i < 3; i++) sample();
 * const t = performance.now();
 * for (let i = 0; i < 25; i++) sample();
 * console.log("25 samples total ms:", performance.now() - t);
 * '
 *
 * Inputs: 128 calls, 1,048,579 output characters, 131,075 reasoning
 * characters, 200,005 wrap characters at 80 columns. Record hardware,
 * Bun version, per-iteration timings and memory separately if profiling.
 * Time: NOT RUN. Memory: NOT RUN. Device/CI: NOT RUN.
 * No benchmark threshold is an assertion in this test file.
 */

test("small fixture retains ordered call identity, full detail, truncation and duration", () => {
  const parts: ReplyPart[] = [
    { kind: "reasoning", text: "trace\n" },
    toolStart("read"),
    toolStart("write"),
    { kind: "tool_output", callId: "read", text: "alpha\n", truncated: false },
    { kind: "tool_output", callId: "write", text: "partial", truncated: true },
    { kind: "tool_finish", callId: "write", status: "error", durationMs: 1250 },
    {
      kind: "tool_detail",
      callId: "read",
      args: '{"path":"a"}',
      text: "alpha\nbeta",
      truncated: false,
    },
    { kind: "tool_finish", callId: "read", status: "ok", durationMs: 250 },
  ];

  const result = detailsOf(parts);
  expect(result).toEqual({
    reasoning: "trace\n",
    tools: [
      {
        id: "read",
        name: "terminal",
        summary: "call read",
        args: '{"path":"a"}',
        output: "alpha\nbeta",
        status: "ok",
        durationMs: 250,
        truncated: false,
        detailLoaded: true,
      },
      {
        id: "write",
        name: "terminal",
        summary: "call write",
        args: "{}",
        output: "partial",
        status: "error",
        durationMs: 1250,
        truncated: true,
        detailLoaded: false,
      },
    ],
  });
  expect(toolStackLabel(result.tools)).toBe("2 tools · 1.5 s");
  expect(wrappedTail(result.tools[0]?.output ?? "", 5)).toBe("alpha\nbeta");
  expect(readDetails(JSON.stringify(parts))).toEqual(result);
});

test("large streamed reasoning preserves the exact latest 131072 code units", () => {
  const raw = "prefix" + "r".repeat(REASONING_CAP) + "END";
  const state = detailsOf([
    { kind: "reasoning", text: raw.slice(0, 70_000) },
    { kind: "reasoning", text: raw.slice(70_000) },
  ]);

  expect(state.reasoning).toHaveLength(REASONING_CAP);
  expect(state.reasoning).toBe("r".repeat(REASONING_CAP - 3) + "END");
  const next = reducePart(state, { kind: "reasoning", text: "!" });
  expect(next.reasoning).toBe("r".repeat(REASONING_CAP - 4) + "END!");
  expect(next.reasoning).toHaveLength(REASONING_CAP);
  expect(state.reasoning.endsWith("END")).toBe(true);
  expect(next.tools).toBe(state.tools);
});

test("large streamed output keeps the 1 MiB tail and only its call metadata", () => {
  const started = detailsOf([toolStart("large"), toolStart("small")]);
  const first = reducePart(started, {
    kind: "tool_output",
    callId: "large",
    text: "x".repeat(OUTPUT_CAP),
    truncated: false,
  });
  const interleaved = reducePart(first, {
    kind: "tool_output",
    callId: "small",
    text: "untouched",
    truncated: false,
  });
  const tailed = reducePart(interleaved, {
    kind: "tool_output",
    callId: "large",
    text: "END",
    truncated: true,
  });
  const finished = reducePart(tailed, {
    kind: "tool_finish",
    callId: "large",
    status: "ok",
    durationMs: 2375,
  });

  const output = finished.tools[0]?.output ?? "";
  expect(output).toHaveLength(OUTPUT_CAP);
  expect(output).toBe("x".repeat(OUTPUT_CAP - 3) + "END");
  expect(finished.tools[0]).toMatchObject({
    id: "large",
    status: "ok",
    durationMs: 2375,
    truncated: true,
    detailLoaded: false,
  });
  expect(finished.tools[1]).toMatchObject({
    id: "small",
    output: "untouched",
    status: "live",
    durationMs: 0,
    truncated: false,
  });
  expect(finished.tools[1]).toBe(interleaved.tools[1]);
  expect(first.tools[0]?.output).toHaveLength(OUTPUT_CAP);
  expect(wrappedTail(output, 16)).toBe(
    "x".repeat(16) + "\n" + "x".repeat(16) + "\n" + "x".repeat(13) + "END",
  );
});

test("128-call cap rejects new ids but still updates the existing call in place", () => {
  let state = EMPTY_DETAILS;
  for (let i = 0; i < TOOL_CAP; i++) {
    state = reducePart(state, toolStart("call-" + i));
  }
  expect(state.tools.map(tool => tool.id)).toEqual(
    Array.from({ length: TOOL_CAP }, (_, i) => "call-" + i),
  );
  expect(reducePart(state, toolStart("call-overflow"))).toBe(state);

  const updated = reducePart(state, {
    kind: "tool_start",
    callId: "call-64",
    name: "read_file",
    summary: "new summary",
    args: '{"path":"new"}',
    truncated: true,
  });
  expect(updated.tools).toHaveLength(TOOL_CAP);
  expect(updated.tools[64]).toMatchObject({
    id: "call-64",
    name: "read_file",
    summary: "new summary",
    args: '{"path":"new"}',
    truncated: true,
  });
  expect(updated.tools[0]).toBe(state.tools[0]);
  expect(updated.tools[64]).not.toBe(state.tools[64]);
  expect(state.tools[64]?.name).toBe("terminal");
  expect(state.tools[64]?.truncated).toBe(false);
  expect(updated.tools.map(tool => tool.id)).toEqual(state.tools.map(tool => tool.id));
});

test("compact wrapping keeps exact three last visual rows for small, Unicode and large input", () => {
  expect(wrappedTail("old\n1234567890\nlatest\n", 5)).toBe("67890\nlates\nt");
  expect(wrappedTail("🦆🦆🦆", 2)).toBe("🦆🦆\n🦆");
  expect(wrappedTail("abcdef", 2.9, 2)).toBe("cd\nef");
  expect(wrappedTail("abcd", 0)).toBe("b\nc\nd");
  const large = "discard\n" + "a".repeat(200_000) + "\nKEEP\n";
  expect(wrappedTail(large, 80)).toBe(
    "a".repeat(80) + "\n" + "a".repeat(80) + "\nKEEP",
  );
});

test("pure transformations do not mutate snapshots or read unrelated lazy fields", () => {
  const original = detailsOf([toolStart("focus"), toolStart("other")]);
  Object.freeze(original.tools[0]);
  Object.freeze(original.tools[1]);
  Object.freeze(original.tools);
  Object.freeze(original);

  let extraReads = 0;
  const event: {
    kind: "tool_output";
    callId: string;
    text: string;
    truncated: boolean;
    readonly unrelated: string;
  } = {
    kind: "tool_output",
    callId: "focus",
    text: "payload",
    truncated: false,
    get unrelated() {
      extraReads++;
      return "must remain lazy";
    },
  };

  const beforeFetch = globalThis.fetch;
  const beforeTimeout = globalThis.setTimeout;
  const beforeInterval = globalThis.setInterval;
  const next = reducePart(original, event);
  const unknown = reducePart(next, {
    kind: "tool_detail",
    callId: "unknown",
    args: "{}",
    text: "ignored",
    truncated: false,
  });

  expect(extraReads).toBe(0);
  expect(original.tools[0]?.output).toBe("");
  expect(original.tools[1]?.output).toBe("");
  expect(next.tools[0]?.output).toBe("payload");
  expect(next.tools[1]).toBe(original.tools[1]);
  expect(unknown.tools).toEqual(next.tools);
  expect(globalThis.fetch).toBe(beforeFetch);
  expect(globalThis.setTimeout).toBe(beforeTimeout);
  expect(globalThis.setInterval).toBe(beforeInterval);
  expect(readDetails("invalid-json")).toBe(EMPTY_DETAILS);
});
