/**
 * Pure focus-block break nudges. The caller persists nudgesThisBlock only after
 * dispatching a nudge and persists a new block start when a break ends.
 * No wall-clock reads or notification side effects occur here.
 */
export type FocusBlockKind = "standard" | "rested";
export type BreakNudgePhase =
  | "PEAK"
  | "DIP"
  | "SECOND"
  | "WIND_DOWN"
  | "PRE_SLEEP"
  | "SLEEP"
  | "INERTIA"
  | "DISENGAGED";
export type BreakNudgeLevel = "none" | "soft" | "firm";

export interface BreakNudgeInput {
  now: number;
  blockStartAt: number;
  lastBreakEndAt: number | null;
  lastActivityAt: number | null;
  blockKind: FocusBlockKind;
  phase: BreakNudgePhase;
  nudgesThisBlock: number;
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

/**
 * At a block start, only the initial 180-minute wake window can be rested.
 * The caller must use "standard" after an early first-block completion:
 * elapsed time alone cannot reveal a previous break.
 */
export function nextBlock({ now, wakeAt, restedMorning }: NextBlockInput): FocusBlockKind {
  return restedMorning &&
    Number.isFinite(now) &&
    Number.isFinite(wakeAt) &&
    now >= wakeAt &&
    now - wakeAt < RESTED_BLOCK_MINUTES * MINUTE
    ? "rested"
    : "standard";
}

export function breakNudge(input: BreakNudgeInput): BreakNudgeResult {
  const { now, blockStartAt, lastBreakEndAt, lastActivityAt, blockKind, phase, nudgesThisBlock } = input;

  if (
    !Number.isFinite(now) ||
    !Number.isFinite(blockStartAt) ||
    (lastBreakEndAt !== null && !Number.isFinite(lastBreakEndAt)) ||
    (lastActivityAt !== null && !Number.isFinite(lastActivityAt)) ||
    !Number.isSafeInteger(nudgesThisBlock) ||
    nudgesThisBlock < 0
  ) {
    return { level: "none", dueAt: null, reason: "0 minutes elapsed; invalid focus-block timing or nudge count." };
  }

  const endedBreakAt =
    lastBreakEndAt !== null && lastBreakEndAt > blockStartAt && lastBreakEndAt <= now
      ? lastBreakEndAt
      : null;
  const idleBreak =
    lastActivityAt !== null &&
    lastActivityAt <= now &&
    now - lastActivityAt >= IDLE_BREAK_MINUTES * MINUTE;

  // An ongoing >=10-minute idle interval counts as a break ending at now.
  // An explicit completed break instead restarts the block at its end time.
  const effectiveStartAt = idleBreak ? now : endedBreakAt ?? blockStartAt;
  const reset = idleBreak || endedBreakAt !== null;
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

  const softAt = effectiveStartAt + blockMinutes * MINUTE;
  // The first nudge is soft; the next is firm after 15 minutes, with
  // at most one more firm nudge at the next 30-minute boundary.
  const nextAt = count === 0
    ? softAt
    : softAt + (FIRM_DELAY_MINUTES + (count - 1) * FIRM_REPEAT_MINUTES) * MINUTE;
  if (!Number.isFinite(nextAt)) {
    return { level: "none", dueAt: null, reason: `${context}; nudge deadline is out of range.` };
  }

  const nextLevel: Exclude<BreakNudgeLevel, "none"> = count === 0 ? "soft" : "firm";
  if (now < nextAt) {
    const remainingMinutes = Math.ceil((nextAt - now) / MINUTE);
    return {
      level: "none",
      dueAt: nextAt,
      reason: `${context}; ${nextLevel} break nudge due in ${remainingMinutes} minutes.`,
    };
  }
  return {
    level: nextLevel,
    dueAt: nextAt,
    reason: `${context}; ${nextLevel} break nudge is due.`,
  };
}
