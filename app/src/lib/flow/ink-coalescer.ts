/**
 * Pure ink-delta rate limiter for Flow quiet context.
 *
 * Push emits the first update immediately, then at most once per interval.
 * Sub-interval updates are merged into the next emission. Call flush at the
 * end of a stroke/session to deliver the final buffered delta; flush is an
 * explicit final emission and can occur earlier than the regular interval.
 * This module never sends voice/audio or schedules its own timers.
 */

export interface InkDelta {
  at: number;
  shape: "pen" | "highlighter" | "arrow" | "box" | "circle";
  bbox: readonly [number, number, number, number];
  targetId?: string;
}

export interface DeltaCoalescer {
  push(delta: InkDelta): InkDelta | null;
  flush(): InkDelta | null;
}

export interface DeltaCoalescerOptions {
  intervalMs?: number;
}

function snapshot(delta: InkDelta): InkDelta {
  const [minX, minY, maxX, maxY] = delta.bbox;
  return {
    at: delta.at,
    shape: delta.shape,
    bbox: [minX, minY, maxX, maxY],
    ...(delta.targetId === undefined ? {} : { targetId: delta.targetId }),
  };
}

/** Shape, optional target and timestamp come from the most recently pushed delta. */
function merge(previous: InkDelta, latest: InkDelta): InkDelta {
  const [minX, minY, maxX, maxY] = previous.bbox;
  const [nextMinX, nextMinY, nextMaxX, nextMaxY] = latest.bbox;
  return {
    at: latest.at,
    shape: latest.shape,
    bbox: [
      Math.min(minX, nextMinX),
      Math.min(minY, nextMinY),
      Math.max(maxX, nextMaxX),
      Math.max(maxY, nextMaxY),
    ],
    ...(latest.targetId === undefined ? {} : { targetId: latest.targetId }),
  };
}

/**
 * Uses event timestamps (milliseconds), not wall-clock timers.
 * flush() deliberately bypasses the periodic limit for the final pending update.
 */
export function createDeltaCoalescer(
  { intervalMs = 100 }: DeltaCoalescerOptions = {},
): DeltaCoalescer {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Ink delta intervalMs must be a positive finite number");
  }

  let lastEmittedAt = Number.NEGATIVE_INFINITY;
  let pending: InkDelta | null = null;

  return {
    push(delta) {
      if (!Number.isFinite(delta.at)) {
        throw new RangeError("Ink delta timestamp must be finite");
      }

      const combined = pending === null ? snapshot(delta) : merge(pending, delta);
      if (delta.at - lastEmittedAt >= intervalMs) {
        pending = null;
        lastEmittedAt = delta.at;
        return combined;
      }
      pending = combined;
      return null;
    },
    flush() {
      if (pending === null) return null;
      const last = pending;
      pending = null;
      lastEmittedAt = Math.max(lastEmittedAt, last.at);
      return last;
    },
  };
}

export interface DeixisOptions {
  windowMs?: number;
}

/** Latest timestamp within (atMs - windowMs, atMs]; future deltas never match. */
export function resolveDeixis(
  history: readonly InkDelta[],
  atMs: number,
  { windowMs = 2000 }: DeixisOptions = {},
): InkDelta | null {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError("Deixis windowMs must be a positive finite number");
  }
  if (!Number.isFinite(atMs)) return null;

  let latest: InkDelta | null = null;
  for (const delta of history) {
    if (delta.at > atMs - windowMs && delta.at <= atMs &&
        (latest === null || delta.at >= latest.at)) {
      latest = delta;
    }
  }
  return latest;
}

const DEICTIC_WORD = /(?:^|[^\p{L}\p{N}_])(?:this|that|here|these|those)(?=$|[^\p{L}\p{N}_])/iu;

/** Detect deictic words in an utterance; reject embedded word fragments. */
export function isDeictic(text: string): boolean {
  return DEICTIC_WORD.test(text);
}

function safeTargetId(targetId: string): string {
  // Target IDs are untrusted labels, not extra conversation instructions.
  return targetId
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/["\\]/g, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Never cut a UTF-16 surrogate pair when enforcing the context length cap. */
function clipped(text: string, limit: number): string {
  let result = "";
  for (const char of text) {
    if (result.length + char.length > limit) break;
    result += char;
  }
  return result;
}

/**
 * Plain-text context only: the caller must use a non-spoken/quiet channel.
 * The delta contains only bbox and target identity, never point arrays.
 */
export function quietContextText(delta: InkDelta): string {
  const prefix = "ink: " + delta.shape;
  if (delta.targetId !== undefined) {
    const target = safeTargetId(delta.targetId);
    if (target.length > 0) {
      const intro = prefix + " around target \"";
      return intro + clipped(target, 160 - intro.length - 1) + "\"";
    }
  }

  const [minX, minY, maxX, maxY] = delta.bbox;
  const region = prefix + " in region x " +
    minX.toFixed(2) + "-" + maxX.toFixed(2) +
    ", y " + minY.toFixed(2) + "-" + maxY.toFixed(2);
  return clipped(region, 160);
}
