import { describe, expect, test } from "bun:test";
import { createStreamRate, formatStreamRate } from "./stream-rate";

describe("stream-rate: honest live measurements", () => {
  test("no observations, one observation and spans shorter than 250ms are unavailable", () => {
    const sampler = createStreamRate({ now: () => 0 });
    expect(sampler.rate(0)).toEqual({
      kind: "unavailable",
      reason: "insufficient streaming observations",
    });
    expect(formatStreamRate(sampler.rate(0))).toBeNull();

    sampler.sample(0, 80);
    expect(formatStreamRate(sampler.rate(0))).toBeNull();
    sampler.sample(249, 80);
    expect(formatStreamRate(sampler.rate(249))).toBeNull();
    sampler.sample(250, 80);
    expect(sampler.rate(250).kind).toBe("estimated");
  });

  test("steady character deltas produce a marked, deterministic estimate", () => {
    const sampler = createStreamRate({ now: () => 2_000 });
    sampler.sample(0, 80);
    sampler.sample(1_000, 80);
    expect(sampler.rate(1_000)).toEqual({ kind: "estimated", tokensPerSecond: 20 });
    sampler.sample(2_000, 80);
    expect(sampler.rate()).toEqual({ kind: "estimated", tokensPerSecond: 20 });
    expect(formatStreamRate(sampler.rate(2_000))).toBe("≈20 tok/s");
  });

  test("a burst decays during a stall, then falls out of the rolling window", () => {
    const sampler = createStreamRate({ now: () => 0 });
    sampler.sample(0, 80);
    sampler.sample(1_000, 80);
    sampler.sample(2_000, 80);
    expect(sampler.rate(2_000)).toEqual({ kind: "estimated", tokensPerSecond: 20 });
    expect(sampler.rate(3_500)).toEqual({ kind: "estimated", tokensPerSecond: 8 });
    expect(formatStreamRate(sampler.rate(3_500))).toBe("≈8.0 tok/s");
    expect(sampler.rate(5_200).kind).toBe("unavailable");
    expect(formatStreamRate(sampler.rate(5_200))).toBeNull();
  });

  test("cumulative host token counts beat text estimates when current", () => {
    const sampler = createStreamRate({ now: () => 2_000 });
    sampler.sample(0, 80);
    sampler.sample(1_000, 80);
    expect(sampler.rate(1_000).kind).toBe("estimated");
    sampler.report(1_000, 60);
    expect(sampler.rate(1_000)).toEqual({ kind: "measured", tokensPerSecond: 60 });
    expect(formatStreamRate(sampler.rate(1_000))).toBe("60 tok/s");

    // A host report older than fresh output is incomplete, so mark it estimated.
    sampler.sample(2_000, 80);
    expect(sampler.rate(2_000)).toEqual({ kind: "estimated", tokensPerSecond: 20 });
    sampler.report(2_000, 100);
    expect(sampler.rate(2_000)).toEqual({ kind: "measured", tokensPerSecond: 50 });
  });

  test("reports are cumulative and a pre-existing first count is a baseline", () => {
    const sampler = createStreamRate({ now: () => 2_000 });
    sampler.report(0, 20);
    sampler.report(1_000, 60);
    expect(sampler.rate(1_000)).toEqual({ kind: "measured", tokensPerSecond: 40 });
    sampler.report(2_000, 100);
    expect(sampler.rate(2_000)).toEqual({ kind: "measured", tokensPerSecond: 40 });
    sampler.finish(4_000);
    expect(sampler.rate(12_000)).toEqual({ kind: "measured", tokensPerSecond: 20 });
  });

  test("same-time chunks and reports coalesce rather than fake a time interval", () => {
    const sampler = createStreamRate({ now: () => 0 });
    sampler.sample(0, 80);
    sampler.sample(0, 80);
    expect(sampler.rate(0).kind).toBe("unavailable");
    sampler.sample(1_000, 80);
    expect(sampler.rate(1_000)).toEqual({ kind: "estimated", tokensPerSecond: 20 });
    sampler.report(1_000, 30);
    sampler.report(1_000, 60);
    expect(sampler.rate(1_000)).toEqual({ kind: "measured", tokensPerSecond: 60 });
  });

  test("finish freezes the whole-turn average, not the last sliding sample", () => {
    let now = 5_000;
    const sampler = createStreamRate({ now: () => now });
    sampler.sample(0, 80);
    sampler.sample(1_000, 80);
    sampler.sample(2_000, 80);
    expect(sampler.rate(2_000)).toEqual({ kind: "estimated", tokensPerSecond: 20 });
    sampler.finish();
    expect(sampler.rate(50_000)).toEqual({ kind: "estimated", tokensPerSecond: 12 });
    sampler.sample(6_000, 4_000);
    sampler.report(6_000, 1_000);
    now = 200_000;
    sampler.finish();
    expect(formatStreamRate(sampler.rate())).toBe("≈12 tok/s");

    const measured = createStreamRate({ now: () => 0 });
    measured.sample(0, 80);
    measured.sample(1_000, 80);
    measured.report(1_000, 100);
    measured.finish(4_000);
    expect(measured.rate(100_000)).toEqual({ kind: "measured", tokensPerSecond: 25 });
  });

  test("bad inputs and backwards clocks are ignored without losing good evidence", () => {
    const sampler = createStreamRate({ now: () => Number.NaN });
    expect(sampler.rate().kind).toBe("unavailable");
    sampler.sample(0, 80);
    sampler.sample(100, -5);
    sampler.sample(200, Number.NaN);
    sampler.sample(Number.NaN, 80);
    sampler.report(200, Number.NaN);
    sampler.sample(1_000, 80);
    sampler.report(1_000, 60);
    const before = sampler.rate(1_000);
    expect(before).toEqual({ kind: "measured", tokensPerSecond: 60 });
    sampler.report(900, 1_000);
    sampler.report(2_000, -5);
    sampler.report(2_000, Number.POSITIVE_INFINITY);
    sampler.report(2_000, 50);
    sampler.sample(800, 900);
    expect(sampler.rate(900)).toEqual(before);
    expect(sampler.rate(1_000)).toEqual(before);
    sampler.sample(2_000, 80);
    expect(sampler.rate(2_000)).toEqual({ kind: "estimated", tokensPerSecond: 20 });
  });

  test("a configured window under 250ms cannot claim a live rate", () => {
    const sampler = createStreamRate({ windowMs: 200, now: () => 0 });
    sampler.sample(0, 80);
    sampler.sample(200, 80);
    expect(sampler.rate(200)).toEqual({ kind: "unavailable", reason: "window too short" });
    sampler.finish(1_000);
    expect(sampler.rate(2_000)).toEqual({ kind: "estimated", tokensPerSecond: 40 });
  });

  test("insufficient whole-turn timing remains unavailable after finish", () => {
    const sampler = createStreamRate({ now: () => 0 });
    sampler.sample(0, 80);
    sampler.finish(5_000);
    expect(sampler.rate(10_000).kind).toBe("unavailable");
    expect(formatStreamRate(sampler.rate(10_000))).toBeNull();
  });
});

describe("formatStreamRate", () => {
  test("one decimal below ten, whole integers at ten or above", () => {
    expect(formatStreamRate({ kind: "measured", tokensPerSecond: 9.94 })).toBe("9.9 tok/s");
    expect(formatStreamRate({ kind: "estimated", tokensPerSecond: 9.94 })).toBe("≈9.9 tok/s");
    expect(formatStreamRate({ kind: "measured", tokensPerSecond: 10 })).toBe("10 tok/s");
    expect(formatStreamRate({ kind: "estimated", tokensPerSecond: 999 })).toBe("≈999 tok/s");
  });

  test("unknown, non-finite and non-positive rates never produce a chip", () => {
    expect(formatStreamRate({ kind: "unavailable", reason: "no data" })).toBeNull();
    expect(formatStreamRate({ kind: "estimated", tokensPerSecond: Number.NaN })).toBeNull();
    expect(formatStreamRate({ kind: "measured", tokensPerSecond: Number.POSITIVE_INFINITY })).toBeNull();
    expect(formatStreamRate({ kind: "measured", tokensPerSecond: 0 })).toBeNull();
    expect(formatStreamRate({ kind: "estimated", tokensPerSecond: -5 })).toBeNull();
  });
});
