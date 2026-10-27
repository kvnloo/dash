/**
 * Pure focus-block scheduler. The specified inputs provide nominal deadlines;
 * nudgesThisBlock counts deliveries in the effective block after the latest break.
 * Optional lastNudgeAt adds actual-delivery spacing and distinguishes stale counts
 * across retained break markers. Persist it atomically with the count on delivery.
 * On a break, persist the new blockStartAt and clear the count/delivery time.
 * Without delivery history a pure function cannot infer late deliveries.
 */
export type FocusBlockKind = "standard" | "rested";
export type BreakNudgePhase =
  | "PEAK" | "DIP" | "SECOND" | "WIND_DOWN" | "PRE_SLEEP"
  | "SLEEP" | "INERTIA" | "DISENGAGED";
export type BreakNudgeLevel = "none" | "soft" | "firm";

export interface BreakNudgeInput {
  now: number;
  blockStartAt: number;
  lastBreakEndAt: number | null;
  lastActivityAt: number | null;
  blockKind: FocusBlockKind;
  phase: BreakNudgePhase;
  nudgesThisBlock: number;
  /** Optional actual delivery history for late-delivery spacing. Omit for the
   * nominal schedule; null explicitly means no delivery in the original block.
   * Without history, nudgesThisBlock belongs to the block after the latest break.
   */
  lastNudgeAt?: number | null;
}

export interface BreakNudgeResult {
  level: BreakNudgeLevel;
  /** Scheduled time of this nudge, or the next nudge if not yet due. */
  dueAt: number | null;
  reason: string;
}

export interface NextBlockInput {
  now: number;
  wakeAt: number;
  restedMorning: boolean;
  /** Optional completed-block history; omitted means selecting the first block.
   * Later selections must clear restedMorning or provide completed history.
   */
  completedBlocksSinceWake?: number;
}

const MINUTE = 60_000;
const IDLE_BREAK_MINUTES = 10;
const STANDARD_BLOCK_MINUTES = 90;
const RESTED_BLOCK_MINUTES = 180;
const FIRM_DELAY_MINUTES = 15;
const FIRM_REPEAT_MINUTES = 30;
const MAX_NUDGES = 3;
const SUPPRESSED_PHASES: ReadonlySet<BreakNudgePhase> = new Set([
  "WIND_DOWN", "PRE_SLEEP", "SLEEP", "DISENGAGED", "INERTIA",
]);

/** Called at a block start; a delayed first block still gets rested duration. */
export function nextBlock({ now, wakeAt, restedMorning, completedBlocksSinceWake = 0 }: NextBlockInput): FocusBlockKind {
  return restedMorning && Number.isFinite(now) && Number.isFinite(wakeAt) &&
    now >= wakeAt && completedBlocksSinceWake === 0 ? "rested" : "standard";
}

export function breakNudge(input: BreakNudgeInput): BreakNudgeResult {
  const { now, blockStartAt, lastBreakEndAt, lastActivityAt, blockKind, phase, nudgesThisBlock, lastNudgeAt } = input;
  if (
    !Number.isFinite(now) || !Number.isFinite(blockStartAt) ||
    (lastBreakEndAt !== null && !Number.isFinite(lastBreakEndAt)) ||
    (lastActivityAt !== null && !Number.isFinite(lastActivityAt)) ||
    (lastNudgeAt !== undefined && lastNudgeAt !== null && (!Number.isFinite(lastNudgeAt) || lastNudgeAt > now)) ||
    !Number.isSafeInteger(nudgesThisBlock) || nudgesThisBlock < 0
  ) {
    return { level: "none", dueAt: null, reason: "0 minutes elapsed; invalid focus-block timing or nudge count." };
  }
  const endedBreakAt = lastBreakEndAt !== null && lastBreakEndAt > blockStartAt && lastBreakEndAt <= now
    ? lastBreakEndAt : null;
  const idleBreak = lastActivityAt !== null && lastActivityAt <= now &&
    now - lastActivityAt >= IDLE_BREAK_MINUTES * MINUTE;
  // An ongoing idle break ends at now. Explicit breaks anchor at their end.
  const effectiveStartAt = idleBreak ? now : endedBreakAt ?? blockStartAt;
  // Discard only deliveries belonging to the previous block, not deliveries
  // made after a retained explicit break marker.
  const reset = idleBreak || (endedBreakAt !== null &&
    (lastNudgeAt === null || (lastNudgeAt !== undefined && lastNudgeAt < effectiveStartAt)));
  const count = reset ? 0 : nudgesThisBlock;
  const elapsedMinutes = Math.max(0, Math.floor((now - effectiveStartAt) / MINUTE));
  const blockMinutes = blockKind === "rested" ? RESTED_BLOCK_MINUTES : STANDARD_BLOCK_MINUTES;
  const context = `${elapsedMinutes} minutes elapsed in the ${blockMinutes}-minute ${blockKind} focus block` +
    (idleBreak ? " after an inactivity break reset" : endedBreakAt !== null ? " after an explicit break reset" : "");
  if (SUPPRESSED_PHASES.has(phase)) {
    return { level: "none", dueAt: null, reason: `${context}; ${phase} suppresses break nudges.` };
  }
  if (count >= MAX_NUDGES) {
    return { level: "none", dueAt: null, reason: `${context}; maximum of 3 nudges already delivered this block.` };
  }
  if (count > 0 && (lastNudgeAt === null || (lastNudgeAt !== undefined && lastNudgeAt < effectiveStartAt))) {
    return { level: "none", dueAt: null, reason: `${context}; actual last nudge delivery time is required.` };
  }
  const softAt = effectiveStartAt + blockMinutes * MINUTE;
  const scheduledAt = count === 0 ? softAt
    : softAt + (FIRM_DELAY_MINUTES + (count - 1) * FIRM_REPEAT_MINUTES) * MINUTE;
  // Preserve nominal deadlines, but space actual soft -> firm by 15 minutes
  // and actual firm -> firm by at least 30 minutes even after late delivery.
  const nextAt = count > 0 && lastNudgeAt !== undefined && lastNudgeAt !== null
    ? Math.max(scheduledAt, lastNudgeAt + (count === 1 ? FIRM_DELAY_MINUTES : FIRM_REPEAT_MINUTES) * MINUTE)
    : scheduledAt;
  if (!Number.isFinite(nextAt)) {
    return { level: "none", dueAt: null, reason: `${context}; nudge deadline is out of range.` };
  }
  const nextLevel: Exclude<BreakNudgeLevel, "none"> = count === 0 ? "soft" : "firm";
  if (now < nextAt) {
    return { level: "none", dueAt: nextAt,
      reason: `${context}; ${nextLevel} break nudge due in ${Math.ceil((nextAt - now) / MINUTE)} minutes.` };
  }
  return { level: nextLevel, dueAt: nextAt, reason: `${context}; ${nextLevel} break nudge is due.` };
}
