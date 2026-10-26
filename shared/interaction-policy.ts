// Interaction policy (CIRCADIAN-SPEC §4, WP1a): what Dash may ask of the owner now.
// TypeScript twin of z0intelligence `human_posture.policy/route/gate`; the Bend
// twin (`bend/circadian/gate.bend`) proves the laws over `gate`. Pure (C4).
import {
  DAY, DIP_END_MIN, INERTIA_MIN, PEAK_END_MIN, PRE_SLEEP_MIN, QUIET, SLEEP_AFTER_ACTIVITY_MIN,
  fmt, minutesBetween, parseTs, type HumanState, type Phase, type Quality,
} from "./human-posture";

export type NoticeClass = "critical" | "decision" | "report" | "digest";
export type Channel = "dash-focus" | "dash-updates" | "dash-quiet";
export type GateAction = "deliver" | "defer" | "digest";
export const CLASSES: readonly NoticeClass[] = ["critical", "decision", "report", "digest"];
export const ACTIONS: readonly GateAction[] = ["deliver", "defer", "digest"];
export const CRITICAL_ALLOWLIST: ReadonlySet<string> = new Set(["gate-executor", "fsm-supervisor", "backup-guard"]);
/** C14: only dash-focus may sound, and only PEAK uses it. */
export const SOUND_CHANNELS: ReadonlySet<Channel> = new Set<Channel>(["dash-focus"]);

export interface Decision {
  schema: "dash.interaction_decision/v1";
  phase: Phase;
  posture: "BURN" | "BALANCED" | "RESERVE" | "OFFLOAD";
  notifyBudgetPerHour: number;
  interruptCapPerBlock: number;
  capRemaining: number;
  allowDecisions: "all" | "tonight_plans_only" | "bulk_only" | "none";
  batchWindow: "now" | "block_boundary" | "hourly" | "morning_digest";
  verbosity: "full" | "normal" | "terse" | "digest_only";
  channel: Channel;
  workAssignment: "hard" | "normal" | "light" | "none";
  captureMode: boolean;
  captureEnforced: boolean;
  breakNudge: "none" | "soft" | "firm";
  nextTransitionAt: string;
  peakStartAt: string;
  nextPeakAt: string;
  digestEarliestAt: string;
  quality: Quality | string;
  enforce: string;
  criticalOptIn: boolean;
  arithmetic: string;
}

export interface NoticeRouteInput { cls?: string; producer?: string; irreversible?: boolean; tonightPlan?: boolean }
export interface NoticeRoute {
  schema: "dash.notice_route/v1";
  action: GateAction;
  cls: NoticeClass;
  channel: Channel;
  releaseAt: string | null;
  reason: string;
}

type Row = Pick<Decision, "posture" | "allowDecisions" | "batchWindow" | "verbosity" | "channel" | "workAssignment"> & { notify: number; cap: number };
const quietRow: Row = { posture: "OFFLOAD", notify: 0, cap: 0, allowDecisions: "none", batchWindow: "morning_digest", verbosity: "digest_only", channel: "dash-quiet", workAssignment: "none" };
// §4.2, the "normal" row: readiness is always unknown in WP1 (R5, C9)
export const ROWS: Readonly<Record<Phase, Row>> = {
  SLEEP: quietRow,
  INERTIA: { posture: "RESERVE", notify: 1, cap: 0, allowDecisions: "none", batchWindow: "morning_digest", verbosity: "digest_only", channel: "dash-updates", workAssignment: "none" },
  PEAK: { posture: "BURN", notify: 6, cap: 3, allowDecisions: "all", batchWindow: "now", verbosity: "full", channel: "dash-focus", workAssignment: "hard" },
  DIP: { posture: "BALANCED", notify: 3, cap: 1, allowDecisions: "bulk_only", batchWindow: "block_boundary", verbosity: "terse", channel: "dash-updates", workAssignment: "light" },
  SECOND: { posture: "BALANCED", notify: 2, cap: 1, allowDecisions: "tonight_plans_only", batchWindow: "hourly", verbosity: "terse", channel: "dash-updates", workAssignment: "normal" },
  WIND_DOWN: quietRow,
  PRE_SLEEP: quietRow,
  DISENGAGED: quietRow,
};

const MIN = 60_000;
function sleepStart(s: HumanState): number {
  const bed = parseTs(s.anchors.bedTarget);
  return s.lastActivityAt ? Math.max(bed, parseTs(s.lastActivityAt) + SLEEP_AFTER_ACTIVITY_MIN * MIN) : bed;
}

export function phaseOf(s: HumanState, now: number): Phase {
  const wake = parseTs(s.anchors.wakeAt), freeze = parseTs(s.anchors.freezeAt), bed = parseTs(s.anchors.bedTarget);
  if (now < wake || now >= sleepStart(s)) return "SLEEP";
  if (s.disengagedUntil && now < parseTs(s.disengagedUntil)) return "DISENGAGED";
  if (now >= bed - PRE_SLEEP_MIN * MIN) return "PRE_SLEEP";
  if (now >= freeze) return "WIND_DOWN";
  const e = minutesBetween(wake, now);
  if (e < INERTIA_MIN) return "INERTIA";
  if (e < PEAK_END_MIN) return "PEAK";
  if (e < DIP_END_MIN) return "DIP";
  return "SECOND";
}

function nextTransition(phase: Phase, s: HumanState, now: number): number {
  const wake = parseTs(s.anchors.wakeAt), freeze = parseTs(s.anchors.freezeAt), bed = parseTs(s.anchors.bedTarget);
  const sleepAt = sleepStart(s);
  switch (phase) {
    case "SLEEP": { const wt = parseTs(s.anchors.wakeTarget); return wt > now ? wt : now; }
    case "DISENGAGED": return Math.min(parseTs(s.disengagedUntil ?? s.anchors.wakeTarget), sleepAt);
    case "PRE_SLEEP": return sleepAt;
    case "WIND_DOWN": return bed - PRE_SLEEP_MIN * MIN;
    case "INERTIA": return Math.min(wake + INERTIA_MIN * MIN, freeze);
    case "PEAK": return Math.min(wake + PEAK_END_MIN * MIN, freeze);
    case "DIP": return Math.min(wake + DIP_END_MIN * MIN, freeze);
    case "SECOND": return freeze;
  }
}

const clockOrNone = (ts: string | null): string => (ts ? `${ts.slice(11, 16)}Z` : "none");

export function policy(s: HumanState, nowIso: string): Decision {
  const now = parseTs(nowIso);
  const phase = phaseOf(s, now);
  const row = ROWS[phase];
  const wake = parseTs(s.anchors.wakeAt);
  const peakStart = wake + INERTIA_MIN * MIN;
  const wakeTarget = parseTs(s.anchors.wakeTarget);
  const nextPeak = now < wake + PEAK_END_MIN * MIN && DAY.has(phase) ? peakStart : wakeTarget + INERTIA_MIN * MIN;
  const digestAt = DAY.has(phase) ? wake + 30 * MIN : wakeTarget + 30 * MIN;
  let left = row.notify - Math.trunc(s.deliveredThisHour ?? 0);
  if (row.cap) left = Math.min(left, row.cap - Math.trunc(s.interruptsThisBlock ?? 0));
  const capRemaining = Math.max(0, left);
  let posture = row.posture, work = row.workAssignment;
  if (phase === "SECOND" && (s.hardBlocksUsed ?? 0) >= 2) { posture = "RESERVE"; work = "light"; }
  const e = Math.max(0, minutesBetween(wake, now));
  const arithmetic = `phase=${phase}: wake ${fmt(wake).slice(11, 16)}Z (${s.quality ?? "default"}) +${Math.floor(e / 60)}h${String(e % 60).padStart(2, "0")}m; ` +
    `freeze ${s.anchors.freezeAt.slice(11, 16)}Z; bed ${s.anchors.bedTarget.slice(11, 16)}Z; last activity ${clockOrNone(s.lastActivityAt)}; ` +
    `readiness unknown -> normal row; cap ${capRemaining}/${row.notify}`;
  return {
    schema: "dash.interaction_decision/v1",
    phase, posture,
    notifyBudgetPerHour: row.notify,
    interruptCapPerBlock: row.cap,
    capRemaining,
    allowDecisions: row.allowDecisions,
    batchWindow: row.batchWindow,
    verbosity: row.verbosity,
    channel: row.channel,
    workAssignment: work,
    captureMode: QUIET.has(phase),
    captureEnforced: false, // R2b: shadow until the owner opts in
    breakNudge: "none",
    nextTransitionAt: fmt(nextTransition(phase, s, now)),
    peakStartAt: fmt(peakStart),
    nextPeakAt: fmt(nextPeak),
    digestEarliestAt: fmt(digestAt),
    quality: String(s.quality ?? "default"),
    enforce: String(s.enforce ?? "quiet_only"),
    criticalOptIn: Boolean(s.criticalOptIn),
    arithmetic,
  };
}

/** The finite core of `route`; proven in Bend (bend/circadian/LAWS.bend in z0intelligence). */
export function gate(phase: Phase, cls: NoticeClass, allowlisted: boolean, irreversible: boolean, optin: boolean, plan: boolean, capok: boolean): GateAction {
  const quiet = QUIET.has(phase);
  let c: NoticeClass = cls;
  if (c === "critical") {
    if (allowlisted && irreversible) return quiet ? (optin ? "deliver" : "digest") : "deliver";
    c = "report"; // C5
  }
  if (quiet) return "digest";
  if (c === "decision") return phase === "PEAK" || (phase === "SECOND" && plan) ? (capok ? "deliver" : "defer") : "defer";
  if (c === "report") {
    if (phase === "INERTIA") return "digest";
    if (phase === "PEAK") return capok ? "deliver" : "defer";
    return "defer";
  }
  if (phase === "INERTIA") return "deliver";
  return capok ? "deliver" : "defer";
}

export function route(d: Decision, notice: NoticeRouteInput, nowIso: string): NoticeRoute {
  const now = parseTs(nowIso);
  const cls: NoticeClass = CLASSES.find((c) => c === notice.cls) ?? "report";
  const allowlisted = CRITICAL_ALLOWLIST.has(String(notice.producer ?? ""));
  const irreversible = Boolean(notice.irreversible), plan = Boolean(notice.tonightPlan);
  const phase = d.phase;
  const action = gate(phase, cls, allowlisted, irreversible, Boolean(d.criticalOptIn), plan, Math.trunc(d.capRemaining) > 0);
  const effective: NoticeClass = cls !== "critical" || (allowlisted && irreversible) ? cls : "report";
  let releaseAt: string | null = null, reason: string;
  if (action === "digest") {
    releaseAt = d.digestEarliestAt;
    reason = QUIET.has(phase) ? "quiet phase: held for the morning digest" : "inertia: folded into the morning digest";
  } else if (action === "defer") {
    const nxt = parseTs(d.nextTransitionAt);
    if (effective === "decision" && !(phase === "PEAK" || (phase === "SECOND" && plan))) {
      releaseAt = d.nextPeakAt;
      reason = `decisions are not asked in ${phase}; next peak`;
    } else if (phase === "DIP") {
      releaseAt = fmt(nxt);
      reason = "dip: batched to the block boundary";
    } else {
      releaseAt = fmt(Math.min(Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000, nxt));
      reason = `${phase}: budget or hourly batch`;
    }
  } else {
    reason = effective === "critical" ? "allowlisted irreversible critical" : `${phase}: within budget`;
  }
  return { schema: "dash.notice_route/v1", action, cls: effective, channel: d.channel, releaseAt, reason };
}

/** R4: the only decision fields allowed to leave the owner's host. */
export function publicView(d: Decision): { allowDecisions: Decision["allowDecisions"]; nextPeakAt: string } {
  return { allowDecisions: d.allowDecisions, nextPeakAt: d.nextPeakAt };
}
