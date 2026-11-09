/** Pure classification of observed turn activity. No transcript, clock, or process reads. */
export type StuckThresholds = {
  slowMs: number;
  stuckMs: number;
  toolStuckMs: number;
};

export const DEFAULT_STUCK_THRESHOLDS: Readonly<StuckThresholds> = {
  slowMs: 90_000,
  stuckMs: 300_000,
  toolStuckMs: 600_000,
};

export type TurnObservation = {
  phase: "idle" | "thinking" | "tool" | "streaming" | "waiting-approval";
  tool?: string;
  observed: boolean;
};

export type TurnAction = "wait" | "steer" | "interrupt" | "cancel" | "open-host";

export type TurnDiagnosis = {
  state: "healthy" | "slow" | "stuck" | "waiting-on-owner" | "unobserved" | "dead";
  reason: string;
  idleMs: number;
  actions: TurnAction[];
};

export type DiagnoseTurnInput = {
  phase: TurnObservation;
  startedAt: number;
  lastEventAt: number;
  now: number;
  ownedByBridge: boolean;
  processAlive?: boolean;
  thresholds?: Partial<StuckThresholds>;
};

function threshold(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Only a bounded tool identifier may be reflected in a reason, never a description,
 * command, argument, or transcript. Hermes can report comma-separated tool names.
 */
function safeToolName(tool: string | undefined): string | undefined {
  if (!tool || tool.length > 96) return undefined;
  return /^[A-Za-z0-9_][A-Za-z0-9_.:-]*(?:, [A-Za-z0-9_][A-Za-z0-9_.:-]*)*$/.test(tool)
    ? tool
    : undefined;
}

/** Stale activity is only a diagnostic signal, not proof that execution has hung.
 * A bridge may cancel only a process it owns, never a merely observed host turn.
 * Durations are elapsed since the latest of turn start and last observed event.
 */
export function diagnoseTurn(input: DiagnoseTurnInput): TurnDiagnosis {
  const timesValid = Number.isFinite(input.startedAt) &&
    Number.isFinite(input.lastEventAt) && Number.isFinite(input.now);
  const idleMs = timesValid
    ? Math.max(0, input.now - Math.max(input.startedAt, input.lastEventAt))
    : 0;

  // Missing/invalid observation cannot authorize disruptive host actions.
  if (!input.phase.observed || !timesValid) {
    return {
      state: "unobserved",
      reason: timesValid ? "Host turn activity has not been observed." : "Host event timing is unavailable.",
      idleMs,
      actions: ["wait", "open-host"],
    };
  }

  const tool = safeToolName(input.phase.tool);
  const toolSuffix = tool ? " (tool " + tool + ")" : "";

  if (input.processAlive === false) {
    return {
      state: "dead",
      reason: "Host process is no longer running" + toolSuffix + ".",
      idleMs,
      actions: input.ownedByBridge ? ["cancel"] : ["open-host"],
    };
  }

  if (input.phase.phase === "waiting-approval") {
    return {
      state: "waiting-on-owner",
      reason: "Waiting for approval or clarification on the host" + toolSuffix + ".",
      idleMs,
      actions: ["open-host"],
    };
  }

  // An explicitly idle phase is not evidence of a stalled running turn.
  if (input.phase.phase === "idle") {
    return { state: "healthy", reason: "No active turn is reported.", idleMs, actions: [] };
  }

  const slowMs = threshold(input.thresholds?.slowMs, DEFAULT_STUCK_THRESHOLDS.slowMs);
  const stuckMs = Math.max(slowMs, threshold(input.thresholds?.stuckMs, DEFAULT_STUCK_THRESHOLDS.stuckMs));
  const toolStuckMs = Math.max(stuckMs, threshold(input.thresholds?.toolStuckMs, DEFAULT_STUCK_THRESHOLDS.toolStuckMs));
  const limit = input.phase.phase === "tool" ? toolStuckMs : stuckMs;
  const elapsed = Math.floor(idleMs / 1000) + " s";

  // "Beyond" means strictly greater than the threshold; equality is not stale.
  if (idleMs > limit) {
    const actions: TurnAction[] = ["steer", "interrupt"];
    if (input.ownedByBridge) actions.push("cancel");
    return {
      state: "stuck",
      reason: "No activity event for " + elapsed + toolSuffix + "; the turn may be stuck.",
      idleMs,
      actions,
    };
  }
  if (idleMs > slowMs) {
    return {
      state: "slow",
      reason: "No activity event for " + elapsed + toolSuffix + "; the turn may be slow.",
      idleMs,
      actions: ["wait", "steer"],
    };
  }
  return {
    state: "healthy",
    reason: "Recent activity (" + elapsed + " since last event)" + toolSuffix + ".",
    idleMs,
    actions: ["wait"],
  };
}
