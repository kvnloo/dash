// Principal-scoped bridge admission. Pure orchestration: no storage or runtime
// globals are opened here. Hermes supplies an authenticated principal, a durable
// ledger and a start callback after validating the chat's destination.
import { createHash, randomUUID } from "node:crypto";
import type { ChatAttachment, ClientMessage } from "../../shared/protocol";
import type { BridgePrincipal } from "./z0bridge-identity";

export type DeliveryAdmissionState = "admitted" | "started" | "terminal" | "unknown";

export interface DeliveryAdmissionTarget {
  hostId?: string;
  profileId?: string;
  sessionId?: string;
  harness: string;
  cwd?: string;
}

export interface DeliveryAdmissionInput {
  /** From the authenticated socket only, never a field supplied by the phone. */
  principal: BridgePrincipal;
  clientId: string;
  /** The existing chat.id; never mint a new turn id on retry. */
  turnId: string;
  target: DeliveryAdmissionTarget;
  mode?: "queue" | "steer";
  text: string;
  attachments?: readonly ChatAttachment[];
  summariesEnabled?: boolean;
}

/** Only identifiers, scope and a hash are persisted; not tokens or message text. */
export interface DeliveryAdmissionRecord {
  principalScope: string;
  clientId: string;
  turnId: string;
  receiptId: string;
  fingerprint: string;
  state: DeliveryAdmissionState;
  admittedAt: number;
  updatedAt: number;
}

/**
 * Durable store contract for #124's file-backed ledger adapter:
 * - reserve is an ATOMIC insert-if-absent per (principalScope, clientId).
 * - created=true is legal only after the reservation is durably committed.
 * - update is an ATOMIC durable compare-and-swap on the previous state.
 * - get never invents an empty ledger on corruption or I/O failure.
 * Rejections (including a write that may have committed before throwing) must
 * propagate. No callback is started until reserve confirms durability.
 */
export interface DeliveryAdmissionLedger {
  get(principalScope: string, clientId: string): Promise<DeliveryAdmissionRecord | null>;
  reserve(candidate: DeliveryAdmissionRecord): Promise<{ record: DeliveryAdmissionRecord; created: boolean }>;
  update(next: DeliveryAdmissionRecord, expected: DeliveryAdmissionState): Promise<DeliveryAdmissionRecord>;
}

/** Safe for acknowledgement to the same authenticated principal. */
export interface DeliveryAdmissionReceipt {
  clientId: string;
  turnId: string;
  receiptId: string;
  state: DeliveryAdmissionState;
  at: number;
  replay: boolean;
  /** An admitted record on recovery might already have executed. Never restart it. */
  reconciliationRequired: boolean;
}

export class DeliveryAdmissionConflict extends Error {
  constructor() {
    super("Client id already admitted with a different payload");
    this.name = "DeliveryAdmissionConflict";
  }
}

function boundedId(value: string, label: string): void {
  if (!value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Invalid " + label);
  }
}

/**
 * The identity subject is stable across JWT refreshes. The legacy bearer is a
 * single shared credential, hence one shared scope, not per-socket or per-IP.
 * Never include the access token in a key, receipt or persisted row.
 */
export function deliveryPrincipalScope(principal: BridgePrincipal): string {
  if (principal.kind === "legacy") return "legacy:shared";
  boundedId(principal.subject, "authenticated subject");
  return "identity:" + principal.subject;
}

/** Canonical positional encoding avoids omitted/undefined property ambiguity. */
export function deliveryFingerprint(input: DeliveryAdmissionInput): string {
  return createHash("sha256").update(JSON.stringify([
    "dash-delivery-v1",
    input.turnId,
    input.target.hostId ?? null,
    input.target.profileId ?? null,
    input.target.sessionId ?? null,
    input.target.harness,
    input.target.cwd ?? null,
    input.mode ?? "queue",
    input.text,
    (input.attachments ?? []).map(attachment => attachment.id),
    input.summariesEnabled ?? false,
  ])).digest("hex");
}

/**
 * Adapter for the existing chat frame plus #122's additive clientId field.
 * Hermes must keep the same id/clientId on replay and invoke this with
 * ws.data.principal AFTER destination validation, not raw wire principal data.
 */
export type ChatWithClientId = Extract<ClientMessage, { type: "chat" }> & { clientId?: string };

export function deliveryInputFromChat(
  principal: BridgePrincipal,
  message: ChatWithClientId,
): DeliveryAdmissionInput {
  return {
    principal,
    clientId: message.clientId ?? message.id,
    turnId: message.id,
    target: {
      harness: message.harness,
      hostId: message.hostId,
      profileId: message.profileId,
      sessionId: message.sessionId,
      cwd: message.cwd,
    },
    mode: message.mode,
    text: message.text,
    attachments: message.attachments,
    summariesEnabled: message.summariesEnabled,
  };
}

function receiptFor(row: DeliveryAdmissionRecord, replay: boolean): DeliveryAdmissionReceipt {
  return {
    clientId: row.clientId,
    turnId: row.turnId,
    receiptId: row.receiptId,
    state: row.state,
    at: row.updatedAt,
    replay,
    reconciliationRequired: row.state === "admitted" || row.state === "unknown",
  };
}

function sameReservation(
  row: DeliveryAdmissionRecord,
  scope: string,
  clientId: string,
  fingerprint: string,
  turnId: string,
): void {
  if (row.principalScope !== scope || row.clientId !== clientId) {
    throw new Error("Admission ledger returned a record outside the authenticated scope");
  }
  if (row.fingerprint !== fingerprint || row.turnId !== turnId) throw new DeliveryAdmissionConflict();
}

export class DeliveryAdmissionController {
  private readonly inFlight = new Map<
    string,
    { fingerprint: string; promise: Promise<DeliveryAdmissionReceipt> }
  >();

  constructor(
    private readonly ledger: DeliveryAdmissionLedger,
    private readonly start: (input: DeliveryAdmissionInput, admitted: DeliveryAdmissionReceipt) => Promise<void> | void,
    private readonly now: () => number = Date.now,
    private readonly newReceiptId: () => string = randomUUID,
  ) {}

  private stamp(earliest = 0): number {
    const time = this.now();
    if (!Number.isFinite(time) || time < 0) throw new Error("Invalid admission clock");
    return Math.max(time, earliest);
  }

  /**
   * Only the winner of a durable reservation may call start. Every other path
   * (a racing socket, lost acknowledgement, restart or ambiguous failure) is a
   * receipt lookup, NOT a second execution.
   */
  async admit(input: DeliveryAdmissionInput): Promise<DeliveryAdmissionReceipt> {
    boundedId(input.clientId, "client id");
    boundedId(input.turnId, "turn id");
    boundedId(input.target.harness, "harness");
    const scope = deliveryPrincipalScope(input.principal);
    const fingerprint = deliveryFingerprint(input);
    const key = JSON.stringify([scope, input.clientId]);
    const pending = this.inFlight.get(key);
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new DeliveryAdmissionConflict();
      return { ...await pending.promise, replay: true };
    }
    const task = this.reserveThenStart(input, scope, fingerprint);
    this.inFlight.set(key, { fingerprint, promise: task });
    try {
      return await task;
    } finally {
      if (this.inFlight.get(key)?.promise === task) this.inFlight.delete(key);
    }
  }

  private async reserveThenStart(
    input: DeliveryAdmissionInput,
    scope: string,
    fingerprint: string,
  ): Promise<DeliveryAdmissionReceipt> {
    const time = this.stamp();
    const candidate: DeliveryAdmissionRecord = {
      principalScope: scope,
      clientId: input.clientId,
      turnId: input.turnId,
      fingerprint,
      receiptId: this.newReceiptId(),
      state: "admitted",
      admittedAt: time,
      updatedAt: time,
    };
    // Must finish the durable insert before even invoking the attachment/start callback.
    const reservation = await this.ledger.reserve(candidate);
    const row = reservation.record;
    sameReservation(row, scope, input.clientId, fingerprint, input.turnId);
    if (!reservation.created) return receiptFor(row, true);

    try {
      await this.start(input, receiptFor(row, false));
    } catch {
      // The callback might have spawned before throwing. Never free this key.
      const unknown = await this.transition(row, "unknown");
      return receiptFor(unknown, false);
    }
    // A successful callback is not a durable "started" receipt until this write.
    const started = await this.transition(row, "started");
    return receiptFor(started, false);
  }

  private async transition(
    row: DeliveryAdmissionRecord,
    state: DeliveryAdmissionState,
  ): Promise<DeliveryAdmissionRecord> {
    try {
      const next = { ...row, state, updatedAt: this.stamp(row.updatedAt) };
      const saved = await this.ledger.update(next, row.state);
      sameReservation(saved, row.principalScope, row.clientId, row.fingerprint, row.turnId);
      return saved;
    } catch (error) {
      // Completion can race a synchronous start callback. A durable terminal
      // record is authoritative; I/O failures remain visible, never swallowed.
      const current = await this.ledger.get(row.principalScope, row.clientId);
      if (current && current.state === "terminal" && current.receiptId === row.receiptId) return current;
      throw error;
    }
  }

  /** Scoped recovery/read: callers cannot look up another subject's receipt. */
  async lookup(principal: BridgePrincipal, clientId: string): Promise<DeliveryAdmissionReceipt | null> {
    boundedId(clientId, "client id");
    const scope = deliveryPrincipalScope(principal);
    const row = await this.ledger.get(scope, clientId);
    if (!row) return null;
    if (row.principalScope !== scope || row.clientId !== clientId) {
      throw new Error("Admission ledger returned a record outside the authenticated scope");
    }
    return receiptFor(row, true);
  }

  /** Only call with actual harness completion/reconciliation evidence. */
  async markTerminal(principal: BridgePrincipal, clientId: string): Promise<DeliveryAdmissionReceipt | null> {
    boundedId(clientId, "client id");
    const scope = deliveryPrincipalScope(principal);
    const row = await this.ledger.get(scope, clientId);
    if (!row) return null;
    if (row.principalScope !== scope || row.clientId !== clientId) {
      throw new Error("Admission ledger returned a record outside the authenticated scope");
    }
    if (row.state === "terminal") return receiptFor(row, true);
    const terminal = await this.transition(row, "terminal");
    return receiptFor(terminal, true);
  }

  /** Persist an ambiguous outcome; recovery must reconcile, never restart. */
  async markUnknown(principal: BridgePrincipal, clientId: string): Promise<DeliveryAdmissionReceipt | null> {
    boundedId(clientId, "client id");
    const scope = deliveryPrincipalScope(principal);
    const row = await this.ledger.get(scope, clientId);
    if (!row) return null;
    if (row.principalScope !== scope || row.clientId !== clientId) {
      throw new Error("Admission ledger returned a record outside the authenticated scope");
    }
    if (row.state === "terminal" || row.state === "unknown") return receiptFor(row, true);
    const unknown = await this.transition(row, "unknown");
    return receiptFor(unknown, true);
  }
}
