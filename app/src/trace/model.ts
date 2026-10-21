/**
 * Agent trace snapshot (schema dash.trace.snapshot/v1, written by scripts/trace-snapshot.py)
 * and the pure math behind the native trace gestures. Times are seconds from `t0`.
 * Functions marked 'worklet' run on the UI thread inside gesture callbacks and in bun tests.
 */

export type WorkerStatus = "running" | "completed" | "interrupted";
export type RowGroup = "live" | "recent" | "earlier";
export type Outcome = "control" | "ring" | "debt" | "burn";

export type TraceWorker = {
  id: string;
  model: string;
  status: WorkerStatus;
  s: number;
  e: number;
  calls: number;
  errors: number;
  asks: string[];
  resumed: boolean;
  isResume: boolean;
  /** Tool calls per `bucketS` from the worker's start. */
  density: number[];
  /** Failed calls, minute-rounded seconds. */
  fails: number[];
  stalls: [number, number][];
};

export type TraceRow = { key: string; project: string; goal: string; group: RowGroup; workers: TraceWorker[] };
export type TraceAction = { id: string; outcome: Outcome; outcomeLabel: string; title: string; why: string };
export type TraceStats = {
  workers: number; live: number; cut: number; resumed: number; asks: number;
  calls: number; errors: number; claudeUsed: number; claudeResetH: number; codexUsed: number;
};
export type TraceSnapshot = {
  t0: string;
  now: number;
  bucketS: number;
  read: string;
  actions: TraceAction[];
  stats: TraceStats;
  owner: number[];
  rows: TraceRow[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, at: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`trace snapshot: ${at} is not a number`);
  return v;
};
const str = (v: unknown, at: string): string => {
  if (typeof v !== "string") throw new Error(`trace snapshot: ${at} is not a string`);
  return v;
};
const arr = (v: unknown, at: string): unknown[] => {
  if (!Array.isArray(v)) throw new Error(`trace snapshot: ${at} is not a list`);
  return v;
};
const oneOf = <T extends string>(v: unknown, opts: readonly T[], at: string): T => {
  const found = opts.find((o) => o === v);
  if (found === undefined) throw new Error(`trace snapshot: ${at} is not one of ${opts.join("/")}`);
  return found;
};
const obj = (v: unknown, at: string): Record<string, unknown> => {
  if (!isObj(v)) throw new Error(`trace snapshot: ${at} is not an object`);
  return v;
};

function parseWorker(v: unknown, at: string): TraceWorker {
  const w = obj(v, at);
  return {
    id: str(w.id, `${at}.id`),
    model: str(w.model, `${at}.model`),
    status: oneOf(w.status, ["running", "completed", "interrupted"] as const, `${at}.status`),
    s: num(w.s, `${at}.s`),
    e: num(w.e, `${at}.e`),
    calls: num(w.calls, `${at}.calls`),
    errors: num(w.errors, `${at}.errors`),
    asks: arr(w.asks, `${at}.asks`).map((a, i) => str(a, `${at}.asks[${i}]`)),
    resumed: w.resumed === true,
    isResume: w.isResume === true,
    density: arr(w.density, `${at}.density`).map((d, i) => num(d, `${at}.density[${i}]`)),
    fails: arr(w.fails, `${at}.fails`).map((d, i) => num(d, `${at}.fails[${i}]`)),
    stalls: arr(w.stalls, `${at}.stalls`).map((p, i) => {
      const pair = arr(p, `${at}.stalls[${i}]`);
      return [num(pair[0], `${at}.stalls[${i}][0]`), num(pair[1], `${at}.stalls[${i}][1]`)];
    }),
  };
}

/** Parse untrusted JSON (bundled now, the bridge later) into a snapshot. Throws on shape errors. */
export function parseTraceSnapshot(raw: unknown): TraceSnapshot {
  const d = obj(raw, "root");
  if (d.schema !== "dash.trace.snapshot/v1") throw new Error("trace snapshot: unknown schema");
  const st = obj(d.stats, "stats");
  return {
    t0: str(d.t0, "t0"),
    now: num(d.now, "now"),
    bucketS: num(d.bucketS, "bucketS"),
    read: str(d.read, "read"),
    actions: arr(d.actions, "actions").map((v, i) => {
      const a = obj(v, `actions[${i}]`);
      return {
        id: str(a.id, `actions[${i}].id`),
        outcome: oneOf(a.outcome, ["control", "ring", "debt", "burn"] as const, `actions[${i}].outcome`),
        outcomeLabel: str(a.outcomeLabel, `actions[${i}].outcomeLabel`),
        title: str(a.title, `actions[${i}].title`),
        why: str(a.why, `actions[${i}].why`),
      };
    }),
    stats: {
      workers: num(st.workers, "stats.workers"), live: num(st.live, "stats.live"), cut: num(st.cut, "stats.cut"),
      resumed: num(st.resumed, "stats.resumed"), asks: num(st.asks, "stats.asks"), calls: num(st.calls, "stats.calls"),
      errors: num(st.errors, "stats.errors"), claudeUsed: num(st.claudeUsed, "stats.claudeUsed"),
      claudeResetH: num(st.claudeResetH, "stats.claudeResetH"), codexUsed: num(st.codexUsed, "stats.codexUsed"),
    },
    owner: arr(d.owner, "owner").map((v, i) => num(v, `owner[${i}]`)),
    rows: arr(d.rows, "rows").map((v, i) => {
      const r = obj(v, `rows[${i}]`);
      return {
        key: str(r.key, `rows[${i}].key`),
        project: str(r.project, `rows[${i}].project`),
        goal: str(r.goal, `rows[${i}].goal`),
        group: oneOf(r.group, ["live", "recent", "earlier"] as const, `rows[${i}].group`),
        workers: arr(r.workers, `rows[${i}].workers`).map((w, j) => parseWorker(w, `rows[${i}].workers[${j}]`)),
      };
    }),
  };
}

export const GROUP_LABEL: Record<RowGroup, string> = { live: "Live", recent: "Last 3 hours", earlier: "Earlier today" };

export type RowSummary = { workers: number; cut: number; asks: number; live: boolean; errors: number; calls: number; s: number; e: number };
export function summarizeRow(row: TraceRow): RowSummary {
  let cut = 0, asks = 0, errors = 0, calls = 0, s = Infinity, e = -Infinity, live = false;
  for (const w of row.workers) {
    if (w.status === "interrupted") cut += 1;
    if (w.status === "running") live = true;
    if (w.asks.length) asks += 1;
    errors += w.errors;
    calls += w.calls;
    s = Math.min(s, w.s);
    e = Math.max(e, w.e);
  }
  return { workers: row.workers.length, cut, asks, live, errors, calls, s, e };
}

/** Owner-facing words for needs_owner classes (export_trace.py). */
export const ASK_WORD: Record<string, string> = { "review-pr": "PR review", device: "device test", approve: "approval", blocked: "blocked", verify: "verification", credentials: "credentials" };
export const askWord = (k: string): string => ASK_WORD[k] ?? k.replace(/[_-]/g, " ");

export function rowMeta(sum: RowSummary): string {
  const parts = [`${sum.workers} worker${sum.workers === 1 ? "" : "s"}`];
  if (sum.cut) parts.push(`${sum.cut} cut`);
  if (sum.asks) parts.push(`${sum.asks} ask${sum.asks === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** Sub-lanes so overlapping workers in one row never draw on top of each other. */
export function packLanes(workers: TraceWorker[]): number[] {
  const ends: number[] = [];
  return workers.map((w) => {
    let lane = ends.findIndex((end) => end <= w.s);
    if (lane < 0) { lane = ends.length; ends.push(w.e); } else ends[lane] = w.e;
    return lane;
  });
}

export function activeAt(rows: TraceRow[], t: number): number {
  let n = 0;
  for (const r of rows) for (const w of r.workers) if (w.s <= t && w.e > t) n += 1;
  return n;
}

/** Active workers sampled every `stepS` from 0 to `now`. */
export function activeSeries(rows: TraceRow[], now: number, stepS = 900): number[] {
  const out: number[] = [];
  for (let t = 0; t < now; t += stepS) out.push(activeAt(rows, t));
  out.push(activeAt(rows, now - 1));
  return out;
}

export function clock(t0: string, t: number): string {
  const base = new Date(`${t0}Z`).getTime();
  const d = new Date(base + t * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function dur(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/* ---------- gesture math (UI thread) ---------- */

/** Zoom is relative to "fit": 1× shows the whole span, 24× shows span/24. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 24;
/** Opening view: this many hours across the plot, ending at "now" (the prototype showed ~2.5–3 h). */
export const OPEN_HOURS = 3;

export function initialZoom(spanS: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, spanS / (OPEN_HOURS * 3600)));
}

/** Translate that puts time `t` at `frac` of the viewport. Clamped to bounds. */
export function txForTime(t: number, spanS: number, viewW: number, zoom: number, frac: number): number {
  const contentW = viewW * zoom;
  const [lo, hi] = panBounds(contentW, viewW);
  return Math.min(hi, Math.max(lo, viewW * frac - (t / spanS) * contentW));
}

/** Time under viewport x. */
export function timeAtX(x: number, tx: number, viewW: number, zoom: number, spanS: number): number {
  "worklet";
  return ((x - tx) / (viewW * zoom)) * spanS;
}

/** Hour-label step that keeps labels at least ~44 px apart. */
export function hourStep(viewW: number, zoom: number, spanS: number): number {
  "worklet";
  const pxPerHour = (viewW * zoom * 3600) / spanS;
  if (pxPerHour >= 44) return 1;
  if (pxPerHour >= 22) return 2;
  if (pxPerHour >= 11) return 4;
  return 6;
}

/** Rubber band past a bound: resistance grows with distance, never exceeding `dim * 0.55`. */
export function rubberband(over: number, dim: number): number {
  "worklet";
  const c = 0.55;
  const sign = over < 0 ? -1 : 1;
  const x = Math.abs(over);
  return sign * (1 - 1 / ((x * c) / dim + 1)) * dim;
}

/** Translate bounds for content of width `contentW` in a viewport `viewW`: [min, 0]. */
export function panBounds(contentW: number, viewW: number): [number, number] {
  "worklet";
  return [Math.min(0, viewW - contentW), 0];
}

/** Apply rubber band if `x` is outside [lo, hi]. */
export function softClamp(x: number, lo: number, hi: number, dim: number): number {
  "worklet";
  if (x < lo) return lo + rubberband(x - lo, dim);
  if (x > hi) return hi + rubberband(x - hi, dim);
  return x;
}

export function softZoom(z: number): number {
  "worklet";
  if (z < ZOOM_MIN) return ZOOM_MIN * Math.pow(z / ZOOM_MIN, 0.35);
  if (z > ZOOM_MAX) return ZOOM_MAX * Math.pow(z / ZOOM_MAX, 0.35);
  return z;
}

/** Keep the time under the focal point fixed while zooming from z0/tx0 to z1. */
export function zoomAround(focalX: number, tx0: number, z0: number, z1: number): number {
  "worklet";
  return focalX - (focalX - tx0) * (z1 / z0);
}

/** Scrub tick index: one tick per `stepS` seconds; a change fires a haptic. */
export function scrubTick(t: number, stepS: number): number {
  "worklet";
  return Math.floor(t / stepS);
}

export type SwipeDecision = "do" | "not_now" | null;
/** Handedness-normalized: Do past ~40% of the width, or a fling over 800 px/s in that direction. */
export function swipeDecision(dx: number, vx: number, width: number): SwipeDecision {
  "worklet";
  const t = width * 0.4;
  if (dx > t || (vx > 800 && dx > 24)) return "do";
  if (dx < -t || (vx < -800 && dx < -24)) return "not_now";
  return null;
}
