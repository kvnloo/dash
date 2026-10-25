/**
 * One ACP permission request per authenticated principal, turn, request and session.
 *
 * This is a host-side broker, not a socket authenticator. Hermes must supply the
 * controlling principal from the verified connection, never from client JSON.
 * The ACP adapter owns respond(); socket routing owns notify().
 */
export const PERMISSION_TIMEOUT_MS = 60_000;

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";

export type PermissionBrokerOption = {
  readonly optionId: string;
  readonly name: string;
  readonly kind: PermissionOptionKind;
};

export type PermissionScope = {
  readonly authenticatedPrincipal: string;
  readonly turnId: string;
  readonly requestId: string;
  readonly sessionId: string;
};

export type PermissionRequestNotice = {
  readonly type: "permission_request";
  readonly requestId: string;
  readonly turnId: string;
  readonly sessionId: string;
  readonly options: readonly PermissionBrokerOption[];
  readonly deadlineAt: number;
};

export type PermissionResolvedNotice = {
  readonly type: "permission_resolved";
  readonly requestId: string;
  readonly turnId: string;
  readonly outcome: "allowed" | "denied" | "timeout";
  readonly optionId?: string;
};

export type PermissionNotice = PermissionRequestNotice | PermissionResolvedNotice;

export type AcpPermissionResponse =
  | { readonly outcome: { readonly outcome: "selected"; readonly optionId: string } }
  | { readonly outcome: { readonly outcome: "cancelled" } };

export type PermissionNotifier = (authenticatedPrincipal: string, notice: PermissionNotice) => void;
export type PermissionResponder = (response: AcpPermissionResponse) => void;

export type PermissionRegistration = PermissionScope & {
  readonly options: readonly PermissionBrokerOption[];
  readonly respond: PermissionResponder;
  readonly notify: PermissionNotifier;
};

/** Returning a cancellation closure lets tests run without real timers. */
export type PermissionScheduler = {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
};

const systemScheduler: PermissionScheduler = {
  now: () => Date.now(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

type PendingPermission = {
  readonly identity: string;
  readonly scope: PermissionScope;
  readonly options: PermissionBrokerOption[];
  readonly deadlineAt: number;
  readonly respond: PermissionResponder;
  notify: PermissionNotifier;
  cancelTimer(): void;
};

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
}

function validScope(scope: PermissionScope): boolean {
  return !!scope &&
    validId(scope.authenticatedPrincipal) &&
    validId(scope.turnId) &&
    validId(scope.requestId) &&
    validId(scope.sessionId);
}

function validKind(value: unknown): value is PermissionOptionKind {
  return value === "allow_once" || value === "allow_always" ||
    value === "reject_once" || value === "reject_always";
}

function checkedOptions(options: readonly PermissionBrokerOption[]): PermissionBrokerOption[] {
  if (!Array.isArray(options) || options.length === 0 || options.length > 32) {
    throw new Error("ACP permission must offer 1–32 choices");
  }
  const seen = new Set<string>();
  return options.map(option => {
    if (!option || !validId(option.optionId) || seen.has(option.optionId) ||
        typeof option.name !== "string" || option.name.trim().length === 0 ||
        option.name.length > 256 || /[\x00-\x1f\x7f]/.test(option.name) ||
        !validKind(option.kind)) {
      throw new Error("Invalid or duplicate ACP permission choice");
    }
    seen.add(option.optionId);
    return { optionId: option.optionId, name: option.name, kind: option.kind };
  });
}

/** JSON tuple prevents collisions from delimiter characters in IDs. */
function identity(scope: PermissionScope): string {
  return JSON.stringify([
    scope.authenticatedPrincipal, scope.turnId, scope.requestId, scope.sessionId,
  ]);
}

/**
 * Fail-closed broker. Its only outward events are routed to the authenticated
 * controlling principal; there is no public list or cross-principal broadcast.
 */
export class PermissionBroker {
  private readonly pending = new Map<string, PendingPermission>();
  private readonly revoked = new Set<string>();
  private disposed = false;

  constructor(
    private readonly scheduler: PermissionScheduler = systemScheduler,
    private readonly onCallbackError: (error: unknown) => void = () => {},
  ) {}

  /** False means duplicate, revoked, or disposed: original responder remains owned. */
  register(input: PermissionRegistration): boolean {
    if (!validScope(input)) throw new Error("Invalid ACP permission identity");
    if (this.disposed || this.revoked.has(input.authenticatedPrincipal)) return false;
    const options = checkedOptions(input.options);
    const key = identity(input);
    if (this.pending.has(key)) return false;

    const now = this.scheduler.now();
    const deadlineAt = now + PERMISSION_TIMEOUT_MS;
    if (!Number.isFinite(now) || !Number.isFinite(deadlineAt)) {
      throw new Error("Invalid permission deadline clock");
    }

    // Copy all caller-owned objects: subsequent mutation cannot change an offer.
    const scope: PermissionScope = {
      authenticatedPrincipal: input.authenticatedPrincipal,
      turnId: input.turnId,
      requestId: input.requestId,
      sessionId: input.sessionId,
    };
    const entry: PendingPermission = {
      identity: key, scope, options, deadlineAt,
      respond: input.respond, notify: input.notify, cancelTimer: () => {},
    };
    this.pending.set(key, entry);
    try {
      entry.cancelTimer = this.scheduler.schedule(() => this.onDeadline(entry), PERMISSION_TIMEOUT_MS);
    } catch (error) {
      this.pending.delete(key);
      throw error;
    }
    if (this.pending.get(key) === entry) this.notifyRequest(entry);
    else this.safely(() => entry.cancelTimer());
    return true;
  }

  /** Select only an exactly offered option for this authenticated identity. */
  decide(choice: PermissionScope & { readonly optionId: string }): boolean {
    const entry = this.findLive(choice);
    if (!entry) return false;
    const option = entry.options.find(value => value.optionId === choice.optionId);
    if (!option) return false;
    const allowed = option.kind === "allow_once" || option.kind === "allow_always";
    this.settle(entry, allowed ? "allowed" : "denied", option.optionId);
    return true;
  }

  /** Explicit denial: pick reject_once, otherwise reject_always, or cancel. */
  deny(scope: PermissionScope): boolean {
    const entry = this.findLive(scope);
    if (!entry) return false;
    const reject = entry.options.find(value => value.kind === "reject_once") ??
      entry.options.find(value => value.kind === "reject_always");
    this.settle(entry, "denied", reject?.optionId);
    return true;
  }

  /** Turn cancellation or process exit; never selects an allow option. */
  cancel(scope: PermissionScope): boolean {
    const entry = this.findLive(scope);
    if (!entry) return false;
    this.settle(entry, "denied");
    return true;
  }

  /** Cancels every outstanding ACP request for the authenticated turn. */
  cancelTurn(authenticatedPrincipal: string, turnId: string): number {
    if (!validId(authenticatedPrincipal) || !validId(turnId)) return 0;
    let count = 0;
    for (const entry of [...this.pending.values()]) {
      if (entry.scope.authenticatedPrincipal !== authenticatedPrincipal ||
          entry.scope.turnId !== turnId) continue;
      this.settle(entry, "denied");
      count++;
    }
    return count;
  }

  /** Revocation is terminal for this principal on this broker instance. */
  revoke(authenticatedPrincipal: string): number {
    if (!validId(authenticatedPrincipal) || this.disposed) return 0;
    this.revoked.add(authenticatedPrincipal);
    let count = 0;
    for (const entry of [...this.pending.values()]) {
      if (entry.scope.authenticatedPrincipal !== authenticatedPrincipal) continue;
      this.settle(entry, "denied");
      count++;
    }
    return count;
  }

  /**
   * Replace the stale socket notifier and replay ONLY the authenticated
   * principal's unresolved blockers. Deadline is never extended.
   */
  replay(authenticatedPrincipal: string, notify: PermissionNotifier): number {
    if (!validId(authenticatedPrincipal) || this.disposed ||
        this.revoked.has(authenticatedPrincipal)) return 0;
    let count = 0;
    for (const entry of [...this.pending.values()]) {
      if (entry.scope.authenticatedPrincipal !== authenticatedPrincipal) continue;
      entry.notify = notify;
      if (this.expireIfDue(entry)) continue;
      this.notifyRequest(entry);
      count++;
    }
    return count;
  }

  /** Per-principal count only; no cross-account enumeration API. */
  pendingCount(authenticatedPrincipal: string): number {
    if (!validId(authenticatedPrincipal) || this.disposed ||
        this.revoked.has(authenticatedPrincipal)) return 0;
    let count = 0;
    for (const entry of this.pending.values()) {
      if (entry.scope.authenticatedPrincipal === authenticatedPrincipal) count++;
    }
    return count;
  }

  /** Shutdown safely cancels all ACP responders and clears every timer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.pending.values()]) this.settle(entry, "denied");
    this.revoked.clear();
  }

  private findLive(scope: PermissionScope): PendingPermission | undefined {
    if (!validScope(scope) || this.disposed ||
        this.revoked.has(scope.authenticatedPrincipal)) return undefined;
    const entry = this.pending.get(identity(scope));
    if (!entry || this.expireIfDue(entry)) return undefined;
    return entry;
  }

  private expireIfDue(entry: PendingPermission): boolean {
    if (this.pending.get(entry.identity) !== entry) return true;
    if (this.scheduler.now() < entry.deadlineAt) return false;
    this.settle(entry, "timeout");
    return true;
  }

  private onDeadline(entry: PendingPermission): void {
    if (this.pending.get(entry.identity) !== entry) return;
    const remaining = entry.deadlineAt - this.scheduler.now();
    if (remaining > 0) {
      // Account for clocks that move backwards; still enforce the full lease.
      try { entry.cancelTimer = this.scheduler.schedule(() => this.onDeadline(entry), remaining); }
      catch { this.settle(entry, "timeout"); }
      return;
    }
    this.settle(entry, "timeout");
  }

  private notifyRequest(entry: PendingPermission): void {
    const notice: PermissionRequestNotice = {
      type: "permission_request",
      requestId: entry.scope.requestId,
      turnId: entry.scope.turnId,
      sessionId: entry.scope.sessionId,
      options: entry.options.map(value => ({ ...value })),
      deadlineAt: entry.deadlineAt,
    };
    this.safely(() => entry.notify(entry.scope.authenticatedPrincipal, notice));
  }

  private settle(
    entry: PendingPermission,
    outcome: PermissionResolvedNotice["outcome"],
    optionId?: string,
  ): void {
    if (this.pending.get(entry.identity) !== entry) return;
    // Delete BEFORE callbacks: reentrant or late decisions can never win.
    this.pending.delete(entry.identity);
    this.safely(() => entry.cancelTimer());
    const response: AcpPermissionResponse = optionId === undefined
      ? { outcome: { outcome: "cancelled" } }
      : { outcome: { outcome: "selected", optionId } };
    this.safely(() => entry.respond(response));
    const notice: PermissionResolvedNotice = {
      type: "permission_resolved",
      requestId: entry.scope.requestId,
      turnId: entry.scope.turnId,
      outcome,
      ...(optionId === undefined ? {} : { optionId }),
    };
    this.safely(() => entry.notify(entry.scope.authenticatedPrincipal, notice));
  }

  private safely(callback: () => void): void {
    try { callback(); }
    catch (error) {
      try { this.onCallbackError(error); }
      catch { /* observer errors cannot reopen an ACP permission */ }
    }
  }
}
