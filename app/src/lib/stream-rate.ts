/**
 * Pure per-turn streaming token-rate estimator.
 *
 * Host reports are cumulative output-token totals, never token deltas.
 * Text samples are UTF-16 character deltas, not tokens: 4 chars ≈ 1 token.
 * Live rates compare two observations, excluding the unknown time before
 * the first observation. Final rates average the whole observed turn.
 */
export type StreamRate =
  | { kind: "measured"; tokensPerSecond: number }
  | { kind: "estimated"; tokensPerSecond: number }
  | { kind: "unavailable"; reason: string };

export type StreamRateSampler = {
  sample(atMs: number, deltaChars: number): void;
  report(atMs: number, outputTokens: number): void;
  finish(atMs?: number): void;
  rate(atMs?: number): StreamRate;
};

export type StreamRateOptions = {
  windowMs?: number;
  now: () => number;
};

type TimedCount = { atMs: number; value: number };

const DEFAULT_WINDOW_MS = 3_000;
const MIN_SPAN_MS = 250;
const CHARS_PER_TOKEN = 4;

function unavailable(reason: string): StreamRate {
  return { kind: "unavailable", reason };
}

/** Return the count per second between two sampled cumulative observations. */
function observedRate(points: readonly TimedCount[], atMs: number): number | undefined {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || last.atMs - first.atMs < MIN_SPAN_MS) return;
  const count = last.value - first.value;
  const elapsedMs = atMs - first.atMs;
  if (count < 0 || elapsedMs < MIN_SPAN_MS) return;
  const rate = (count * 1_000) / elapsedMs;
  return Number.isFinite(rate) ? rate : undefined;
}

export function createStreamRate({
  windowMs = DEFAULT_WINDOW_MS,
  now,
}: StreamRateOptions): StreamRateSampler {
  const window = Number.isFinite(windowMs) && windowMs > 0
    ? windowMs
    : DEFAULT_WINDOW_MS;
  const chars: TimedCount[] = [];
  const tokens: TimedCount[] = [];
  let startedAt: number | undefined;
  let lastClock: number | undefined;
  let lastEventAt: number | undefined;
  let eventCount = 0;
  let totalChars = 0;
  let reportedTotal: number | undefined;
  let reportedAtStart = 0;
  let frozen: StreamRate | undefined;

  function advance(atMs: number): boolean {
    if (!Number.isFinite(atMs) || (lastClock !== undefined && atMs < lastClock)) return false;
    lastClock = atMs;
    const cutoff = atMs - window;
    while (chars.length && (chars[0]?.atMs ?? Infinity) < cutoff) chars.shift();
    while (tokens.length && (tokens[0]?.atMs ?? Infinity) < cutoff) tokens.shift();
    return true;
  }

  function event(atMs: number): void {
    if (lastEventAt !== atMs) {
      eventCount++;
      lastEventAt = atMs;
    }
  }

  function sample(atMs: number, deltaChars: number): void {
    if (
      frozen !== undefined ||
      !Number.isSafeInteger(deltaChars) ||
      deltaChars <= 0 ||
      !Number.isSafeInteger(totalChars + deltaChars) ||
      !advance(atMs)
    ) return;

    if (startedAt === undefined) {
      startedAt = atMs;
      // A host count first reported later includes output since turn start.
      tokens.push({ atMs, value: 0 });
    }
    event(atMs);
    totalChars += deltaChars;

    const previous = chars[chars.length - 1];
    if (previous?.atMs === atMs) previous.value = totalChars;
    else chars.push({ atMs, value: totalChars });
  }

  function report(atMs: number, outputTokens: number): void {
    if (
      frozen !== undefined ||
      !Number.isSafeInteger(outputTokens) ||
      outputTokens < 0 ||
      (reportedTotal !== undefined && outputTokens < reportedTotal) ||
      !advance(atMs)
    ) return;

    if (startedAt === undefined) startedAt = atMs;
    if (startedAt === atMs) {
      // Do not count a pre-existing host total as tokens generated after t0.
      // Same-time reports coalesce into one observation, including its baseline.
      reportedAtStart = outputTokens;
    }
    event(atMs);
    reportedTotal = outputTokens;

    const previous = tokens[tokens.length - 1];
    if (previous?.atMs === atMs) previous.value = outputTokens;
    else tokens.push({ atMs, value: outputTokens });
  }

  function live(atMs: number): StreamRate {
    if (window < MIN_SPAN_MS) return unavailable("window too short");
    // Valid host evidence wins even when text has arrived more recently.
    const measured = observedRate(tokens, atMs);
    if (measured !== undefined) return { kind: "measured", tokensPerSecond: measured };
    const charsPerSecond = observedRate(chars, atMs);
    return charsPerSecond === undefined
      ? unavailable("insufficient streaming observations")
      : { kind: "estimated", tokensPerSecond: charsPerSecond / CHARS_PER_TOKEN };
  }

  function finish(atMs: number = now()): void {
    if (frozen !== undefined || !advance(atMs)) return;
    if (
      startedAt === undefined ||
      lastEventAt === undefined ||
      eventCount < 2 ||
      lastEventAt - startedAt < MIN_SPAN_MS ||
      atMs - startedAt < MIN_SPAN_MS
    ) {
      frozen = unavailable("insufficient turn timing");
      return;
    }

    const elapsedMs = atMs - startedAt;
    const hostTokens = reportedTotal === undefined ? 0 : reportedTotal - reportedAtStart;
    if (reportedTotal !== undefined) {
      frozen = { kind: "measured", tokensPerSecond: (hostTokens * 1_000) / elapsedMs };
    } else if (totalChars > 0) {
      frozen = { kind: "estimated", tokensPerSecond: (totalChars * 1_000) / (CHARS_PER_TOKEN * elapsedMs) };
    } else {
      frozen = unavailable("no output tokens");
    }
  }

  function rate(atMs: number = now()): StreamRate {
    if (frozen !== undefined) return frozen;
    // A regressing or invalid clock cannot move the sliding window backward.
    if (!advance(atMs)) return lastClock === undefined
      ? unavailable("no streaming observations")
      : live(lastClock);
    return live(atMs);
  }

  return { sample, report, finish, rate };
}

export function formatStreamRate(rate: StreamRate): string | null {
  if (rate.kind === "unavailable" || !Number.isFinite(rate.tokensPerSecond) || rate.tokensPerSecond < 0) return null;
  const roundedTenth = Math.round(rate.tokensPerSecond * 10) / 10;
  const display = roundedTenth >= 10
    ? String(Math.round(rate.tokensPerSecond))
    : roundedTenth.toFixed(1);
  return (rate.kind === "estimated" ? "≈" : "") + display + " tok/s";
}
