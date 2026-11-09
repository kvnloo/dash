/**
 * AsyncStorage's Android SQLite backend reads values through a roughly 2 MB
 * CursorWindow. Budget serialized rows to 512 KiB of UTF-8 so JSON wrappers
 * and UTF-16 storage representation stay comfortably below that boundary.
 *
 * Pure helpers: callers own writes, error handling, and any data-loss policy.
 */
export const ROW_BYTE_LIMIT = 512 * 1024;

function checkBudget(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError("Storage byte limit must be a nonnegative safe integer");
  }
}

/** UTF-8 byte count without relying on TextEncoder in React Native/Hermes. */
export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const scalar of text) {
    const codePoint = scalar.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/**
 * Keep a whole UTF-16 code point at a time. The ellipsis costs three UTF-8
 * bytes; at smaller limits an empty string is the only valid truncation.
 * Input that already fits is returned unchanged.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  checkBudget(maxBytes);
  if (utf8Bytes(text) <= maxBytes) return text;
  if (maxBytes < 3) return "";

  let prefix = "";
  let bytes = 0;
  const available = maxBytes - 3;
  for (const scalar of text) {
    const size = utf8Bytes(scalar);
    if (bytes + size > available) break;
    prefix += scalar;
    bytes += size;
  }
  return prefix + "…";
}

type Timed<T> = T & { at: number };

export interface FittedRecord<T> {
  /** Newest first, with deterministic key order when timestamps tie. */
  entries: Record<string, Timed<T>>;
  /** Keys omitted because neither the original nor an allowed shrink fit. */
  dropped: string[];
}

/**
 * Greedily retain newest entries, measuring the full encoded row after each
 * addition (including JSON escaping and keys), not just the payload text.
 *
 * The optional shrink receives the original entry and a maximum payload byte
 * budget. It must return a smaller, valid entry with unchanged `at`, or null
 * when the budget is below its minimum viable payload (or it always refuses).
 * For binary search, viable budgets must form a suffix and their full encoded
 * row sizes must be nondecreasing as the budget grows.
 * We search for the largest budget whose *full encoded row* still fits; a
 * shrinker that refuses or cannot make a safe fit causes that entry to drop.
 * Callers should surface dropped keys rather than silently discarding drafts.
 */
export function fitRecord<T>(
  entries: Record<string, Timed<T>>,
  encode: (row: Record<string, Timed<T>>) => string,
  limit = ROW_BYTE_LIMIT,
  shrink?: (entry: Timed<T>, maxBytes: number) => Timed<T> | null,
): FittedRecord<T> {
  checkBudget(limit);
  if (utf8Bytes(encode({})) > limit) {
    throw new RangeError("Empty encoded row exceeds storage byte limit");
  }

  const sorted = Object.entries(entries).sort(([keyA, a], [keyB, b]) =>
    (b.at - a.at) || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0));
  let selected: Record<string, Timed<T>> = {};
  const dropped: string[] = [];

  for (const [key, entry] of sorted) {
    const candidate = { ...selected, [key]: entry };
    if (utf8Bytes(encode(candidate)) <= limit) {
      selected = candidate;
      continue;
    }

    if (shrink) {
      // The exact JSON/entry overhead is encoder-specific. Binary-searching
      // the shrinker's budget avoids off-by-one overhead and UTF-8 mistakes.
      let lower = 0;
      let upper = limit;
      let best: Timed<T> | null = null;
      while (lower <= upper) {
        const budget = Math.floor((lower + upper) / 2);
        const attempt = shrink(entry, budget);
        if (attempt === null) {
          // No viable payload at this budget; a larger budget may still fit.
          lower = budget + 1;
        } else if (attempt.at === entry.at
          && utf8Bytes(encode({ ...selected, [key]: attempt })) <= limit) {
          best = attempt;
          lower = budget + 1;
        } else {
          upper = budget - 1;
        }
      }
      if (best !== null) {
        selected = { ...selected, [key]: best };
        continue;
      }
    }
    dropped.push(key);
  }

  return { entries: selected, dropped };
}

/** Header belongs at the caller's storage key; rows belong at key#0, key#1… */
export interface EncodedChunkRow {
  header: string;
  rows: Record<string, string>;
}

/** AsyncStorage.getItem may return null for an absent header or part. */
export interface ReadableChunkRow {
  header: string | null | undefined;
  rows: Record<string, string | null | undefined>;
}

/** FNV-1a over UTF-16 code units detects accidental partial/corrupt writes. */
function rowHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Split a value without breaking surrogate pairs. Write all key#n parts
 * before publishing `header` at key; readers verify count, size and checksum.
 * Reusing a key while changing its parts still requires caller-side journal/
 * generation handling for fully atomic crash recovery.
 */
export function chunkRow(value: string, limit = ROW_BYTE_LIMIT, key = "row"): EncodedChunkRow {
  checkBudget(limit);
  if (!key) throw new RangeError("Storage key is required");

  const fragments: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const scalar of value) {
    const scalarBytes = utf8Bytes(scalar);
    if (scalarBytes > limit) {
      throw new RangeError("Storage byte limit is too small for one code point");
    }
    if (currentBytes > 0 && currentBytes + scalarBytes > limit) {
      fragments.push(current);
      current = "";
      currentBytes = 0;
    }
    current += scalar;
    currentBytes += scalarBytes;
  }
  if (currentBytes > 0) fragments.push(current);

  const header = JSON.stringify({
    v: 1,
    count: fragments.length,
    bytes: utf8Bytes(value),
    hash: rowHash(value),
  }) ?? "";
  if (utf8Bytes(header) > limit) {
    throw new RangeError("Storage byte limit is too small for chunk header");
  }

  const rows: Record<string, string> = {};
  for (let index = 0; index < fragments.length; index++) {
    rows[`${key}#${index}`] = fragments[index] ?? "";
  }
  return { header, rows };
}

/**
 * Reassemble only a complete and intact version-1 chunk set.
 * Missing/altered parts, corrupt headers, and inconsistent byte counts fail
 * closed; callers must not substitute partial text for the original value.
 */
export function joinChunks(parts: ReadableChunkRow, key = "row"): string | null {
  if (!key || typeof parts.header !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(parts.header);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    || !("v" in parsed) || parsed.v !== 1
    || !("count" in parsed) || typeof parsed.count !== "number"
    || !Number.isSafeInteger(parsed.count) || parsed.count < 0
    || !("bytes" in parsed) || typeof parsed.bytes !== "number"
    || !Number.isSafeInteger(parsed.bytes) || parsed.bytes < 0
    || !("hash" in parsed) || typeof parsed.hash !== "string"
    || !/^[0-9a-f]{8}$/.test(parsed.hash)) {
    return null;
  }
  if (parsed.count > Object.keys(parts.rows).length) return null;

  const chunks: string[] = [];
  for (let index = 0; index < parsed.count; index++) {
    const partKey = `${key}#${index}`;
    if (!Object.prototype.hasOwnProperty.call(parts.rows, partKey)) return null;
    const piece = parts.rows[partKey];
    if (typeof piece !== "string" || piece.length === 0) return null;
    chunks.push(piece);
  }
  const restored = chunks.join("");
  return utf8Bytes(restored) === parsed.bytes && rowHash(restored) === parsed.hash
    ? restored
    : null;
}
