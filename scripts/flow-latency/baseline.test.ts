import { describe, expect, test } from "bun:test";
import {
  compareToBaseline,
  nextBaseline,
  parseBaseline,
  rerunDecision,
  type CurrentLatencyRow,
  type LatencyBaseline,
  type RerunAttempt,
} from "./baseline";

function fixture(): LatencyBaseline {
  return {
    version: 1,
    device: "Galaxy S25+",
    buildProfile: "release",
    sha: "8de8eea4af5e3daf1b7596160d6b6121ff051cae",
    capturedAt: "2026-10-27T08:00:00.000Z",
    rows: { voice: { n: 120, p50Ms: 50, p95Ms: 100 } },
  };
}

function sample(
  id: string,
  p95: number | null,
  n = 120,
  p50: number | null = p95 === null ? null : Math.min(50, p95),
): CurrentLatencyRow {
  return { id, n, p50, p95 };
}

function compare(current: readonly CurrentLatencyRow[]) {
  return compareToBaseline(fixture(), current, { buildProfile: "release" });
}

describe("parseBaseline: JSON schema v1", () => {
  test("round-trips the complete typed baseline with a safe device label", () => {
    const expected = fixture();
    const raw: unknown = JSON.parse(JSON.stringify(expected));
    const parsed = parseBaseline(raw);
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed).toEqual(expected);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(expected));
    expect(parsed).not.toBe(raw);
  });

  test("accepts both build profiles and 7-40 hex SHA lengths", () => {
    expect(typeof parseBaseline({ ...fixture(), buildProfile: "dev", sha: "abc1234" })).toBe("object");
    expect(typeof parseBaseline({ ...fixture(), sha: "F".repeat(40) })).toBe("object");
  });

  test("rejects path, URL, IP address and non-model device labels", () => {
    for (const device of [
      "/tmp/Pixel 9",
      "Pixel:9",
      "http://phone",
      "192.168.1.1",
      "Pixel_9",
      "Pixel@home",
      " ",
      " Pixel 9 ",
      "X".repeat(33),
    ]) {
      const result = parseBaseline({ ...fixture(), device });
      expect(typeof result).toBe("string");
      if (typeof result !== "string") throw new Error("unsafe device label accepted: " + device);
      expect(result).toMatch(/device/i);
    }
  });

  test("rejects wrong versions, profiles and SHA formats", () => {
    expect(typeof parseBaseline({ ...fixture(), version: 2 })).toBe("string");
    expect(typeof parseBaseline({ ...fixture(), buildProfile: "debug" })).toBe("string");
    expect(typeof parseBaseline({ ...fixture(), sha: "xyz9999" })).toBe("string");
    expect(typeof parseBaseline({ ...fixture(), sha: "123456" })).toBe("string");
    expect(typeof parseBaseline(null)).toBe("string");
    expect(typeof parseBaseline([])).toBe("string");
  });

  test("rejects non-ISO and impossible calendar timestamps", () => {
    for (const capturedAt of [
      "yesterday",
      "2026-10-27",
      "2026-10-27T08:00:00",
      "2026-02-30T08:00:00Z",
      "2026-13-01T08:00:00Z",
    ]) {
      expect(typeof parseBaseline({ ...fixture(), capturedAt })).toBe("string");
    }
    expect(typeof parseBaseline({
      ...fixture(),
      capturedAt: "2026-10-27T03:00:00-05:00",
    })).toBe("object");
  });

  test("rejects malformed row objects and non-finite or inverted latencies", () => {
    const cases: readonly unknown[] = [
      { voice: { n: 0, p50Ms: 5, p95Ms: 10 } },
      { voice: { n: 4.5, p50Ms: 5, p95Ms: 10 } },
      { voice: { n: 110, p50Ms: 12, p95Ms: 10 } },
      { voice: { n: 110, p50Ms: 5, p95Ms: Number.POSITIVE_INFINITY } },
      { voice: { n: 110, p50Ms: -1, p95Ms: 10 } },
      { voice: { n: 110, p50Ms: null, p95Ms: 10 } },
      { " ": { n: 110, p50Ms: 1, p95Ms: 2 } },
      ["not", "a", "record"],
    ];
    for (const rows of cases) {
      expect(typeof parseBaseline({ ...fixture(), rows })).toBe("string");
    }
  });

  test("retains reserved property names as data, never prototypes", () => {
    const raw = {
      ...fixture(),
      rows: Object.fromEntries([
        ["__proto__", { n: 100, p50Ms: 1, p95Ms: 2 }],
        ["constructor", { n: 100, p50Ms: 2, p95Ms: 3 }],
      ]),
    };
    const parsed = parseBaseline(raw);
    if (typeof parsed === "string") throw new Error(parsed);
    expect(Object.hasOwn(parsed.rows, "__proto__")).toBe(true);
    expect(Object.hasOwn(parsed.rows, "constructor")).toBe(true);
    expect(parsed.rows["__proto__"]?.p95Ms).toBe(2);
  });
});

describe("compareToBaseline: p95 regression gate", () => {
  test("treats exactly +10.0% as ok and +10.1% as regressed", () => {
    const boundary = compare([sample("voice", 110)]);
    expect(boundary).toHaveLength(1);
    expect(boundary[0]?.status).toBe("ok");
    expect(boundary[0]?.deltaPct).toBeCloseTo(10);

    const regression = compare([sample("voice", 110.1)]);
    expect(regression[0]?.status).toBe("regressed");
    expect(regression[0]?.deltaPct).toBeCloseTo(10.1);
  });

  test("improves strictly below -10% and remains ok on the boundary", () => {
    expect(compare([sample("voice", 90)])[0]?.status).toBe("ok");
    const improvement = compare([sample("voice", 89)]);
    expect(improvement[0]?.status).toBe("improved");
    expect(improvement[0]?.deltaPct).toBeCloseTo(-11);
  });

  test("reports new and missing stages in stable input/baseline order", () => {
    const baseline: LatencyBaseline = {
      ...fixture(),
      rows: {
        voice: { n: 120, p50Ms: 50, p95Ms: 100 },
        decode: { n: 120, p50Ms: 20, p95Ms: 40 },
      },
    };
    const result = compareToBaseline(baseline, [
      sample("voice", 100),
      sample("encode", 55),
    ], { buildProfile: "release" });
    expect(result.map((entry) => [entry.id, entry.status, entry.deltaPct])).toEqual([
      ["voice", "ok", 0],
      ["encode", "new", null],
      ["decode", "missing", null],
    ]);
  });

  test("marks null/empty measurements missing rather than green", () => {
    expect(compare([sample("voice", null)])[0]?.status).toBe("missing");
    expect(compare([sample("voice", 0, 0, 0)])[0]?.status).toBe("missing");
    expect(compare([])[0]).toEqual({ id: "voice", status: "missing", deltaPct: null });
  });

  test("throws rather than crossing release/dev profiles", () => {
    expect(() => compareToBaseline(fixture(), [sample("voice", 99)], {
      buildProfile: "dev",
    })).toThrow(/buildProfile mismatch/);
  });

  test("validates thresholds and rejects duplicate or invalid stage readings", () => {
    expect(() => compareToBaseline(fixture(), [sample("voice", 111)], {
      buildProfile: "release",
      regressionPct: -1,
    })).toThrow(/regressionPct/);
    expect(() => compareToBaseline(fixture(), [sample("voice", 111)], {
      buildProfile: "release",
      regressionPct: Number.NaN,
    })).toThrow(/regressionPct/);
    expect(() => compare([sample("voice", 99), sample("voice", 99)])).toThrow(/duplicate/);
    expect(() => compare([sample("voice", 40, -1)])).toThrow(/sample count/);
    expect(() => compare([sample("voice", 20, 120, 40)])).toThrow(/latency/);
  });

  test("uses a custom regression percentage when provided", () => {
    const result = compareToBaseline(fixture(), [sample("voice", 106)], {
      buildProfile: "release",
      regressionPct: 5,
    });
    expect(result[0]?.status).toBe("regressed");
  });

  test("handles a zero baseline without Infinity or division-by-zero", () => {
    const baseline: LatencyBaseline = {
      ...fixture(),
      rows: { voice: { n: 100, p50Ms: 0, p95Ms: 0 } },
    };
    const same = compareToBaseline(baseline, [sample("voice", 0)], { buildProfile: "release" });
    expect(same[0]).toEqual({ id: "voice", status: "ok", deltaPct: 0 });
    const changed = compareToBaseline(baseline, [sample("voice", 1)], { buildProfile: "release" });
    expect(changed[0]).toEqual({ id: "voice", status: "regressed", deltaPct: null });
  });

  test("does not mutate frozen inputs", () => {
    const base = fixture();
    const row = Object.freeze(sample("voice", 109));
    const current: readonly CurrentLatencyRow[] = Object.freeze([row]);
    expect(compareToBaseline(base, current, { buildProfile: "release" })[0]?.status).toBe("ok");
    expect(base.rows.voice?.p95Ms).toBe(100);
    expect(current[0]?.p95).toBe(109);
  });
});

describe("rerunDecision: fail-only two-rerun cap", () => {
  test("allows first and second reruns after failures, but not the third", () => {
    const first: readonly RerunAttempt[] = [{ attempt: 1, verdict: "fail" }];
    const second: readonly RerunAttempt[] = [...first, { attempt: 2, verdict: "fail" }];
    const third: readonly RerunAttempt[] = [...second, { attempt: 3, verdict: "fail" }];
    expect(rerunDecision(first).allowed).toBe(true);
    expect(rerunDecision(second).allowed).toBe(true);
    expect(rerunDecision(third)).toEqual({
      allowed: false,
      reason: "two reruns have already been used",
    });
    expect(third).toHaveLength(3); // No decision can erase historical results.
  });

  test("refuses retries after any pass, including a prior pass", () => {
    expect(rerunDecision([{ attempt: 0, verdict: "pass" }]).allowed).toBe(false);
    expect(rerunDecision([
      { attempt: 0, verdict: "fail" },
      { attempt: 1, verdict: "pass" },
    ]).allowed).toBe(false);
    expect(rerunDecision([
      { attempt: 0, verdict: "pass" },
      { attempt: 1, verdict: "fail" },
    ]).allowed).toBe(false);
  });

  test("rejects missing, skipped and partially reported attempt history", () => {
    expect(rerunDecision([]).allowed).toBe(false);
    expect(rerunDecision([{ attempt: 4, verdict: "fail" }]).allowed).toBe(false);
    expect(rerunDecision([
      { attempt: 1, verdict: "fail" },
      { attempt: 3, verdict: "fail" },
    ]).allowed).toBe(false);
  });
});

describe("nextBaseline: candidate admission", () => {
  test("refuses any row with fewer than the 100 required samples", () => {
    const result = nextBaseline(fixture(), [sample("voice", 99, 99)]);
    expect(result).toEqual({ refused: ["voice: sample count 99 below 100"] });
  });

  test("refuses a p95 regression even with enough observations", () => {
    const result = nextBaseline(fixture(), [sample("voice", 110.1, 150)]);
    expect(result).toEqual({ refused: ["voice: p95 regression exceeds 10%"] });
  });

  test("refuses absent baseline stages, absent p95 and empty current runs", () => {
    expect(nextBaseline(fixture(), [])).toEqual({
      refused: ["no current samples", "voice: stage/latency is missing"],
    });
    const lacking = nextBaseline(fixture(), [sample("voice", null)]);
    expect("refused" in lacking).toBe(true);

    const baseline: LatencyBaseline = {
      ...fixture(),
      rows: {
        voice: { n: 120, p50Ms: 50, p95Ms: 100 },
        encode: { n: 120, p50Ms: 25, p95Ms: 60 },
      },
    };
    const result = nextBaseline(baseline, [sample("voice", 100)]);
    expect("refused" in result).toBe(true);
    if (!("refused" in result)) throw new Error("missing baseline stage was promoted");
    expect(result.refused.some((reason) => reason.includes("encode"))).toBe(true);
  });

  test("refuses invalid current measurements and minN instead of promoting", () => {
    expect("refused" in nextBaseline(fixture(), [sample("voice", 20, 120, 40)])).toBe(true);
    expect(nextBaseline(fixture(), [sample("voice", 99)], { minN: 0 })).toEqual({
      refused: ["minN must be a positive integer"],
    });
  });

  test("promotes exact minimum, new stages and safe p95 changes without mutations", () => {
    const baseline = fixture();
    const current: readonly CurrentLatencyRow[] = [
      sample("voice", 110, 100),
      sample("encode", 55, 101),
    ];
    const result = nextBaseline(baseline, current);
    if ("refused" in result) throw new Error(result.refused.join("; "));
    expect(result).not.toBe(baseline);
    expect(result.version).toBe(1);
    expect(result.sha).toBe(baseline.sha);
    expect(result.capturedAt).toBe(baseline.capturedAt);
    expect(result.rows).toEqual({
      voice: { n: 100, p50Ms: 50, p95Ms: 110 },
      encode: { n: 101, p50Ms: 50, p95Ms: 55 },
    });
    expect(baseline.rows.voice?.p95Ms).toBe(100);
    expect(Object.hasOwn(baseline.rows, "encode")).toBe(false);
    expect(current[0]?.p95).toBe(110);
  });

  test("respects an explicit smaller sample minimum", () => {
    const result = nextBaseline(fixture(), [sample("voice", 98, 10)], { minN: 10 });
    expect("refused" in result).toBe(false);
  });
});
