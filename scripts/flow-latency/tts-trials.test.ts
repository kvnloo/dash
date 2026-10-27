import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  firstAudibleEstimate,
  parseTrials,
  summarizeArms,
  type TrialRow,
} from "./tts-trials";

const FIXTURE = fileURLToPath(new URL("./fixtures/tts-trials-sample.jsonl", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./tts-trials.ts", import.meta.url));

function fixtureRows(): TrialRow[] {
  return parseTrials(readFileSync(FIXTURE, "utf8")).rows;
}

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

describe("TTS trial JSONL parser", () => {
  test("reads nine valid rows, skips blanks, and warns on the exact garbage line", () => {
    const parsed = parseTrials(readFileSync(FIXTURE, "utf8"));
    expect(parsed.rows).toHaveLength(9);
    expect(parsed.warnings).toEqual(["line 4: invalid JSON"]);
    expect(parsed.rows.map((row) => row.id)).toEqual([
      "short-warmup", "short-1", "short-2", "short-3", "short-4",
      "medium-failed", "medium-1", "medium-2", "medium-3",
    ]);
  });

  test("ignores extra fields and rejects malformed, missing and mistyped fields without throwing", () => {
    const row = fixtureRows()[0];
    if (!row) throw new Error("fixture must have a valid trial");
    const input = [
      "",
      " ",
      JSON.stringify({ ...row, device: "sample", temperature: 23 }),
      JSON.stringify({ ...row, ttfa_ms: "200" }),
      JSON.stringify({ tag: "short/edge", phase: "scored" }),
      "null",
      "[1,2,3]",
      "{broken",
    ].join("\r\n");
    const parsed = parseTrials(input);
    expect(parsed.rows).toEqual([row]);
    expect(parsed.warnings).toEqual([
      "line 4: missing or invalid required trial fields",
      "line 5: missing or invalid required trial fields",
      "line 6: missing or invalid required trial fields",
      "line 7: missing or invalid required trial fields",
      "line 8: invalid JSON",
    ]);
  });

  test("rejects invalid phase, tag/bucket mismatch, impossible numbers, and ok other than 0 or 1", () => {
    const row = fixtureRows()[0];
    if (!row) throw new Error("fixture must have a valid trial");
    const input = [
      { ...row, phase: "pending" },
      { ...row, tag: "wrong/arm" },
      { ...row, words: -1 },
      { ...row, k: 1.5 },
      { ...row, audio_s: -1 },
      { ...row, ok: 2 },
    ].map((item) => JSON.stringify(item)).join("\n");
    const parsed = parseTrials(input);
    expect(parsed.rows).toEqual([]);
    expect(parsed.warnings).toHaveLength(6);
    expect(parsed.warnings[0]).toContain("line 1:");
    expect(parsed.warnings[5]).toContain("line 6:");
  });
});

describe("per-arm TTS summary", () => {
  test("uses only successful scored timing and nearest-rank percentiles", () => {
    const summary = summarizeArms(fixtureRows());
    expect(summary.missingArms).toEqual([]);
    expect(summary.arms).toEqual([
      {
        tag: "medium/cascade",
        n: 3,
        okRate: 0.75,
        ttfaP50: 700,
        ttfaP95: 900,
        ttfaMax: 900,
        rtfP50: 0.7,
        maxChunkGapP95: 60,
        enoughN: false,
      },
      {
        tag: "short/edge",
        n: 4,
        okRate: 1,
        ttfaP50: 200,
        ttfaP95: 400,
        ttfaMax: 400,
        rtfP50: 0.3,
        maxChunkGapP95: 40,
        enoughN: false,
      },
    ]);
  });

  test("computes percentiles in sorted order regardless of input order", () => {
    const rows = fixtureRows();
    expect(summarizeArms([...rows].reverse())).toEqual(summarizeArms(rows));
  });

  test("deduplicates and sorts planned-but-unseen arms", () => {
    const summary = summarizeArms(fixtureRows(), {
      plannedArms: ["voice/z", "short/edge", "voice/a", "voice/z", "medium/cascade"],
      minN: 3,
    });
    expect(summary.missingArms).toEqual(["voice/a", "voice/z"]);
    expect(summary.arms.map((arm) => arm.enoughN)).toEqual([true, true]);
  });

  test("keeps warmup-only arm seen but with no timing or success rate", () => {
    const warmup = fixtureRows().filter((row) => row.phase === "warmup");
    const summary = summarizeArms(warmup, { plannedArms: ["short/edge"] });
    expect(summary.missingArms).toEqual([]);
    expect(summary.arms).toEqual([{
      tag: "short/edge",
      n: 0,
      okRate: null,
      ttfaP50: null,
      ttfaP95: null,
      ttfaMax: null,
      rtfP50: null,
      maxChunkGapP95: null,
      enoughN: false,
    }]);
  });

  test("counts scored failures toward okRate but never toward timing or minimum N", () => {
    const failed = fixtureRows().filter((row) => row.ok === 0);
    const summary = summarizeArms(failed, { minN: 1 });
    expect(summary.arms[0]).toMatchObject({
      tag: "medium/cascade", n: 0, okRate: 0,
      ttfaP50: null, ttfaP95: null, enoughN: false,
    });
  });

  test("default minN=100 rejects 24 successful scored samples", () => {
    const source = fixtureRows().find((row) => row.phase === "scored" && row.ok === 1);
    if (!source) throw new Error("fixture must have a scored success");
    const rows: TrialRow[] = Array.from({ length: 24 }, (_, index) => ({
      ...source,
      id: "sample-" + index,
      k: index,
    }));
    expect(summarizeArms(rows).arms[0]?.n).toBe(24);
    expect(summarizeArms(rows).arms[0]?.enoughN).toBe(false);
    expect(summarizeArms(rows, { minN: 24 }).arms[0]?.enoughN).toBe(true);
  });

  test("returns planned missing arms when there are zero rows", () => {
    expect(summarizeArms([], { plannedArms: ["b", "a", "a"] })).toEqual({
      arms: [], missingArms: ["a", "b"],
    });
  });

  test("invalid minimum N fails fast in the pure summarizer", () => {
    expect(() => summarizeArms(fixtureRows(), { minN: 0 })).toThrow(RangeError);
    expect(() => summarizeArms(fixtureRows(), { minN: 2.5 })).toThrow(RangeError);
  });
});

describe("first audible stage estimate", () => {
  test("sums stage p50 values without pretending end-to-end was measured", () => {
    const result = firstAudibleEstimate(250, 700);
    expect(result.estimateMs).toBe(950);
    expect(result.note).toContain("Stage sum");
    expect(result.note).toContain("not a measured end-to-end");
  });

  test("rejects invalid stage latencies", () => {
    expect(() => firstAudibleEstimate(-1, 200)).toThrow(RangeError);
    expect(() => firstAudibleEstimate(100, Infinity)).toThrow(RangeError);
  });
});

describe("TTS summary CLI", () => {
  test("prints a table and exits 1 below default minN", () => {
    const result = runCli(FIXTURE);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("ttfaP95");
    expect(result.stdout).toContain("short/edge");
    expect(result.stdout).toContain("medium/cascade");
    expect(result.stderr).toContain("line 4: invalid JSON");
  });

  test("exits 1 for missing planned arms even when scored N is sufficient", () => {
    const result = runCli(FIXTURE, "--min-n", "3", "--planned", "short/edge,voice/z,medium/cascade,voice/a");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Missing arms: voice/a, voice/z");
  });

  test("exits 0 and emits machine-readable summaries at sufficient N", () => {
    const result = runCli(FIXTURE, "--planned", "short/edge, medium/cascade", "--min-n", "3", "--json");
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      validRows: 9,
      warnings: ["line 4: invalid JSON"],
      minN: 3,
      missingArms: [],
      arms: [
        { tag: "medium/cascade", n: 3, okRate: 0.75, ttfaP95: 900, enoughN: true },
        { tag: "short/edge", n: 4, okRate: 1, ttfaP50: 200, enoughN: true },
      ],
    });
  });

  test("exits 2 on unreadable file without claiming trial evidence", () => {
    const missing = fileURLToPath(new URL("./fixtures/unreadable-tts-trials-never-created.jsonl", import.meta.url));
    const result = runCli(missing);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot read");
  });

  test("exits 2 on invalid CLI options", () => {
    expect(runCli(FIXTURE, "--min-n", "0").status).toBe(2);
    expect(runCli(FIXTURE, "--planned", "a,,b").status).toBe(2);
    expect(runCli(FIXTURE, "--unrecognized").status).toBe(2);
  });
});
