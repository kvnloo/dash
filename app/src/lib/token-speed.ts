/** Provider-reported output tokens and the wall-clock span that produced them. Character counts are not tokens. */
export type TokenTiming = { outputTokens: number; startedAt: number; finishedAt: number; source: string };
export type TokenSpeed = { kind: "measured"; tokensPerSecond: number; source: string } | { kind: "unavailable"; reason: string };

export const NO_TOKEN_TIMING = "no token timing";
const MIN_SPAN_MS = 250;

export function measuredTokenSpeed(timing: TokenTiming | undefined): TokenSpeed {
  if (!timing) return { kind: "unavailable", reason: NO_TOKEN_TIMING };
  const span = timing.finishedAt - timing.startedAt;
  if (!Number.isInteger(timing.outputTokens) || timing.outputTokens <= 0 || !Number.isFinite(span)) return { kind: "unavailable", reason: "token timing is invalid" };
  if (span < MIN_SPAN_MS) return { kind: "unavailable", reason: "turn too short to measure" };
  return { kind: "measured", tokensPerSecond: timing.outputTokens / (span / 1000), source: timing.source };
}

export function tokenSpeedLabel(speed: TokenSpeed): string {
  return speed.kind === "measured" ? `${Math.round(speed.tokensPerSecond)} tok/s` : `unavailable · ${speed.reason}`;
}
