import { createHash } from "node:crypto";

/**
 * Bridges one ACP session/request_permission JSON-RPC call to the authenticated
 * host permission broker. No terminal/fs client capabilities are exposed.
 *
 * The broker is a structural port until #133 is integrated: returning null
 * means no controlling client; returning a function unregisters on settlement.
 * Only the broker may authorize an option. All other paths fail closed.
 */
export const ACP_PERMISSION_TIMEOUT_MS = 60_000;

export type AcpPermissionRpcId = string | number;
export type AcpPermissionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always";
export type AcpPermissionChoice = {
  optionId: string;
  name: string;
  kind: AcpPermissionKind;
};
export type AcpPermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };
export type AcpPermissionResponse = {
  jsonrpc: "2.0";
  id: AcpPermissionRpcId;
  result: { outcome: AcpPermissionOutcome };
};
export type AcpPermissionBrokerRequest = {
  /** Hashed from the typed JSON-RPC id; never exposes an untrusted RPC id to the phone. */
  requestId: string;
  /** Supplied by the authenticated caller, never from ACP params. */
  principalId: string;
  turnId: string;
  sessionId: string;
  options: readonly AcpPermissionChoice[];
};
export type AcpPermissionResolution = {
  requestId: string;
  turnId: string;
  sessionId: string;
  outcome: "allowed" | "denied" | "timeout";
  optionId?: string;
};

/**
 * A broker may return a selected exact ACP optionId, cancellation, or timeout.
 * It must return null when there is no authenticated controller; the adapter
 * also has its own deadline in case a broker never settles.
 */
export interface AcpPermissionBrokerPort {
  register(
    request: AcpPermissionBrokerRequest,
    settle: (decision: unknown) => void,
  ): (() => void) | null;
}

export type AcpPermissionAdapterOptions = {
  /** The session owned by AcpClient, not a session from the untrusted frame. */
  activeSessionId: () => string | undefined;
  principalId: string;
  turnId: string;
  broker?: AcpPermissionBrokerPort;
  send: (response: AcpPermissionResponse) => void;
  /** Feed a visible permission resolution, not a generic Thinking state. */
  resolved: (resolution: AcpPermissionResolution) => void;
  /** Injectable for deterministic fake-clock tests. */
  schedule?: (callback: () => void, milliseconds: number) => () => void;
  timeoutMs?: number;
};

type Resolution = AcpPermissionResolution["outcome"];

const CANCELLED: AcpPermissionOutcome = { outcome: "cancelled" };
const LABELS: Record<AcpPermissionKind, string> = {
  allow_once: "Allow once",
  allow_always: "Always allow",
  reject_once: "Reject",
  reject_always: "Always deny",
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown, max: number): value is string {
  return typeof value === "string" &&
    value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function rpcId(value: unknown): AcpPermissionRpcId | null {
  if (identifier(value, 256)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return null;
}

function requestKey(id: AcpPermissionRpcId): string {
  // A string "5" and a number 5 are different JSON-RPC ids.
  return createHash("sha256").update(typeof id).update("\0").update(String(id)).digest("hex");
}

function parseOptions(raw: unknown): AcpPermissionChoice[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16) return null;
  const seen = new Set<string>();
  const options: AcpPermissionChoice[] = [];
  const items: unknown[] = raw;
  for (const value of items) {
    if (!record(value) || !identifier(value.optionId, 128) || seen.has(value.optionId)) return null;
    const kind = value.kind;
    if (kind !== "allow_once" && kind !== "allow_always" && kind !== "reject_once" && kind !== "reject_always") return null;
    seen.add(value.optionId);
    // Never forward toolCall, rawInput, commands, diagnostic data or arbitrary
    // provider option names (which may themselves contain credentials).
    options.push({ optionId: value.optionId, kind, name: LABELS[kind] });
  }
  return options;
}

function parseDecision(raw: unknown): AcpPermissionOutcome | "timeout" | null {
  if (!record(raw)) return null;
  if (raw.outcome === "timeout") return "timeout";
  if (raw.outcome === "cancelled") return CANCELLED;
  if (raw.outcome === "selected" && identifier(raw.optionId, 128)) {
    return { outcome: "selected", optionId: raw.optionId };
  }
  return null;
}

function scheduleDefault(callback: () => void, milliseconds: number): () => void {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
}

/**
 * Instantiate once per owned ACP stdio connection. Call receive() before the
 * client's generic capability handler and cleanup() before ending stdin.
 */
export class AcpPermissionAdapter {
  private readonly seen = new Set<string>();
  private readonly pending = new Map<string, (resolution?: "timeout") => void>();
  private closed = false;

  constructor(private readonly options: AcpPermissionAdapterOptions) {}

  /**
   * True only for session/request_permission, including malformed requests we
   * have denied. Other methods remain for AcpClient's existing fail-closed path.
   */
  receive(message: unknown): boolean {
    if (!record(message) || message.method !== "session/request_permission") return false;

    const id = rpcId(message.id);
    const active = this.options.activeSessionId();
    if (id === null) {
      this.emit({
        requestId: "invalid",
        turnId: this.options.turnId,
        sessionId: active ?? "",
        outcome: "denied",
      });
      return true; // No legal JSON-RPC id to echo.
    }

    const key = requestKey(id);
    if (this.seen.has(key)) return true; // One response per original id.
    this.seen.add(key);

    const base = { requestId: key, turnId: this.options.turnId, sessionId: active ?? "" };
    const params = record(message.params) ? message.params : null;
    const offered = params ? parseOptions(params.options) : null;
    if (this.closed || message.jsonrpc !== "2.0" || !identifier(active, 256) ||
      !identifier(this.options.turnId, 256) || !identifier(this.options.principalId, 256) ||
      !params || params.sessionId !== active || !offered || !this.options.broker) {
      this.reply(id, CANCELLED, { ...base, outcome: "denied" });
      return true;
    }

    const request: AcpPermissionBrokerRequest = {
      ...base,
      principalId: this.options.principalId,
      options: offered,
    };
    let finished = false;
    let stopTimer: (() => void) | undefined;
    let unregister: (() => void) | undefined;

    const finish = (outcome: AcpPermissionOutcome, resolution: Resolution): void => {
      if (finished) return;
      finished = true;
      this.pending.delete(key);
      stopTimer?.();
      try { unregister?.(); } catch { /* the permission still settles safely */ }
      const optionId = outcome.outcome === "selected" ? outcome.optionId : undefined;
      this.reply(id, outcome, {
        ...base,
        outcome: resolution,
        ...(optionId === undefined ? {} : { optionId }),
      });
    };

    this.pending.set(key, reason => finish(CANCELLED, reason ?? "denied"));
    try {
      const rawTimeout = this.options.timeoutMs;
      const timeoutMs = typeof rawTimeout === "number" && Number.isFinite(rawTimeout)
        ? Math.min(ACP_PERMISSION_TIMEOUT_MS, Math.max(1, rawTimeout))
        : ACP_PERMISSION_TIMEOUT_MS;
      stopTimer = (this.options.schedule ?? scheduleDefault)(
        () => finish(CANCELLED, "timeout"), timeoutMs,
      );
      // A custom scheduler may have expired synchronously during registration.
      if (finished) {
        stopTimer();
        return true;
      }
      let registering = true;
      let earlyDecision: unknown;
      let hasEarlyDecision = false;
      const onDecision = (rawDecision: unknown): void => {
        // Do not accept synchronous decisions until registration confirms that
        // an authenticated controller exists (a non-null unsubscribe).
        if (registering) {
          if (!hasEarlyDecision) {
            hasEarlyDecision = true;
            earlyDecision = rawDecision;
          }
          return;
        }
        if (finished) return;
        if (this.closed || this.options.activeSessionId() !== active) {
          finish(CANCELLED, "denied");
          return;
        }
        const decision = parseDecision(rawDecision);
        if (decision === "timeout") { finish(CANCELLED, "timeout"); return; }
        if (!decision || decision.outcome === "cancelled") { finish(CANCELLED, "denied"); return; }
        const chosen = offered.find(option => option.optionId === decision.optionId);
        if (!chosen) { finish(CANCELLED, "denied"); return; }
        finish(decision, chosen.kind.startsWith("reject_") ? "denied" : "allowed");
      };
      const unsubscribe = this.options.broker.register(request, onDecision);
      registering = false;
      if (unsubscribe === null) finish(CANCELLED, "denied");
      else {
        unregister = unsubscribe;
        if (hasEarlyDecision) onDecision(earlyDecision);
      }
    } catch {
      // No controller, throwing broker or scheduling failure must never approve.
      finish(CANCELLED, "denied");
    }
    return true;
  }

  /** Flush pending denials before AcpClient shuts down its stdio transport. */
  cleanup(): void {
    if (this.closed) return;
    this.closed = true;
    for (const finish of [...this.pending.values()]) finish();
  }

  private reply(id: AcpPermissionRpcId, outcome: AcpPermissionOutcome, resolution: AcpPermissionResolution): void {
    let sent = false;
    try {
      this.options.send({ jsonrpc: "2.0", id, result: { outcome } });
      sent = true;
    } catch { /* closed transport: never retry an ambiguous approval */ }
    this.emit(sent ? resolution : { ...resolution, outcome: "denied", optionId: undefined });
  }

  private emit(resolution: AcpPermissionResolution): void {
    try { this.options.resolved(resolution); }
    catch { /* UI observer cannot authorize, retry or interrupt ACP cleanup */ }
  }
}
