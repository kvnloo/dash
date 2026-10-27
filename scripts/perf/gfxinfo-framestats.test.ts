import { describe, expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FramestatsParseError,
  parseFramestats,
  summarize,
} from "./gfxinfo-framestats";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const SCRIPT = join(HERE, "gfxinfo-framestats.ts");
const SMOOTH_PATH = join(HERE, "fixtures/framestats-smooth.txt");
const JANKY_PATH = join(HERE, "fixtures/framestats-janky.txt");
const SMOOTH = readFileSync(SMOOTH_PATH, "utf8");
const JANKY = readFileSync(JANKY_PATH, "utf8");

function block(columns: string[], rows: string[][]): string {
  return [
    "Other gfxinfo output before the CSV",
    "---PROFILEDATA---",
    columns.join(","),
    ...rows.map((row) => row.join(",")),
    "---PROFILEDATA---",
  ].join("\n");
}

function run(...args: string[]): { status: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync({
    cmd: [process.execPath, SCRIPT, ...args],
    cwd: ROOT,
  });
  return {
    status: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

describe("parseFramestats", () => {
  test("smooth fixture has exactly 36 accepted frames and preserves ns as bigint", () => {
    const frames = parseFramestats(SMOOTH);
    expect(frames).toHaveLength(36);
    expect(frames.skippedFlagged).toBe(0);
    expect(frames[0]?.intendedVsyncNs).toBe(10_000_000_000n);
    expect(frames[0]?.frameCompletedNs).toBe(10_010_000_000n);
    expect(frames[0]?.durationMs).toBe(10);
    expect(frames.every((frame) => frame.flags === 0)).toBe(true);
  });

  test("flagged frames never affect duration statistics and are counted separately", () => {
    const frames = parseFramestats(JANKY);
    expect(frames).toHaveLength(39);
    expect(frames.skippedFlagged).toBe(1);
    expect(frames.every((frame) => frame.flags === 0)).toBe(true);
    expect(frames.some((frame) => frame.durationMs === 90)).toBe(false);
  });

  test("looks up columns by name even when reordered and extra columns are present", () => {
    const dump = block(
      ["FrameCompleted", "Extra", "Flags", "Vsync", "IntendedVsync"],
      [
        ["1014000000", "ignored", "0", "1000100000", "1000000000"],
        ["2029000000", "ignored", "1", "2000100000", "2000000000"],
      ],
    );
    const frames = parseFramestats(dump);
    expect(frames).toHaveLength(1);
    expect(frames.skippedFlagged).toBe(1);
    expect(frames[0]).toEqual({
      intendedVsyncNs: 1_000_000_000n,
      frameCompletedNs: 1_014_000_000n,
      durationMs: 14,
      flags: 0,
    });
  });

  test("combines all PROFILEDATA windows rather than only the first", () => {
    const frames = parseFramestats(SMOOTH + "\n" + JANKY);
    expect(frames).toHaveLength(75);
    expect(frames.skippedFlagged).toBe(1);
    expect(summarize(frames).overBudget).toBe(3);
  });

  test("handles CRLF dumps and blank lines within a block", () => {
    const dump = block(
      ["Flags", "IntendedVsync", "FrameCompleted"],
      [["0", "1000000000", "1015000000"]],
    ).replace("\n0,", "\n\n0,").replace(/\n/g, "\r\n");
    expect(parseFramestats(dump)[0]?.durationMs).toBe(15);
  });

  test("rejects a missing closing marker with a typed error", () => {
    const truncated = SMOOTH.trimEnd().replace(/---PROFILEDATA---$/, "");
    try {
      parseFramestats(truncated);
      throw new Error("Expected a truncated block to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FramestatsParseError);
      if (error instanceof FramestatsParseError) {
        expect(error.code).toBe("unterminated-block");
        expect(error.lineNumber).toBeGreaterThan(0);
      }
    }
  });

  test("rejects missing markers, missing headers, duplicate columns and malformed data", () => {
    expect(() => parseFramestats("Total frames rendered: 1")).toThrow(FramestatsParseError);
    expect(() => parseFramestats("---PROFILEDATA---\n---PROFILEDATA---"))
      .toThrow(FramestatsParseError);
    expect(() => parseFramestats(block(
      ["Flags", "IntendedVsync", "IntendedVsync", "FrameCompleted"],
      [],
    ))).toThrow(/exactly one IntendedVsync/);
    expect(() => parseFramestats(block(
      ["Flags", "IntendedVsync", "FrameCompleted"],
      [["0", "bad", "1000000000"]],
    ))).toThrow(/Invalid IntendedVsync/);
    expect(() => parseFramestats(block(
      ["Flags", "IntendedVsync", "FrameCompleted"],
      [["0", "1000000000"]],
    ))).toThrow(/column count/);
    expect(() => parseFramestats(block(
      ["Flags", "IntendedVsync", "FrameCompleted"],
      [["0", "1000000000", "999999999"]],
    ))).toThrow(/precedes IntendedVsync/);
  });

  test("keeps precision for timestamps beyond Number.MAX_SAFE_INTEGER", () => {
    const intended = 9_007_199_254_740_993n;
    const completed = intended + 12_000_000n;
    const frames = parseFramestats(block(
      ["Flags", "IntendedVsync", "FrameCompleted"],
      [["0", String(intended), String(completed)]],
    ));
    expect(frames[0]?.intendedVsyncNs).toBe(intended);
    expect(frames[0]?.frameCompletedNs).toBe(completed);
    expect(frames[0]?.durationMs).toBe(12);
  });
});

describe("summarize and 25 ms gate", () => {
  test("smooth fixture passes with a 15 ms maximum", () => {
    expect(summarize(parseFramestats(SMOOTH))).toEqual({
      frames: 36,
      skippedFlagged: 0,
      p50Ms: 12,
      p90Ms: 15,
      p99Ms: 15,
      maxMs: 15,
      overBudget: 0,
      pass: true,
    });
  });

  test("janky fixture fails on three unflagged over-budget frames", () => {
    // Sorted: 9 each of 10/12/14/16 ms, then 28/32/39 ms.
    // Nearest rank: rank(0.5*39)=20 -> 14, rank(0.9*39)=36 -> 16.
    expect(summarize(parseFramestats(JANKY))).toEqual({
      frames: 39,
      skippedFlagged: 1,
      p50Ms: 14,
      p90Ms: 16,
      p99Ms: 39,
      maxMs: 39,
      overBudget: 3,
      pass: false,
    });
  });

  test("custom 40 ms budget makes janky capture pass; equality is in budget", () => {
    expect(summarize(parseFramestats(JANKY), { budgetMs: 40 }).pass).toBe(true);
    expect(summarize(parseFramestats(JANKY), { budgetMs: 39 }).overBudget).toBe(0);
    expect(summarize(parseFramestats(JANKY), { budgetMs: 30 }).overBudget).toBe(2);
  });

  test("empty and all-flagged input fails closed with no-frames", () => {
    expect(summarize([])).toEqual({
      frames: 0,
      skippedFlagged: 0,
      p50Ms: null,
      p90Ms: null,
      p99Ms: null,
      maxMs: null,
      overBudget: 0,
      pass: false,
      reason: "no-frames",
    });
    const onlyFlagged = parseFramestats(block(
      ["Flags", "IntendedVsync", "FrameCompleted"],
      [["1", "0", "0"]],
    ));
    expect(onlyFlagged).toHaveLength(0);
    expect(summarize(onlyFlagged).skippedFlagged).toBe(1);
    expect(summarize(onlyFlagged).reason).toBe("no-frames");
  });

  test("invalid budgets cannot accidentally pass", () => {
    const frames = parseFramestats(SMOOTH);
    for (const budgetMs of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => summarize(frames, { budgetMs })).toThrow(RangeError);
    }
  });
});

describe("CLI status and output", () => {
  test("exit 0 for smooth capture with machine-readable JSON", () => {
    const result = run(SMOOTH_PATH, "--json");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"frames":36');
    expect(result.stdout).toContain('"pass":true');
    expect(result.stdout).toContain('"maxMs":15');
  });

  test("exit 1 for janky capture, with clear human gate result", () => {
    const result = run(JANKY_PATH);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL gfxinfo gate (25 ms budget)");
    expect(result.stdout).toContain("over-budget=3");
    expect(result.stdout).toContain("flagged-skipped=1");
  });

  test("exit 0 for janky fixture at a custom 40 ms budget", () => {
    const result = run(JANKY_PATH, "--budget-ms", "40", "--json");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"pass":true');
    expect(result.stdout).toContain('"overBudget":0');
  });

  test("exit 2 for a missing file, malformed file, or invalid arguments", () => {
    expect(run(join(HERE, "fixtures/no-such-dump.txt")).status).toBe(2);
    expect(run(SMOOTH_PATH, "--budget-ms", "NaN").status).toBe(2);
    expect(run(SMOOTH_PATH, "--wat").status).toBe(2);
    expect(run().status).toBe(2);

    const directory = mkdtempSync(join(tmpdir(), "dash-gfxinfo-"));
    try {
      const path = join(directory, "truncated.txt");
      writeFileSync(path, "---PROFILEDATA---\nFlags,IntendedVsync,FrameCompleted\n0,1,2\n");
      const result = run(path);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("no closing marker");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
