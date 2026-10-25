import { createStore } from "./createStore";

/**
 * Phone-side ACP permission state. This is not the upstream publication GateItem
 * approvals store. The bridge owns authorization and the final outcome.
 *
 * These event shapes are structural counterparts of shared/permission.ts (#132).
 * This module deliberately has no import from that sibling, which has not landed
 * on the parallel-lane base. Hermes can wire its parsed events without adapters.
 */
export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export interface PermissionRequest {
  type: "permission_request";
  requestId: string;
  turnId: string;
  sessionId: string;
  options: PermissionOption[];
  deadlineAt: number;
}

export interface PermissionDecision {
  type: "permission_decision";
  requestId: string;
  turnId: string;
  optionId: string;
}

export interface PermissionResolution {
  type: "permission_resolved";
  requestId: string;
  turnId: string;
  outcome: "allowed" | "denied" | "timeout";
  optionId?: string;
}

export interface PermissionScope {
  conversationId: string;
  sessionId: string;
  turnId: string;
  requestId: string;
}

export type PermissionPhase = "pending" | "deciding" | "allowed" | "denied" | "timeout";
export type PermissionError = "disconnected" | "transport_failed" | null;

export interface PermissionRecord extends PermissionScope {
  readonly options: readonly PermissionOption[];
  readonly deadlineAt: number;
  readonly phase: PermissionPhase;
  /** The phone's choice, not authorization. It is never an optimistic grant. */
  readonly chosenOptionId: string | null;
  readonly resolvedOptionId: string | null;
  readonly settledBy: "bridge" | "deadline" | null;
  readonly error: PermissionError;
  readonly attempt: number;
}

export interface PermissionState {
  readonly records: Readonly<Record<string, PermissionRecord>>;
}

export interface PermissionStoreDependencies {
  sendDecision(scope: PermissionScope, decision: PermissionDecision): void | Promise<void>;
  now?: () => number;
  /** Returns a cancellation function. Injectable for deterministic deadline tests. */
  schedule?: (callback: () => void, delayMs: number) => () => void;
}

const MAX_DELAY_MS = 2_147_483_647;
const MAX_OPTIONS = 64;

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim().length > 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOption(value: unknown): value is PermissionOption {
  return isObject(value) &&
    validId(value.optionId) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= 1024 &&
    (value.kind === "allow_once" || value.kind === "allow_always" ||
      value.kind === "reject_once" || value.kind === "reject_always");
}

function isRequest(value: unknown): value is PermissionRequest {
  if (!isObject(value) || value.type !== "permission_request" ||
    !validId(value.requestId) || !validId(value.turnId) || !validId(value.sessionId) ||
    typeof value.deadlineAt !== "number" || !Number.isFinite(value.deadlineAt) ||
    !Array.isArray(value.options) || value.options.length === 0 ||
    value.options.length > MAX_OPTIONS || !value.options.every(isOption)) return false;

  const ids = new Set(value.options.map(option => option.optionId));
  return ids.size === value.options.length;
}

function isResolution(value: unknown): value is PermissionResolution {
  return isObject(value) &&
    value.type === "permission_resolved" &&
    validId(value.requestId) && validId(value.turnId) &&
    (value.outcome === "allowed" || value.outcome === "denied" || value.outcome === "timeout") &&
    (value.optionId === undefined || validId(value.optionId));
}

function isScope(scope: PermissionScope): boolean {
  return validId(scope.conversationId) && validId(scope.sessionId) &&
    validId(scope.turnId) && validId(scope.requestId);
}

/** A length-safe composite key: even IDs containing separators cannot collide. */
function recordKey(scope: PermissionScope): string {
  return JSON.stringify([scope.conversationId, scope.sessionId, scope.turnId, scope.requestId]);
}

function unresolved(record: PermissionRecord): boolean {
  return record.phase === "pending" || record.phase === "deciding";
}

function sameOptions(left: readonly PermissionOption[], right: readonly PermissionOption[]): boolean {
  return left.length === right.length && left.every((option, index) => {
    const other = right[index];
    return other !== undefined && other.optionId === option.optionId &&
      other.name === option.name && other.kind === option.kind;
  });
}

export function createPermissionsStore(deps: PermissionStoreDependencies) {
  const state = createStore<PermissionState>({ records: {} });
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((callback: () => void, delayMs: number) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  });
  const timers = new Map<string, () => void>();
  let disposed = false;

  function change(key: string, update: (record: PermissionRecord) => PermissionRecord): void {
    if (disposed) return;
    const before = state.get().records[key];
    if (!before) return;
    const after = update(before);
    if (after === before) return;
    state.set(previous => ({ records: { ...previous.records, [key]: after } }));
  }

  function cancelTimer(key: string): void {
    timers.get(key)?.();
    timers.delete(key);
  }

  function expire(key: string): void {
    cancelTimer(key);
    change(key, record => unresolved(record) && now() >= record.deadlineAt
      ? { ...record, phase: "timeout", settledBy: "deadline", error: null }
      : record);
  }

  function arm(key: string, deadlineAt: number): void {
    cancelTimer(key);
    if (disposed) return;
    const remaining = deadlineAt - now();
    if (remaining <= 0) {
      expire(key);
      return;
    }
    const cancel = schedule(() => {
      timers.delete(key);
      if (disposed) return;
      if (now() >= deadlineAt) expire(key);
      else arm(key, deadlineAt); // A long timer or a clock adjustment.
    }, Math.min(remaining, MAX_DELAY_MS));
    timers.set(key, cancel);
  }

  function recordFor(scope: PermissionScope): PermissionRecord | undefined {
    return isScope(scope) ? state.get().records[recordKey(scope)] : undefined;
  }

  function pendingForConversation(conversationId: string): PermissionRecord[] {
    return Object.values(state.get().records).filter(
      record => record.conversationId === conversationId && unresolved(record),
    );
  }

  function pendingCount(conversationId?: string): number {
    return Object.values(state.get().records).filter(
      record => unresolved(record) && (conversationId === undefined || record.conversationId === conversationId),
    ).length;
  }

  /** A repeated request never reopens a settled blocker or resends a choice. */
  function receiveRequest(conversationId: string, event: unknown): boolean {
    if (disposed || !validId(conversationId) || !isRequest(event)) return false;
    const scope: PermissionScope = {
      conversationId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      requestId: event.requestId,
    };
    const key = recordKey(scope);
    const existing = state.get().records[key];
    if (existing) {
      if (existing.deadlineAt !== event.deadlineAt || !sameOptions(existing.options, event.options)) return false;
      if (now() >= existing.deadlineAt) expire(key);
      else if (existing.phase === "pending" && existing.error === "disconnected") {
        change(key, record => ({ ...record, error: null }));
      }
      return true;
    }
    const expired = now() >= event.deadlineAt;
    const record: PermissionRecord = {
      ...scope,
      options: event.options.map(option => ({ ...option })),
      deadlineAt: event.deadlineAt,
      phase: expired ? "timeout" : "pending",
      chosenOptionId: null,
      resolvedOptionId: null,
      settledBy: expired ? "deadline" : null,
      error: null,
      attempt: 0,
    };
    state.set(previous => ({ records: { ...previous.records, [key]: record } }));
    if (!expired) arm(key, event.deadlineAt);
    return true;
  }

  /** A bridge resolution is authoritative, but must match all four scope IDs. */
  function receiveResolution(conversationId: string, sessionId: string, event: unknown): boolean {
    if (disposed || !validId(conversationId) || !validId(sessionId) || !isResolution(event)) return false;
    const key = recordKey({ conversationId, sessionId, turnId: event.turnId, requestId: event.requestId });
    const record = state.get().records[key];
    if (!record || record.settledBy === "bridge") return false;
    if (event.optionId !== undefined && !record.options.some(option => option.optionId === event.optionId)) return false;
    if (record.chosenOptionId !== null && event.optionId !== undefined &&
      event.optionId !== record.chosenOptionId) return false;
    const offered = record.options.find(option => option.optionId === event.optionId);
    if (event.outcome === "allowed" && offered &&
      (offered.kind === "reject_once" || offered.kind === "reject_always")) return false;

    cancelTimer(key);
    change(key, current => ({
      ...current,
      phase: event.outcome,
      resolvedOptionId: event.optionId ?? null,
      settledBy: "bridge",
      error: null,
    }));
    return true;
  }

  /** A tap emits one exact offered option and remains deciding until a bridge result. */
  async function decide(scope: PermissionScope, optionId: string): Promise<boolean> {
    if (disposed || !isScope(scope) || !validId(optionId)) return false;
    const key = recordKey(scope);
    const record = state.get().records[key];
    if (!record || record.phase !== "pending" || record.error === "disconnected") return false;
    if (now() >= record.deadlineAt) {
      expire(key);
      return false;
    }
    if (!record.options.some(option => option.optionId === optionId)) return false;
    const attempt = record.attempt + 1;
    change(key, current => ({
      ...current,
      phase: "deciding",
      chosenOptionId: optionId,
      error: null,
      attempt,
    }));
    const decision: PermissionDecision = {
      type: "permission_decision",
      turnId: scope.turnId,
      requestId: scope.requestId,
      optionId,
    };
    try {
      await deps.sendDecision(scope, decision);
      return true;
    } catch {
      // A failed write is not authorization. A late rejection must not undo
      // a newer press, disconnect, timeout, or authoritative resolution.
      change(key, current => current.phase === "deciding" && current.attempt === attempt
        ? { ...current, phase: "pending", error: "transport_failed" }
        : current);
      return false;
    }
  }

  /** Keep blockers visible when offline; the bridge may still have the outcome. */
  function disconnect(conversationId: string, sessionId?: string): void {
    if (disposed || !validId(conversationId)) return;
    for (const [key, record] of Object.entries(state.get().records)) {
      if (record.conversationId !== conversationId || (sessionId !== undefined && record.sessionId !== sessionId) ||
        !unresolved(record)) continue;
      change(key, current => ({
        ...current,
        phase: "pending",
        error: "disconnected",
      }));
    }
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const cancel of timers.values()) cancel();
    timers.clear();
    state.set({ records: {} });
  }

  return {
    state,
    recordFor,
    pendingForConversation,
    pendingCount,
    receiveRequest,
    receiveResolution,
    decide,
    disconnect,
    dispose,
  };
}
