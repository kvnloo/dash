/**
 * Versioned, IO-free per-stage latency baseline rules for the Flow surface.
 * Persisting candidate files, evaluating absolute targets, and recording run
 * provenance belong to the caller, not to this module.
 */
export type BuildProfile = "dev" | "release";

export type BaselineRow = Readonly<{
  n: number;
  p50Ms: number;
  p95Ms: number;
}>;

export type LatencyBaseline = Readonly<{
  version: 1;
  device: string;
  buildProfile: BuildProfile;
  sha: string;
  capturedAt: string;
  rows: Readonly<Record<string, BaselineRow>>;
}>;

/** Structural shape emitted by the sibling budget evaluator; no dependency. */
export type CurrentLatencyRow = Readonly<{
  id: string;
  n: number;
  p50: number | null;
  p95: number | null;
}>;

export type BaselineComparison = Readonly<{
  id: string;
  status: "ok" | "regressed" | "improved" | "new" | "missing";
  /** Percentage relative to baseline p95; null if undefined/unmeasured. */
  deltaPct: number | null;
}>;

export type RerunAttempt = Readonly<{
  attempt: number;
  verdict: "pass" | "fail";
}>;

export type RerunDecision = Readonly<{ allowed: boolean; reason: string }>;
export type BaselineRefusal = Readonly<{ refused: string[] }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isIsoDateTime(value: string): boolean {
  // Require an ISO 8601 calendar datetime with an explicit time zone.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  // Check calendar day separately: Date.parse normalizes e.g. February 30.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Validate an untrusted, JSON-shaped v1 baseline without type assertions.
 * Returns a canonical typed copy, or a descriptive error string.
 */
export function parseBaseline(raw: unknown): LatencyBaseline | string {
  if (!isRecord(raw)) return "baseline must be an object";
  if (raw.version !== 1) return "unsupported baseline version (expected 1)";
  if (typeof raw.device !== "string" ||
      raw.device.length < 1 || raw.device.length > 32 ||
      raw.device.trim() !== raw.device ||
      !/[A-Za-z0-9]/.test(raw.device) ||
      !/^[A-Za-z0-9 +\-]+$/.test(raw.device) ||
      /\/|:|\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(raw.device)) {
    return "device must be a model label (1-32 letters, digits, spaces, + or -), not an address/path";
  }
  if (raw.buildProfile !== "dev" && raw.buildProfile !== "release") {
    return "buildProfile must be dev or release";
  }
  if (typeof raw.sha !== "string" || !/^[0-9a-fA-F]{7,40}$/.test(raw.sha)) {
    return "sha must contain 7-40 hexadecimal characters";
  }
  if (typeof raw.capturedAt !== "string" || !isIsoDateTime(raw.capturedAt)) {
    return "capturedAt must be an ISO 8601 datetime with a time zone";
  }
  if (!isRecord(raw.rows)) return "rows must be an object keyed by stage id";

  const entries: Array<[string, BaselineRow]> = [];
  for (const [id, value] of Object.entries(raw.rows)) {
    if (!id.trim() || id !== id.trim()) return "invalid baseline stage id";
    if (!isRecord(value) || !isCount(value.n) ||
        !isMs(value.p50Ms) || !isMs(value.p95Ms) ||
        value.p50Ms > value.p95Ms) {
      return "invalid baseline samples for stage " + id;
    }
    entries.push([id, { n: value.n, p50Ms: value.p50Ms, p95Ms: value.p95Ms }]);
  }

  return {
    version: 1,
    device: raw.device,
    buildProfile: raw.buildProfile,
    sha: raw.sha,
    capturedAt: raw.capturedAt,
    rows: Object.fromEntries(entries),
  };
}

function validateCurrent(rows: readonly CurrentLatencyRow[]): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id.trim() || row.id !== row.id.trim()) {
      throw new TypeError("current row has an invalid stage id");
    }
    if (ids.has(row.id)) throw new TypeError("duplicate current stage id: " + row.id);
    ids.add(row.id);
    if (!Number.isSafeInteger(row.n) || row.n < 0) {
      throw new TypeError("invalid current sample count for " + row.id);
    }
    if ((row.p50 !== null && !isMs(row.p50)) ||
        (row.p95 !== null && !isMs(row.p95)) ||
        (row.p50 !== null && row.p95 !== null && row.p50 > row.p95)) {
      throw new TypeError("invalid current latency for " + row.id);
    }
  }
}

/**
 * Compare p95s only within the same build profile. Equality at the threshold
 * is OK. Unmeasured or absent stages are "missing", never accidental passes.
 */
export function compareToBaseline(
  baseline: LatencyBaseline,
  current: readonly CurrentLatencyRow[],
  options: Readonly<{ buildProfile: BuildProfile; regressionPct?: number }>,
): BaselineComparison[] {
  const checked = parseBaseline(baseline);
  if (typeof checked === "string") throw new TypeError(checked);
  if (options.buildProfile !== checked.buildProfile) {
    throw new Error("baseline buildProfile mismatch: dev and release cannot be compared");
  }
  const regressionPct = options.regressionPct ?? 10;
  if (!Number.isFinite(regressionPct) || regressionPct < 0 || regressionPct > 100) {
    throw new RangeError("regressionPct must be finite and between 0 and 100");
  }
  validateCurrent(current);

  const seen = new Set<string>();
  const result: BaselineComparison[] = [];
  for (const row of current) {
    seen.add(row.id);
    const base = Object.hasOwn(checked.rows, row.id) ? checked.rows[row.id] : undefined;
    if (row.n === 0 || row.p95 === null) {
      result.push({ id: row.id, status: "missing", deltaPct: null });
    } else if (!base) {
      result.push({ id: row.id, status: "new", deltaPct: null });
    } else {
      const limit = base.p95Ms * (1 + regressionPct / 100);
      const floor = base.p95Ms * (1 - regressionPct / 100);
      const status: BaselineComparison["status"] =
        row.p95 > limit ? "regressed" :
        row.p95 < floor ? "improved" : "ok";
      // A zero baseline has no defined percentage; keep the outcome useful.
      const deltaPct = base.p95Ms === 0
        ? (row.p95 === 0 ? 0 : null)
        : ((row.p95 - base.p95Ms) / base.p95Ms) * 100;
      result.push({ id: row.id, status, deltaPct });
    }
  }
  for (const id of Object.keys(checked.rows)) {
    if (!seen.has(id)) result.push({ id, status: "missing", deltaPct: null });
  }
  return result;
}

/**
 * Retry failed executions at most twice. Attempts are consecutive, starting
 * at 0 or 1; missing history and any earlier pass block retries fail-closed.
 */
export function rerunDecision(history: readonly RerunAttempt[]): RerunDecision {
  const first = history[0];
  if (!first) return { allowed: false, reason: "no initial attempt recorded" };
  if (first.attempt !== 0 && first.attempt !== 1) {
    return { allowed: false, reason: "history must begin with attempt 0 or 1" };
  }
  let expected = first.attempt;
  for (const item of history) {
    if (!Number.isSafeInteger(item.attempt) || item.attempt !== expected ||
        (item.verdict !== "pass" && item.verdict !== "fail")) {
      return { allowed: false, reason: "attempt history is invalid or incomplete" };
    }
    expected++;
  }
  if (history.some((item) => item.verdict === "pass")) {
    return { allowed: false, reason: "passing attempts must never be rerun" };
  }
  const reruns = history.length - 1;
  if (reruns >= 2) {
    return { allowed: false, reason: "two reruns have already been used" };
  }
  return { allowed: true, reason: "latest attempt failed; rerun " + (reruns + 1) + " of 2 permitted" };
}

/**
 * Construct a candidate baseline without mutating either input.
 * Refuse incomplete coverage, sparse stages, non-finite readings and
 * regressions. The caller must stamp fresh sha/capturedAt before persistence.
 */
export function nextBaseline(
  baseline: LatencyBaseline,
  current: readonly CurrentLatencyRow[],
  options: Readonly<{ minN?: number }> = {},
): LatencyBaseline | BaselineRefusal {
  const minN = options.minN ?? 100;
  if (!Number.isSafeInteger(minN) || minN <= 0) {
    return { refused: ["minN must be a positive integer"] };
  }
  let comparisons: BaselineComparison[];
  try {
    comparisons = compareToBaseline(baseline, current, { buildProfile: baseline.buildProfile });
  } catch (error) {
    return { refused: [error instanceof Error ? error.message : "invalid baseline/current rows"] };
  }

  const refused: string[] = [];
  if (current.length === 0) refused.push("no current samples");
  for (const entry of comparisons) {
    if (entry.status === "regressed") {
      refused.push(entry.id + ": p95 regression exceeds 10%");
    } else if (entry.status === "missing") {
      refused.push(entry.id + ": stage/latency is missing");
    }
  }

  const entries: Array<[string, BaselineRow]> = [];
  for (const row of current) {
    if (row.n < minN) refused.push(row.id + ": sample count " + row.n + " below " + minN);
    if (row.p50 === null || row.p95 === null) {
      refused.push(row.id + ": p50 and p95 must both be measured");
      continue;
    }
    entries.push([row.id, { n: row.n, p50Ms: row.p50, p95Ms: row.p95 }]);
  }
  if (refused.length > 0) return { refused };
  return { ...baseline, rows: Object.fromEntries(entries) };
}
