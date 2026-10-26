// Human posture (CIRCADIAN-SPEC WP1a): the owner's day phase from static anchors.
// TypeScript twin of z0intelligence `src/z0int/human_posture.py`. Clock-only here:
// the activity/wearable ladder runs on the host (circadiand) and arrives as a
// finished HumanState through GET /posture. Pure (law C4): no clock, storage,
// network or randomness. Every timestamp is UTC "YYYY-MM-DDTHH:MM:SSZ", every
// number an integer, and `canonical` sorts keys, so the golden fixtures in
// shared/fixtures/human-posture/ compare byte for byte with Python.
// Privacy (C8, R4): a HumanState holds times of day (health-derived). It must not
// leave the owner's host; `publicView` in interaction-policy.ts is the allowlist.

export type Phase = "SLEEP" | "INERTIA" | "PEAK" | "DIP" | "SECOND" | "WIND_DOWN" | "PRE_SLEEP" | "DISENGAGED";
export type Quality = "measured" | "proxy" | "default";
export const PHASES: readonly Phase[] = ["SLEEP", "INERTIA", "PEAK", "DIP", "SECOND", "WIND_DOWN", "PRE_SLEEP", "DISENGAGED"];
export const QUIET: ReadonlySet<Phase> = new Set<Phase>(["WIND_DOWN", "PRE_SLEEP", "SLEEP", "DISENGAGED"]);
export const DAY: ReadonlySet<Phase> = new Set<Phase>(["INERTIA", "PEAK", "DIP", "SECOND"]);

export interface PostureConfig {
  tz: string;
  wakeTarget: string;   // "HH:MM" local
  bedTarget: string;
  nightModeAt: string;
  criticalOptIn: boolean;
  enforce: string;      // "quiet_only" | "none"
  arm: string;
}
// SYNTHETIC neutral defaults. The owner's real anchors are private (R4): the bridge reads
// them from the host's circadian config, never from this repo.
export const DEFAULT_POSTURE_CONFIG: PostureConfig = {
  tz: "America/New_York", wakeTarget: "07:30", bedTarget: "00:30", nightModeAt: "22:00",
  criticalOptIn: false, enforce: "quiet_only", arm: "B",
};

export interface HumanState {
  schema: "dash.human_state/v1";
  anchors: { wakeAt: string; freezeAt: string; bedTarget: string; nightModeAt: string; wakeTarget: string };
  sleepOnsetLast: string | null;
  quality: Quality;
  wakeSource: string;
  readiness: "low" | "normal" | "high" | "unknown";
  activityAvailable: boolean;
  lastActivityAt: string | null;
  disengagedUntil: string | null;
  deliveredThisHour: number;
  interruptsThisBlock: number;
  hardBlocksUsed: number;
  arm: string;
  enforce: string;
  criticalOptIn: boolean;
}

export interface ClockFacts {
  doneAt?: string | null;
  counters?: { hourKey?: string; delivered?: number; blockStart?: string; interrupts?: number };
}

// §2.6 phase lengths in minutes from wake (PROVISIONAL, R5)
export const INERTIA_MIN = 45, PEAK_END_MIN = 360, DIP_END_MIN = 480, PRE_SLEEP_MIN = 60;
export const FREEZE_BEFORE_BED_MIN = 180, SLEEP_AFTER_ACTIVITY_MIN = 30, DAY_PIVOT_HOUR = 4;
const MIN = 60_000;

export function parseTs(value: string): number {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error(`timestamp needs an explicit offset: ${String(value)}`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`bad timestamp ${value}`);
  return Math.floor(ms / 1000) * 1000;
}
export function fmt(ms: number): string { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"); }
export function minutesBetween(a: number, b: number): number { return Math.floor((b - a) / MIN); }

export function canonical(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v: unknown): unknown {
  if (typeof v === "number" && !Number.isInteger(v)) throw new TypeError("canonical form has no floats");
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, inner] of Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) out[k] = sortKeys(inner);
    return out;
  }
  return v;
}

// ---- time zone helpers (Intl only; matches Python zoneinfo with fold=0)
interface Wall { y: number; m: number; d: number; h: number; mi: number }
const formatters = new Map<string, Intl.DateTimeFormat>();
const walls = new Map<string, Wall>(); // memo: Intl formatting is the slow part; results never change
function wall(ms: number, tz: string): Wall {
  const key = `${tz}|${Math.floor(ms / MIN)}`;
  const hit = walls.get(key);
  if (hit) return hit;
  const w = wallUncached(ms, tz);
  if (walls.size > 4096) walls.clear();
  walls.set(key, w);
  return w;
}
function wallUncached(ms: number, tz: string): Wall {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    formatters.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(ms))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year ?? 0, m: p.month ?? 0, d: p.day ?? 0, h: p.hour ?? 0, mi: p.minute ?? 0 };
}
function offsetMin(ms: number, tz: string): number {
  const w = wall(ms, tz);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(ms / MIN) * MIN) / MIN);
}
function hhmm(clock: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
  const h = Number(m?.[1]), mi = Number(m?.[2]);
  if (!m || h > 23 || mi > 59) throw new Error(`bad clock time ${clock}`);
  return [h, mi];
}
export interface Ymd { y: number; m: number; d: number }
export function addDays(day: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
/** Local wall time on a local date -> UTC ms. Ambiguous: first occurrence; gap: pre-transition offset. */
export function localAt(day: Ymd, clock: string, tz: string): number {
  const [h, mi] = hhmm(clock);
  const guess = Date.UTC(day.y, day.m - 1, day.d, h, mi);
  const before = offsetMin(guess - 12 * 60 * MIN, tz), after = offsetMin(guess + 12 * 60 * MIN, tz);
  const valid = [...new Set([before, after])].map((o) => guess - o * MIN).filter((t) => {
    const w = wall(t, tz);
    return w.y === day.y && w.m === day.m && w.d === day.d && w.h === h && w.mi === mi;
  });
  return valid.length ? Math.min(...valid) : guess - before * MIN;
}
function localDate(ms: number, tz: string): Ymd { const w = wall(ms, tz); return { y: w.y, m: w.m, d: w.d }; }
function ownerDate(wake: number, tz: string): Ymd {
  const w = wall(wake, tz);
  const day = { y: w.y, m: w.m, d: w.d };
  return w.h >= DAY_PIVOT_HOUR ? day : addDays(day, -1);
}
function clockOnOwnerDay(owner: Ymd, clock: string, tz: string): number {
  return localAt(hhmm(clock)[0] < 12 ? addDays(owner, 1) : owner, clock, tz);
}

/** Clock-only HumanState (quality "default"): what the bridge uses when posture.json is missing or stale. */
export function evaluateHumanPosture(facts: ClockFacts, nowIso: string, config: Partial<PostureConfig> = {}): HumanState {
  const cfg = { ...DEFAULT_POSTURE_CONFIG, ...config };
  const now = parseTs(nowIso);
  const today = localDate(now, cfg.tz);
  let wake = localAt(today, cfg.wakeTarget, cfg.tz);
  if (wake > now) wake = localAt(addDays(today, -1), cfg.wakeTarget, cfg.tz);
  const od = ownerDate(wake, cfg.tz);
  const wakeTargetNext = localAt(addDays(od, 1), cfg.wakeTarget, cfg.tz);
  const bed = clockOnOwnerDay(od, cfg.bedTarget, cfg.tz);
  const nightMode = clockOnOwnerDay(od, cfg.nightModeAt, cfg.tz);
  const freeze = Math.min(nightMode, bed - FREEZE_BEFORE_BED_MIN * MIN);
  let disengaged: string | null = null;
  if (facts.doneAt) {
    const doneAt = parseTs(facts.doneAt);
    if (wake <= doneAt && doneAt <= now && now < wakeTargetNext) disengaged = fmt(wakeTargetNext);
  }
  const c = facts.counters ?? {};
  const delivered = c.hourKey === fmt(now).slice(0, 13) ? Math.trunc(c.delivered ?? 0) : 0;
  const interrupts = c.blockStart === fmt(wake + INERTIA_MIN * MIN) ? Math.trunc(c.interrupts ?? 0) : 0;
  return {
    schema: "dash.human_state/v1",
    anchors: { wakeAt: fmt(wake), freezeAt: fmt(freeze), bedTarget: fmt(bed), nightModeAt: fmt(nightMode), wakeTarget: fmt(wakeTargetNext) },
    sleepOnsetLast: null,
    quality: "default",
    wakeSource: "clock",
    readiness: "unknown",
    activityAvailable: false,
    lastActivityAt: null,
    disengagedUntil: disengaged,
    deliveredThisHour: Math.max(0, delivered),
    interruptsThisBlock: Math.max(0, interrupts),
    hardBlocksUsed: 0,
    arm: String(cfg.arm),
    enforce: String(cfg.enforce),
    criticalOptIn: Boolean(cfg.criticalOptIn),
  };
}
