import { describe, expect, test } from "bun:test";
import { measuredTokenSpeed, NO_TOKEN_TIMING, tokenSpeedLabel } from "./token-speed";

describe("measured token speed", () => {
  test("no runtime timing is an honest unavailable state", () => {
    const speed = measuredTokenSpeed(undefined);
    expect(speed).toEqual({ kind: "unavailable", reason: NO_TOKEN_TIMING });
    expect(tokenSpeedLabel(speed)).toBe("unavailable · no token timing");
  });

  test("provider token counts over the measured span give tokens per second", () => {
    const speed = measuredTokenSpeed({ outputTokens: 420, startedAt: 1_000, finishedAt: 11_000, source: "provider usage" });
    expect(speed).toEqual({ kind: "measured", tokensPerSecond: 42, source: "provider usage" });
    expect(tokenSpeedLabel(speed)).toBe("42 tok/s");
  });

  test("rejects fractional, zero or negative token counts and spans too short to trust", () => {
    expect(measuredTokenSpeed({ outputTokens: 10.5, startedAt: 0, finishedAt: 1_000, source: "x" }).kind).toBe("unavailable");
    expect(measuredTokenSpeed({ outputTokens: 0, startedAt: 0, finishedAt: 1_000, source: "x" }).kind).toBe("unavailable");
    expect(measuredTokenSpeed({ outputTokens: 5, startedAt: 1_000, finishedAt: 0, source: "x" })).toEqual({ kind: "unavailable", reason: "turn too short to measure" });
    expect(measuredTokenSpeed({ outputTokens: 5, startedAt: 0, finishedAt: 249, source: "x" })).toEqual({ kind: "unavailable", reason: "turn too short to measure" });
    expect(measuredTokenSpeed({ outputTokens: 5, startedAt: 0, finishedAt: 250, source: "x" })).toEqual({ kind: "measured", tokensPerSecond: 20, source: "x" });
  });
});
