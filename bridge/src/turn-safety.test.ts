import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANCELLED_EXIT_CODE,
  DEFAULT_TURN_TIMEOUT_MS,
  TIMEOUT_EXIT_CODE,
  attachSocket,
  detachSocket,
  pruneStaleUtterances,
  nonZeroExitMessage,
  parseHarnessJsonLine,
  replayAfter,
  timeoutMessage,
  turnTimeoutMs,
  waitForExitOrTimeout,
} from "./turn-safety";

describe("parseHarnessJsonLine", () => {
  test("ignores non-JSON stdout (hermes noise, banners)", () => {
    expect(parseHarnessJsonLine("Warning: gateway")).toBeNull();
    expect(parseHarnessJsonLine("")).toBeNull();
    expect(parseHarnessJsonLine("[1,2]")).toBeNull();
  });

  test("accepts one JSON object per line", () => {
    expect(parseHarnessJsonLine('{"type":"session","id":"abc"}')).toEqual({
      ok: true,
      value: { type: "session", id: "abc" },
    });
  });

  test("malformed JSON starting with { is a structured error, not a throw", () => {
    expect(parseHarnessJsonLine("{not-json")).toEqual({
      ok: false,
      error: "Harness emitted malformed JSON.",
    });
    expect(parseHarnessJsonLine('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe("replayAfter", () => {
  test("replays only events after the client's last seq", () => {
    const events = [
      { seq: 1, type: "delta" },
      { seq: 2, type: "delta" },
      { seq: 3, type: "done" },
    ];
    expect(replayAfter(events, 0).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(replayAfter(events, 1).map((e) => e.seq)).toEqual([2, 3]);
    expect(replayAfter(events, 3)).toEqual([]);
    expect(replayAfter(events, 99)).toEqual([]);
  });
});

describe("attachSocket", () => {
  test("flushes buffered deltas before replay so a 40ms batch is not dropped", () => {
    const events: { seq: number; text: string }[] = [{ seq: 1, text: "hi" }];
    let buffer = " there";
    const listeners = new Set<string>();
    const replayed = attachSocket(
      {
        events,
        listeners,
        flush() {
          if (!buffer) return;
          events.push({ seq: events.length + 1, text: buffer });
          buffer = "";
        },
      },
      "ws-2",
      1,
    );
    expect(buffer).toBe("");
    expect(listeners.has("ws-2")).toBe(true);
    expect(replayed.map((event) => event.text)).toEqual([" there"]);
  });
});

describe("detachSocket", () => {
  test("drops the socket from turn listeners and leaves voice utterances in place", () => {
    const ws = { id: "old" };
    const turn = { listeners: new Set([ws]) };
    const turns = new Map<string, { listeners: Set<typeof ws> }>([["t1", turn]]);
    const utterances = new Map<string, { bytes: number }>([["t1", { bytes: 12 }]]);
    detachSocket(["t1"], (id) => turns.get(id), ws);
    expect(turn.listeners.size).toBe(0);
    expect(utterances.get("t1")?.bytes).toBe(12);
  });
});

describe("pruneStaleUtterances", () => {
  test("drops recordings older than the TTL so a dropped socket cannot leak forever", () => {
    const utterances = new Map<string, { startedAt: number }>([
      ["fresh", { startedAt: 10_000 }],
      ["stale", { startedAt: 1000 }],
    ]);
    expect(pruneStaleUtterances(utterances, 10_000, 5000)).toEqual(["stale"]);
    expect(utterances.has("fresh")).toBe(true);
    expect(utterances.has("stale")).toBe(false);
  });
});

describe("exit messages", () => {
  test("non-zero exit prefers stderr, else a structured code", () => {
    expect(nonZeroExitMessage("OMP", 1, "  boom  ")).toBe("boom");
    expect(nonZeroExitMessage("OMP", 1, "\n")).toBe("OMP exited with code 1");
    expect(nonZeroExitMessage("Codex", 2, "")).toBe("Codex exited with code 2");
  });

  test("timeout is not a cancel (130)", () => {
    expect(TIMEOUT_EXIT_CODE).toBe(124);
    expect(CANCELLED_EXIT_CODE).toBe(130);
    expect(TIMEOUT_EXIT_CODE).not.toBe(CANCELLED_EXIT_CODE);
    expect(timeoutMessage("Hermes", 250)).toBe("Hermes timed out after 250ms.");
  });

  test("DASH_TURN_TIMEOUT_MS overrides the 10 minute default", () => {
    expect(turnTimeoutMs({})).toBe(DEFAULT_TURN_TIMEOUT_MS);
    expect(turnTimeoutMs({ DASH_TURN_TIMEOUT_MS: "250" })).toBe(250);
    expect(turnTimeoutMs({ DASH_TURN_TIMEOUT_MS: "nope" })).toBe(DEFAULT_TURN_TIMEOUT_MS);
    expect(turnTimeoutMs({ DASH_TURN_TIMEOUT_MS: "0" })).toBe(DEFAULT_TURN_TIMEOUT_MS);
  });
});

describe("waitForExitOrTimeout", () => {
  test("a hanging child is killed and marked timedOut", async () => {
    const proc = Bun.spawn(["bun", "-e", "await Bun.sleep(30_000)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const result = await waitForExitOrTimeout(proc, 150, 200);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  test("a clean exit is not a timeout", async () => {
    const proc = Bun.spawn(["bun", "-e", "process.exit(0)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const result = await waitForExitOrTimeout(proc, 5_000, 200);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  test("non-zero exit is reported without killing later", async () => {
    const proc = Bun.spawn(["bun", "-e", "process.exit(7)"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const result = await waitForExitOrTimeout(proc, 5_000, 200);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(7);
  });
});

describe("live bridge wiring", () => {
  test("index.ts uses the helpers so a hang cannot stall the phone forever", () => {
    const src = readFileSync(join(import.meta.dir, "../index.ts"), "utf8");
    expect(src).toContain('from "./src/turn-safety"');
    expect(src).toContain("waitForExitOrTimeout");
    expect(src).toContain("replayAfter");
    expect(src).toContain("attachSocket");
    expect(src).toContain("detachSocket");
    expect(src).toContain("pruneStaleUtterances");
    expect(src).toContain("turn.attach(");
    expect(src).toContain("TIMEOUT_EXIT_CODE");
    expect(src).not.toContain("const exitCode = await proc.exited;");
    expect(src).not.toMatch(/close\(ws\) \{[\s\S]*?utterances\.delete/);
    const adapters = readFileSync(join(import.meta.dir, "harnesses.ts"), "utf8");
    expect(adapters).toContain("parseHarnessJsonLine");
  });
});
