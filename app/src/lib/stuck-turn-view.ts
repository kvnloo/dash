/** UI-only projection of the bridge's DF-014 TurnDiagnosis. No host actions here. */
export type TurnAction = "wait" | "steer" | "interrupt" | "cancel" | "open-host";
export type TurnState = "healthy" | "slow" | "stuck" | "waiting-on-owner" | "unobserved" | "dead";

export interface TurnDiagnosis {
  state: TurnState;
  reason: string;
  idleMs: number;
  actions: TurnAction[];
}

export interface StuckTurnActionView {
  id: TurnAction;
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
}

export interface StuckTurnView {
  title: string;
  detail: string;
  tone: "quiet" | "warning";
  actions: StuckTurnActionView[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTurnState(value: unknown): value is TurnState {
  return value === "healthy" || value === "slow" || value === "stuck" ||
    value === "waiting-on-owner" || value === "unobserved" || value === "dead";
}

function isTurnAction(value: unknown): value is TurnAction {
  return value === "wait" || value === "steer" || value === "interrupt" ||
    value === "cancel" || value === "open-host";
}

/** Reject incomplete or unexpected bridge responses before rendering any action. */
export function parseTurnDiagnosis(raw: unknown): TurnDiagnosis | null {
  if (!isRecord(raw) || !isTurnState(raw.state) ||
      typeof raw.reason !== "string" || !raw.reason.trim() ||
      typeof raw.idleMs !== "number" || !Number.isFinite(raw.idleMs) || raw.idleMs < 0 ||
      !Array.isArray(raw.actions)) return null;

  const actions: TurnAction[] = [];
  const seen = new Set<TurnAction>();
  for (const item of raw.actions) {
    if (!isTurnAction(item) || seen.has(item)) return null;
    seen.add(item);
    actions.push(item);
  }

  return { state: raw.state, reason: raw.reason.trim(), idleMs: raw.idleMs, actions };
}

export function formatTurnIdle(idleMs: number): string {
  const seconds = Math.floor(Math.max(0, idleMs) / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`;
}

const actionCopy: Record<TurnAction, { label: string; accessibilityLabel: string }> = {
  wait: { label: "Wait", accessibilityLabel: "Wait; leave the turn running" },
  steer: { label: "Steer…", accessibilityLabel: "Steer the running turn" },
  interrupt: { label: "Interrupt", accessibilityLabel: "Request interruption of the turn" },
  cancel: { label: "Cancel turn", accessibilityLabel: "Cancel this bridge-owned turn" },
  "open-host": { label: "Open on host", accessibilityLabel: "Open this session on the host" },
};

const stateCopy: Record<Exclude<TurnState, "healthy">, {
  title: string;
  note: string;
  tone: "quiet" | "warning";
}> = {
  slow: {
    title: "Turn is taking longer",
    note: "The turn may still be working.",
    tone: "quiet",
  },
  stuck: {
    title: "Turn may be stuck",
    note: "No recent progress was observed; execution is not confirmed stopped.",
    tone: "warning",
  },
  "waiting-on-owner": {
    title: "Turn needs approval",
    note: "The host is waiting for a decision.",
    tone: "warning",
  },
  unobserved: {
    title: "Turn status unavailable",
    note: "Dash cannot observe this turn's progress. No actions are offered without confirmation.",
    tone: "quiet",
  },
  dead: {
    title: "Turn process stopped",
    note: "The bridge reports that this turn's process is no longer alive.",
    tone: "warning",
  },
};

/** An absent action is never inferred, especially destructive cancel. */
export function stuckTurnView(
  diagnosis: TurnDiagnosis,
  options: { busyAction?: string } = {},
): StuckTurnView | null {
  if (diagnosis.state === "healthy") return null;
  const copy = stateCopy[diagnosis.state];
  const detail = diagnosis.state === "unobserved"
    ? `${copy.note} ${diagnosis.reason}`
    : `${copy.note} Idle ${formatTurnIdle(diagnosis.idleMs)}. ${diagnosis.reason}`;
  const busy = options.busyAction !== undefined;
  // An unobserved host must never expose actions even if a bad upstream packet offered them.
  const available = diagnosis.state === "unobserved" ? [] : diagnosis.actions;

  return {
    title: copy.title,
    detail,
    tone: copy.tone,
    actions: available.map((id) => {
      const copy = actionCopy[id];
      const working = busy && id === options.busyAction;
      return {
        id,
        label: working ? `${copy.label} · Working…` : copy.label,
        accessibilityLabel: working ? `${copy.accessibilityLabel}; in progress` : copy.accessibilityLabel,
        disabled: busy,
      };
    }),
  };
}
