import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CANCELLED_EXIT_CODE,
  DEFAULT_TURN_TIMEOUT_MS,
  TIMEOUT_EXIT_CODE,
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
    expect(src).toContain("TIMEOUT_EXIT_CODE");
    expect(src).not.toContain("const exitCode = await proc.exited;");
    const adapters = readFileSync(join(import.meta.dir, "harnesses.ts"), "utf8");
    expect(adapters).toContain("parseHarnessJsonLine");
  });
});
