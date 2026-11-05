import type { ChatAttachment } from "../../../shared/protocol";

/**
 * A delivery attempt is not bridge admission. This module has no timers, socket access,
 * persistence, or UI effects; the app supplies observed times and authenticated events.
 */
export type DeliveryPhase = "queued" | "sent" | "acked-by-bridge" | "started";
export type DeliveryStatus =
  | "ready"
  | "awaiting-ack"
  | "retry-needed"
  | "reconcile-required"
  | "accepted"
  | "started"
  | "rejected";

export interface DeliveryTarget {
  readonly harness: string;
  readonly hostId?: string;
  readonly profileId?: string;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly mode?: "queue" | "steer";
}

export interface DeliveryPayload {
  readonly text: string;
  readonly summariesEnabled?: boolean;
  readonly attachments?: readonly Readonly<ChatAttachment>[];
}

export interface DeliveryIdentity {
  readonly clientId: string;
  readonly turnId: string;
  readonly conversationId: string;
  readonly target: DeliveryTarget;
}

export interface DeliveryFailure {
  readonly kind: "transport" | "timeout" | "disconnected" | "not-admitted" | "rejected";
  readonly at: number;
  readonly message: string;
}

export interface DeliveryRecord extends DeliveryIdentity {
  readonly payload: DeliveryPayload;
  /** Highest proven phase. A safe retransmission never moves it backwards. */
  readonly phase: DeliveryPhase;
  /** Whether to send, await a receipt, reconcile, or stop. */
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastAttemptAt?: number;
  readonly sentAt?: number;
  readonly acknowledgedAt?: number;
  readonly startedAt?: number;
  readonly failure?: DeliveryFailure;
}

export interface NewDelivery extends DeliveryIdentity {
  readonly payload: DeliveryPayload;
  readonly at: number;
}

/**
 * All events carry the immutable local scope. A raw wire receipt (#122) only
 * includes clientId/turnId/stage/at: its trusted conversation and target must
 * be supplied by the authenticated socket/turn association, never guessed.
 */
export type DeliveryEvent = DeliveryIdentity & (
  | { readonly type: "transport"; readonly accepted: boolean; readonly at: number }
  | { readonly type: "receipt"; readonly stage: "acked-by-bridge" | "started"; readonly at: number }
  | { readonly type: "rejected"; readonly message: string; readonly at: number }
  | { readonly type: "timeout"; readonly at: number }
  | { readonly type: "disconnect"; readonly at: number }
  | {
      readonly type: "reconcile";
      /** An authoritative durable bridge admission lookup, not a socket guess. */
      readonly outcome: "unknown" | "not-admitted" | "acked-by-bridge" | "started" | "rejected";
      readonly at: number;
      readonly message?: string;
    }
  | { readonly type: "retry"; readonly at: number }
);

function validTime(at: number): boolean {
  return Number.isFinite(at) && at >= 0;
}

function validId(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function snapshotTarget(input: DeliveryTarget): DeliveryTarget {
  return Object.freeze({
    harness: input.harness,
    ...(input.hostId !== undefined ? { hostId: input.hostId } : {}),
    ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
  });
}

function snapshotPayload(input: DeliveryPayload): DeliveryPayload {
  const attachments = input.attachments?.map((item) =>
    Object.freeze({ id: item.id, name: item.name, mime: item.mime, size: item.size })
  );
  return Object.freeze({
    text: input.text,
    ...(input.summariesEnabled !== undefined ? { summariesEnabled: input.summariesEnabled } : {}),
    ...(attachments !== undefined ? { attachments: Object.freeze(attachments) } : {}),
  });
}

export function createDelivery(input: NewDelivery): DeliveryRecord {
  if (!validId(input.clientId) || !validId(input.turnId) || !validId(input.conversationId) ||
      !validId(input.target.harness) || !validTime(input.at)) {
    throw new Error("Delivery identity and timestamp must be valid");
  }
  const record: DeliveryRecord = {
    clientId: input.clientId,
    turnId: input.turnId,
    conversationId: input.conversationId,
    target: snapshotTarget(input.target),
    payload: snapshotPayload(input.payload),
    phase: "queued",
    status: "ready",
    attempts: 0,
    createdAt: input.at,
    updatedAt: input.at,
  };
  return Object.freeze(record);
}

export function deliveryIdentity(record: DeliveryRecord): DeliveryIdentity {
  return {
    clientId: record.clientId,
    turnId: record.turnId,
    conversationId: record.conversationId,
    target: record.target,
  };
}

function sameTarget(left: DeliveryTarget, right: DeliveryTarget): boolean {
  return left.harness === right.harness &&
    left.hostId === right.hostId &&
    left.profileId === right.profileId &&
    left.sessionId === right.sessionId &&
    left.cwd === right.cwd &&
    left.mode === right.mode;
}

function matches(record: DeliveryRecord, event: DeliveryEvent): boolean {
  return record.clientId === event.clientId &&
    record.turnId === event.turnId &&
    record.conversationId === event.conversationId &&
    sameTarget(record.target, event.target);
}

function phaseRank(phase: DeliveryPhase): number {
  switch (phase) {
    case "queued": return 0;
    case "sent": return 1;
    case "acked-by-bridge": return 2;
    case "started": return 3;
  }
}

function changed(record: DeliveryRecord, at: number, patch: Partial<DeliveryRecord>): DeliveryRecord {
  return Object.freeze({ ...record, ...patch, updatedAt: Math.max(record.updatedAt, at) });
}

function admit(record: DeliveryRecord, at: number, stage: "acked-by-bridge" | "started"): DeliveryRecord {
  if (phaseRank(stage) <= phaseRank(record.phase)) return record;
  return changed(record, at, {
    phase: stage,
    status: stage === "started" ? "started" : "accepted",
    ...(stage === "started" ? { startedAt: at } : { acknowledgedAt: at }),
    failure: undefined,
  });
}

function failure(kind: DeliveryFailure["kind"], at: number, message: string): DeliveryFailure {
  return Object.freeze({ kind, at, message });
}

function deny(record: DeliveryRecord, at: number, message: string): DeliveryRecord {
  return changed(record, at, {
    status: "rejected",
    failure: failure("rejected", at, message),
  });
}

/**
 * Pure transition reducer. Unknown admission never authorizes another send:
 * callers must reconcile against the durable bridge ledger first. Retrying
 * keeps clientId, turnId, conversationId, target, and payload unchanged.
 */
export function reduceDelivery(record: DeliveryRecord, event: DeliveryEvent): DeliveryRecord {
  if (!matches(record, event) || !validTime(event.at) || event.at < record.createdAt) return record;

  switch (event.type) {
    case "transport":
      if (record.status !== "ready" || event.at < record.updatedAt) return record;
      return changed(record, event.at, {
        phase: event.accepted ? "sent" : record.phase,
        status: event.accepted ? "awaiting-ack" : "retry-needed",
        attempts: record.attempts + 1,
        lastAttemptAt: event.at,
        ...(event.accepted ? { sentAt: event.at } : {}),
        failure: event.accepted ? undefined : failure("transport", event.at, "Socket did not accept the send"),
      });

    case "receipt":
      // An unsolicited receipt cannot advance a record with no successful send.
      if (record.phase === "queued" || record.status === "rejected") return record;
      return admit(record, event.at, event.stage);

    case "rejected":
      if (record.phase !== "sent" || record.status === "rejected") return record;
      return deny(record, event.at, event.message);

    case "timeout":
      if (record.status !== "awaiting-ack" ||
          event.at < (record.lastAttemptAt ?? record.createdAt)) return record;
      return changed(record, event.at, {
        status: "reconcile-required",
        failure: failure("timeout", event.at, "Bridge receipt missing; execution outcome unknown"),
      });

    case "disconnect":
      if ((record.status !== "ready" && record.status !== "awaiting-ack") ||
          event.at < record.updatedAt) return record;
      return changed(record, event.at, {
        status: record.status === "awaiting-ack" ? "reconcile-required" : "retry-needed",
        failure: failure("disconnected", event.at, record.status === "awaiting-ack"
          ? "Socket closed before bridge receipt; execution outcome unknown"
          : "Connection closed before send"),
      });

    case "reconcile":
      if (record.status !== "reconcile-required" || event.outcome === "unknown" ||
          event.at < record.updatedAt) return record;
      if (event.outcome === "not-admitted") {
        return changed(record, event.at, {
          status: "retry-needed",
          failure: failure("not-admitted", event.at, event.message ?? "Bridge confirms turn was not admitted"),
        });
      }
      if (event.outcome === "rejected") return deny(record, event.at, event.message ?? "Bridge rejected turn");
      return admit(record, event.at, event.outcome);

    case "retry":
      if (record.status !== "retry-needed" || event.at < record.updatedAt) return record;
      return changed(record, event.at, { status: "ready", failure: undefined });
  }
}

/** UI/controller decision; reconcile-required is not permission to resend. */
export function deliveryAction(record: DeliveryRecord): "send" | "retry" | "reconcile" | "none" {
  switch (record.status) {
    case "ready": return "send";
    case "retry-needed": return "retry";
    case "reconcile-required": return "reconcile";
    default: return "none";
  }
}
