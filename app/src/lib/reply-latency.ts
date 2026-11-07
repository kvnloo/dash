/**
 * Deterministic per-turn reply telemetry. All timestamps are caller supplied
 * milliseconds on the same time base (normally Date.now() wall-clock epoch).
 * Do not combine unsynchronized device/bridge clocks without normalization.
 *
 * Each duration is measured from "sent", not from the preceding milestone.
 * Completed = "done" (failed turns are retained but excluded from percentiles).
 * Percentiles use nearest rank: sorted[ceil(p * N) - 1], not interpolation.
 */
export type LatencyStage = "sent" | "acked" | "started" | "first-delta" | "done" | "failed";

export const LATENCY_ABANDON_MS = 10 * 60 * 1_000;

export interface LatencyMeterOptions {
  /** Maximum number of retained turn records, including unfinished turns. */
  capacity?: number;
}

export interface LatencyTurn {
  turnId: string;
  harness: string | null;
  status: "active" | "done" | "failed";
  sentAtMs: number;
  ackedAtMs: number | null;
  startedAtMs: number | null;
  firstDeltaAtMs: number | null;
  doneAtMs: number | null;
  failedAtMs: number | null;
  ackMs: number | null;
  startMs: number | null;
  firstDeltaMs: number | null;
  totalMs: number | null;
}

export interface LatencyPercentiles {
  /** Number of completed turns that have this particular duration. */
  count: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
}

export interface LatencySummary {
  /** Completed ("done") turns still retained in the capacity-bounded buffer. */
  count: number;
  /**
   * Unfiltered: cumulative unfinished turns expired after ten minutes.
   * Harness-filtered: matching turns among the last `capacity` abandonments.
   * Older harness attribution is discarded to keep all telemetry bounded.
   */
  abandoned: number;
  ackMs: LatencyPercentiles;
  startMs: LatencyPercentiles;
  firstDeltaMs: LatencyPercentiles;
  totalMs: LatencyPercentiles;
}

export interface LatencyMeter {
  /**
   * Record the first valid timestamp for a stage. Pass harness only on "sent".
   * Unknown turns cannot be started by a non-sent mark.
   */
  mark(turnId: string, stage: LatencyStage, atMs: number, harness?: string): void;
  /**
   * Return a fresh snapshot, or null if unknown/evicted/abandoned.
   * Pass asOfMs to expire idle turns without requiring timers.
   */
  turn(turnId: string, asOfMs?: number): LatencyTurn | null;
  /**
   * The optional harness filters completed samples and the last `capacity`
   * abandonments; the unfiltered abandoned total is cumulative.
   * asOfMs advances a monotonic high-water timestamp for TTL collection.
   * Without asOfMs, the latest observed mark time is used.
   */
  summary(harness?: string, asOfMs?: number): LatencySummary;
}

interface TurnRecord {
  turnId: string;
  harness: string | null;
  sentAtMs: number;
  ackedAtMs?: number;
  startedAtMs?: number;
  firstDeltaAtMs?: number;
  doneAtMs?: number;
  failedAtMs?: number;
}

function elapsed(sentAtMs: number, markAtMs?: number, terminalAtMs?: number): number | null {
  if (
    markAtMs === undefined ||
    markAtMs < sentAtMs ||
    (terminalAtMs !== undefined && markAtMs > terminalAtMs)
  ) return null;
  return markAtMs - sentAtMs;
}

function snapshot(record: TurnRecord): LatencyTurn {
  const terminalAtMs = record.doneAtMs ?? record.failedAtMs;
  return {
    turnId: record.turnId,
    harness: record.harness,
    status: record.doneAtMs !== undefined
      ? "done"
      : record.failedAtMs !== undefined ? "failed" : "active",
    sentAtMs: record.sentAtMs,
    ackedAtMs: record.ackedAtMs ?? null,
    startedAtMs: record.startedAtMs ?? null,
    firstDeltaAtMs: record.firstDeltaAtMs ?? null,
    doneAtMs: record.doneAtMs ?? null,
    failedAtMs: record.failedAtMs ?? null,
    ackMs: elapsed(record.sentAtMs, record.ackedAtMs, terminalAtMs),
    startMs: elapsed(record.sentAtMs, record.startedAtMs, terminalAtMs),
    firstDeltaMs: elapsed(record.sentAtMs, record.firstDeltaAtMs, terminalAtMs),
    totalMs: elapsed(record.sentAtMs, record.doneAtMs),
  };
}

function percentiles(values: number[]): LatencyPercentiles {
  if (values.length === 0) return { count: 0, p50: null, p90: null, p99: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const nearestRank = (percent: number): number | null =>
    sorted[Math.ceil(percent * sorted.length) - 1] ?? null;
  return {
    count: sorted.length,
    p50: nearestRank(0.5),
    p90: nearestRank(0.9),
    p99: nearestRank(0.99),
    max: sorted[sorted.length - 1] ?? null,
  };
}

export function createLatencyMeter(options: LatencyMeterOptions = {}): LatencyMeter {
  const capacity = options.capacity ?? 200;
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("Latency meter capacity must be a positive safe integer");
  }

  // Map insertion order is the oldest-first ring order. No network or timers.
  const turns = new Map<string, TurnRecord>();
  // Keep individual attribution only for the last capacity abandonments.
  // Arbitrary harness names must not accumulate in a lifetime counter map.
  const abandonedHarnesses: (string | null)[] = [];
  // Bounded retired-ID history stops retries from reviving expired or evicted turns.
  // Once this window fills, older IDs may be reused; memory remains O(capacity).
  const retiredTurnIds = new Set<string>();
  let abandoned = 0;
  let observedAtMs = Number.NEGATIVE_INFINITY;

  function retire(turnId: string): void {
    retiredTurnIds.add(turnId);
    if (retiredTurnIds.size > capacity) {
      const oldest = retiredTurnIds.values().next().value;
      if (oldest !== undefined) retiredTurnIds.delete(oldest);
    }
  }

  function advance(atMs: number): void {
    if (!Number.isFinite(atMs) || atMs < 0) return;
    observedAtMs = Math.max(observedAtMs, atMs);
    for (const [id, record] of turns) {
      if (
        record.doneAtMs !== undefined ||
        record.failedAtMs !== undefined ||
        observedAtMs - record.sentAtMs < LATENCY_ABANDON_MS
      ) continue;
      turns.delete(id);
      retire(id);
      abandoned += 1;
      if (abandonedHarnesses.length === capacity) abandonedHarnesses.shift();
      abandonedHarnesses.push(record.harness);
    }
  }

  return {
    mark(turnId, stage, atMs, harness) {
      if (!turnId.trim() || !Number.isFinite(atMs) || atMs < 0) return;
      // Orphan stages must not advance the clock or change other turns.
      if (stage !== "sent" && !turns.has(turnId)) return;
      advance(atMs);

      if (stage === "sent") {
        // Retries retain the original send timestamp and harness.
        if (
          turns.has(turnId) ||
          retiredTurnIds.has(turnId) ||
          observedAtMs - atMs >= LATENCY_ABANDON_MS
        ) return;
        if (turns.size === capacity) {
          const oldest = turns.keys().next().value;
          if (oldest !== undefined) {
            turns.delete(oldest);
            retire(oldest);
          }
        }
        turns.set(turnId, {
          turnId,
          sentAtMs: atMs,
          harness: harness && harness.trim() ? harness : null,
        });
        return;
      }

      const record = turns.get(turnId);
      if (!record || atMs < record.sentAtMs) return;
      const terminalAtMs = record.doneAtMs ?? record.failedAtMs;
      if (terminalAtMs !== undefined && atMs > terminalAtMs) return;

      if (stage === "acked" && record.ackedAtMs === undefined) {
        record.ackedAtMs = atMs;
      } else if (stage === "started" && record.startedAtMs === undefined) {
        record.startedAtMs = atMs;
      } else if (stage === "first-delta" && record.firstDeltaAtMs === undefined) {
        record.firstDeltaAtMs = atMs;
      } else if (
        (stage === "done" || stage === "failed") &&
        terminalAtMs === undefined
      ) {
        if (stage === "done") record.doneAtMs = atMs;
        else record.failedAtMs = atMs;
      }
    },
    turn(turnId, asOfMs) {
      if (asOfMs !== undefined) advance(asOfMs);
      const record = turns.get(turnId);
      return record ? snapshot(record) : null;
    },
    summary(harness, asOfMs) {
      if (asOfMs !== undefined) advance(asOfMs);
      const completed = [...turns.values()]
        .filter((record) => record.doneAtMs !== undefined &&
          (harness === undefined || record.harness === harness))
        .map(snapshot);
      const durations = (key: "ackMs" | "startMs" | "firstDeltaMs" | "totalMs"): number[] =>
        completed.map((turn) => turn[key]).filter((value): value is number => value !== null);
      return {
        count: completed.length,
        abandoned: harness === undefined
          ? abandoned
          : abandonedHarnesses.filter((name) => name === harness).length,
        ackMs: percentiles(durations("ackMs")),
        startMs: percentiles(durations("startMs")),
        firstDeltaMs: percentiles(durations("firstDeltaMs")),
        totalMs: percentiles(durations("totalMs")),
      };
    },
  };
}

/** Compact, locale-independent presentation for non-negative milliseconds. */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}
