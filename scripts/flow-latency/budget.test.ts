import { describe, expect, test } from "bun:test";
import {
  FLOW_BUDGET,
  evaluateBudget,
  evaluateRow,
  percentile,
  type BudgetRow,
} from "./budget";

const LOCAL_ACK: BudgetRow = {
  id: "local-ack",
  start: ["input.pen", "input.touch", "input.mic"],
  end: "ack.paint",
  p50Ms: 50,
  p95Ms: 100,
  provisional: false,
  note: "Test thresholds match the local-ack contract.",
};

const repeated = (n: number, durationMs: number): number[] =>
  Array.from({ length: n }, () => durationMs);

describe("percentile: one-based nearest rank", () => {
  test("one sample is returned at every allowed percentile", () => {
    expect(percentile([7], 0.01)).toBe(7);
    expect(percentile([7], 0.5)).toBe(7);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([7], 1)).toBe(7);
  });

  test("two observations select first for p50, second for p95", () => {
    expect(percentile([10, 20], 0.5)).toBe(10);
    expect(percentile([10, 20], 0.95)).toBe(20);
  });

  test("10 and 100 observations use ceil(q * n), not interpolation", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(ten, 0.5)).toBe(5);
    expect(percentile(ten, 0.95)).toBe(10);
    expect(percentile(hundred, 0.01)).toBe(1);
    expect(percentile(hundred, 0.5)).toBe(50);
    expect(percentile(hundred, 0.95)).toBe(95);
    expect(percentile(hundred, 1)).toBe(100);
  });

  test("n=30 at p95 selects the 29th value", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(percentile(thirty, 0.95)).toBe(29);
  });

  test("empty input returns null; invalid quantiles throw even for empty input", () => {
    expect(percentile([], 0.5)).toBeNull();
    for (const q of [0, -0.1, 1.01, NaN, Infinity, -Infinity]) {
      expect(() => percentile([], q)).toThrow(RangeError);
    }
  });
});

describe("evaluateRow", () => {
  test("100 valid samples below budgets pass with exact nearest ranks", () => {
    const result = evaluateRow(LOCAL_ACK, repeated(100, 20));
    expect(result).toEqual({
      id: "local-ack",
      n: 100,
      rejected: 0,
      p50: 20,
      p95: 20,
      max: 20,
      status: "pass",
      reasons: [],
    });
  });

  test("equal to both budgets still passes", () => {
    const samples = [...repeated(50, 50), ...repeated(50, 100)];
    const result = evaluateRow(LOCAL_ACK, samples);
    expect(result.p50).toBe(50);
    expect(result.p95).toBe(100);
    expect(result.status).toBe("pass");
  });

  test("99 otherwise passing observations are insufficient by default", () => {
    const result = evaluateRow(LOCAL_ACK, repeated(99, 20));
    expect(result.n).toBe(99);
    expect(result.p50).toBe(20);
    expect(result.p95).toBe(20);
    expect(result.max).toBe(20);
    expect(result.status).toBe("insufficient-n");
    expect(result.reasons.join(" ")).toContain("100");
  });

  test("p95-only breach fails and names p95 in the reason", () => {
    const samples = [...repeated(94, 20), ...repeated(6, 120)];
    const result = evaluateRow(LOCAL_ACK, samples);
    expect(result.p50).toBe(20);
    expect(result.p95).toBe(120);
    expect(result.max).toBe(120);
    expect(result.status).toBe("fail");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("p95");
  });

  test("threshold failure beats low sample count", () => {
    const result = evaluateRow(LOCAL_ACK, [120]);
    expect(result.n).toBe(1);
    expect(result.status).toBe("fail");
    expect(result.reasons.join(" ")).toContain("p95");
  });

  test("negative and non-finite durations are rejected, and input is not mutated", () => {
    const samples = [10, NaN, 0, -1, Infinity, -Infinity];
    const result = evaluateRow(LOCAL_ACK, samples, { minN: 2 });
    expect(result).toEqual({
      id: "local-ack",
      n: 2,
      rejected: 4,
      p50: 0,
      p95: 10,
      max: 10,
      status: "pass",
      reasons: [],
    });
    expect(samples[0]).toBe(10);
    expect(samples[2]).toBe(0);
    expect(Number.isNaN(samples[1])).toBe(true);
  });

  test("zero valid samples stays no-samples with null statistics", () => {
    const result = evaluateRow(LOCAL_ACK, [NaN, -2, Infinity]);
    expect(result.n).toBe(0);
    expect(result.rejected).toBe(3);
    expect(result.p50).toBeNull();
    expect(result.p95).toBeNull();
    expect(result.max).toBeNull();
    expect(result.status).toBe("no-samples");
    expect(evaluateRow(LOCAL_ACK, []).status).toBe("no-samples");
  });

  test("custom positive minN is supported, invalid minimums rejected", () => {
    expect(evaluateRow(LOCAL_ACK, [1, 2], { minN: 2 }).status).toBe("pass");
    expect(evaluateRow(LOCAL_ACK, [1, 2], { minN: 3 }).status).toBe("insufficient-n");
    for (const minN of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => evaluateRow(LOCAL_ACK, [2], { minN })).toThrow(RangeError);
    }
  });
});

describe("evaluateBudget", () => {
  test("a measured, passing optional subset can pass; unmeasured rows remain visible", () => {
    const readings = new Map<string, readonly number[]>([
      ["local-ack", repeated(100, 20)],
    ]);
    const result = evaluateBudget(readings, { required: ["local-ack"] });
    expect(result.verdict).toBe("pass");
    expect(result.unknownIds).toEqual([]);
    expect(result.rows).toHaveLength(FLOW_BUDGET.length);
    expect(result.rows.find((row) => row.id === "local-ack")?.status).toBe("pass");
    expect(result.rows.find((row) => row.id === "loader")?.status).toBe("no-samples");
  });

  test("a required missing budget makes the verdict incomplete", () => {
    const readings = new Map<string, readonly number[]>([
      ["local-ack", repeated(100, 20)],
    ]);
    expect(evaluateBudget(readings, { required: ["local-ack", "loader"] }).verdict)
      .toBe("incomplete");
  });

  test("unknown sample IDs are reported in stable order without being scored", () => {
    const readings = new Map<string, readonly number[]>([
      ["z-not-configured", [1]],
      ["local-ack", repeated(100, 20)],
      ["a-not-configured", [2]],
    ]);
    const result = evaluateBudget(readings, { required: ["local-ack"] });
    expect(result.unknownIds).toEqual(["a-not-configured", "z-not-configured"]);
    expect(result.rows.some((row) => row.id === "a-not-configured")).toBe(false);
    expect(result.verdict).toBe("pass");
    expect(evaluateBudget(readings, { required: ["a-not-configured"] }).verdict)
      .toBe("incomplete");
  });

  test("a short sample or invalid-only submitted row cannot turn the summary green", () => {
    const short = new Map<string, readonly number[]>([
      ["local-ack", repeated(99, 20)],
    ]);
    expect(evaluateBudget(short).verdict).toBe("incomplete");

    const invalid = new Map<string, readonly number[]>([
      ["local-ack", repeated(100, 20)],
      ["loader", [NaN, -1]],
    ]);
    expect(evaluateBudget(invalid).verdict).toBe("incomplete");
    expect(evaluateBudget(invalid).rows.find((row) => row.id === "loader")?.rejected).toBe(2);
  });

  test("failure wins over missing required rows and insufficient n", () => {
    const readings = new Map<string, readonly number[]>([
      ["local-ack", repeated(99, 120)],
    ]);
    const result = evaluateBudget(readings, { required: ["loader"] });
    expect(result.verdict).toBe("fail");
    expect(result.rows.find((row) => row.id === "local-ack")?.status).toBe("fail");
  });

  test("empty budget evidence is incomplete, never pass", () => {
    expect(evaluateBudget(new Map()).verdict).toBe("incomplete");
    expect(evaluateBudget(new Map([["loader", []]])).verdict).toBe("incomplete");
  });
});

describe("FLOW_BUDGET contract", () => {
  test("pins every stage pair, percentile target, and provisional flag", () => {
    expect(FLOW_BUDGET.map((row) => [
      row.id,
      row.start,
      row.end,
      row.p50Ms,
      row.p95Ms,
      row.provisional,
    ])).toEqual([
      ["ink-first-frame", ["ink.down"], "ink.frame", 16.7, 25, true],
      ["pill-change", ["stylus.btn"], "pill.commit", 50, 80, false],
      ["local-ack", ["input.pen", "input.touch", "input.mic"], "ack.paint", 50, 100, false],
      ["first-word", ["vad.start"], "word.paint", 500, 900, true],
      ["loader", ["turn.commit"], "genui.loader", 300, 500, false],
      ["first-node", ["turn.commit"], "genui.first_node", 1500, 2500, false],
      ["first-audible", ["turn.commit"], "audio.first_frame_out", 1314, 1983, true],
      ["barge-silence", ["vad.start"], "playback.silence", 200, 300, false],
      ["stale-discard", ["gen.bump"], "genui.discard", 100, 100, false],
      ["refresh", ["refresh.save"], "refresh.paint", 2000, 4000, false],
      ["circle-chip", ["ink.up"], "chip.paint", 150, 300, false],
    ]);
  });

  test("row identifiers are unique, stages and notes populated, budgets ordered", () => {
    expect(new Set(FLOW_BUDGET.map((row) => row.id)).size).toBe(FLOW_BUDGET.length);
    for (const row of FLOW_BUDGET) {
      expect(row.id.length).toBeGreaterThan(0);
      expect(row.start.length).toBeGreaterThan(0);
      expect(row.end.length).toBeGreaterThan(0);
      expect(row.note.trim().length).toBeGreaterThan(0);
      expect(row.p50Ms).toBeGreaterThanOrEqual(0);
      expect(row.p95Ms).toBeGreaterThanOrEqual(row.p50Ms);
    }
  });
});
