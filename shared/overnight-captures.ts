/**
 * Capture-only bedtime queue. Entries here are local notes, never agent turns.
 * The caller owns persistence and provides both the clock and ID generator.
 */
export const MAX_OVERNIGHT_CAPTURES = 200;
export const MAX_CAPTURE_TEXT_LENGTH = 4_000;
export const CAPTURE_DEDUPE_MS = 2 * 60 * 1_000;

export type CaptureStatus = "queued" | "planned" | "dismissed";

export interface Capture {
  readonly id: string;
  readonly text: string;
  readonly conversationId?: string;
  readonly capturedAt: number;
  readonly attachments: number;
  readonly status: CaptureStatus;
}

export interface CaptureInput {
  readonly text: string;
  readonly conversationId?: string;
  /** Number of attachments noted, not a transport payload. */
  readonly attachments?: number;
}

export interface MorningCaptureGroup {
  readonly conversationId?: string;
  readonly captures: readonly Capture[];
}

function validId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && !/\s/.test(value);
}

function validCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function trimmedCaptureText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_CAPTURE_TEXT_LENGTH) return trimmed;

  // Leave room for an ellipsis without cutting a UTF-16 surrogate pair.
  let prefix = trimmed.slice(0, MAX_CAPTURE_TEXT_LENGTH - 1);
  const finalUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalUnit >= 0xd800 && finalUnit <= 0xdbff) {
    prefix = prefix.slice(0, -1);
  }
  return prefix + "…";
}

/** Prioritize discarding dismissed notes, then queued, then planned as a last resort. */
function evictionIndex(queue: readonly Capture[]): number {
  let chosen = 0;
  let priority = Infinity;
  let timestamp = Infinity;

  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (!item) continue;
    const rank = item.status === "dismissed" ? 0 : item.status === "queued" ? 1 : 2;
    if (rank < priority || (rank === priority && item.capturedAt < timestamp)) {
      chosen = index;
      priority = rank;
      timestamp = item.capturedAt;
    }
  }
  return chosen;
}

function withinLimit(items: Capture[]): Capture[] {
  while (items.length > MAX_OVERNIGHT_CAPTURES) {
    items.splice(evictionIndex(items), 1);
  }
  return items;
}

/**
 * Return a new queue with a capture, or the original queue when rejected.
 * Deduplication compares the stored (trimmed/bounded) text over the previous
 * two minutes, including notes subsequently planned or dismissed.
 */
export function addCapture(
  queue: readonly Capture[],
  input: CaptureInput,
  now: number,
  makeId: () => string,
): readonly Capture[] {
  if (typeof input.text !== "string" || !validTime(now)) return queue;
  const text = trimmedCaptureText(input.text);
  const attachments = input.attachments ?? 0;
  if (!text || !validCount(attachments)) return queue;
  if (input.conversationId !== undefined && !validId(input.conversationId)) return queue;

  if (queue.some(item => item.text === text
    && now >= item.capturedAt
    && now - item.capturedAt <= CAPTURE_DEDUPE_MS)) return queue;

  const id = makeId();
  if (!validId(id) || queue.some(item => item.id === id)) return queue;

  const capture: Capture = {
    id,
    text,
    ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
    capturedAt: now,
    attachments,
    status: "queued",
  };
  return withinLimit([...queue, capture]);
}

/**
 * Oldest queued captures first, grouped by first-seen conversation.
 * Unassigned captures share an unlabeled group (conversationId omitted).
 */
export function morningList(queue: readonly Capture[], since: number): MorningCaptureGroup[] {
  if (!validTime(since)) return [];
  const ordered = queue
    .filter(item => item.status === "queued" && item.capturedAt >= since)
    .sort((left, right) => left.capturedAt - right.capturedAt);
  const groups = new Map<string | undefined, Capture[]>();

  for (const item of ordered) {
    const group = groups.get(item.conversationId);
    if (group) group.push(item);
    else groups.set(item.conversationId, [item]);
  }

  return [...groups].map(([conversationId, captures]) =>
    conversationId === undefined ? { captures } : { conversationId, captures });
}

/** Only queued notes may become planned; dismissed notes are never resurrected. */
export function markPlanned(queue: readonly Capture[], ids: readonly string[]): readonly Capture[] {
  if (ids.length === 0) return queue;
  const selected = new Set(ids);
  let changed = false;
  const next = queue.map(item => {
    if (item.status !== "queued" || !selected.has(item.id)) return item;
    changed = true;
    return { ...item, status: "planned" as const };
  });
  return changed ? next : queue;
}

/** Dismiss a queued or planned capture without mutating the input. */
export function dismiss(queue: readonly Capture[], id: string): readonly Capture[] {
  if (!queue.some(item => item.id === id && item.status !== "dismissed")) return queue;
  return queue.map(item => item.id === id ? { ...item, status: "dismissed" as const } : item);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCapture(raw: unknown): Capture | null {
  if (!isRecord(raw)
    || !validId(raw.id)
    || typeof raw.text !== "string"
    || raw.text.length === 0
    || raw.text.length > MAX_CAPTURE_TEXT_LENGTH
    || raw.text.trim() !== raw.text
    || !validTime(raw.capturedAt)
    || !validCount(raw.attachments)
    || (raw.conversationId !== undefined && !validId(raw.conversationId))
    || (raw.status !== "queued" && raw.status !== "planned" && raw.status !== "dismissed")) {
    return null;
  }

  return {
    id: raw.id,
    text: raw.text,
    ...(raw.conversationId === undefined ? {} : { conversationId: raw.conversationId }),
    capturedAt: raw.capturedAt,
    attachments: raw.attachments,
    status: raw.status,
  };
}

/**
 * Parse untrusted persisted/bridge rows independently; malformed entries never
 * poison valid neighbors. Output is uniquely keyed and bounded to 200 notes.
 * A read cap also prevents enormous hostile arrays from blocking the bridge.
 */
export function parseCaptures(raw: unknown): Capture[] {
  try {
    if (!Array.isArray(raw)) return [];
    const parsed: Capture[] = [];
    const seen = new Set<string>();
    const limit = Math.min(raw.length, MAX_OVERNIGHT_CAPTURES * 50);

    for (let index = 0; index < limit; index++) {
      let item: Capture | null;
      try {
        item = parseCapture(raw[index]);
      } catch {
        // A proxy or getter can throw; skip only this untrusted row.
        continue;
      }
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      parsed.push(item);
      if (parsed.length > MAX_OVERNIGHT_CAPTURES) {
        parsed.splice(evictionIndex(parsed), 1);
      }
    }
    return parsed;
  } catch {
    // Also covers revoked array proxies and hostile array length traps.
    return [];
  }
}
