// Additive, version-1-compatible delivery wire contract.
// This module has no runtime import of protocol.ts so Hermes may register it there
// without creating a circular dependency.
import type { ClientMessage } from "./protocol";

/** Max UTF-16 code units for opaque send and turn identities. */
export const MAX_DELIVERY_ID_LENGTH = 128;

export type DeliveryStage = "acked-by-bridge" | "started";

/**
 * Bridge-authored evidence about one send. Receipt validation does not prove
 * authenticity; the authenticated socket and principal-scoped admission ledger
 * must provide that guarantee before consumers apply a receipt.
 */
export interface DeliveryReceipt {
  type: "delivery_receipt";
  clientId: string;
  /** The legacy chat.id, kept stable through retry and replay. */
  turnId: string;
  stage: DeliveryStage;
  /** Bridge event timestamp in milliseconds since the Unix epoch. */
  at: number;
}

/**
 * Additive chat fields. Old clients omit clientId; a retry of the same user
 * send must reuse both clientId and the existing chat.id (turnId).
 */
export interface DeliveryChatExtension {
  clientId?: string;
}

export type DeliveryChatMessage = Extract<ClientMessage, { type: "chat" }> & DeliveryChatExtension;

/** An optional additive capability on the bridge's existing hello message. */
export interface DeliveryHelloExtension {
  capabilities?: {
    deliveryReceipts?: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject missing, oversized, or whitespace/control-containing identities. */
export function isDeliveryId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DELIVERY_ID_LENGTH &&
    !/[\s\u0000-\u001f\u007f]/u.test(value)
  );
}

/** Parse a receipt into a fresh object containing only validated wire fields. */
export function parseDeliveryReceipt(raw: unknown): DeliveryReceipt | null {
  if (
    !isRecord(raw) ||
    raw.type !== "delivery_receipt" ||
    !isDeliveryId(raw.clientId) ||
    !isDeliveryId(raw.turnId) ||
    (raw.stage !== "acked-by-bridge" && raw.stage !== "started") ||
    typeof raw.at !== "number" ||
    !Number.isFinite(raw.at) ||
    raw.at < 0
  ) return null;

  return {
    type: "delivery_receipt",
    clientId: raw.clientId,
    turnId: raw.turnId,
    stage: raw.stage,
    at: raw.at,
  };
}

/**
 * Parse just the additive fields of a chat frame; the existing
 * parseClientMessage must also validate the complete legacy chat payload.
 *
 * Returns {} for valid legacy identities with no clientId. Returns null when
 * an explicitly supplied extension is invalid, so it cannot be silently
 * stripped by the old parser. Do not use this as a full chat parser.
 */
export function parseDeliveryChatExtension(raw: unknown): DeliveryChatExtension | null {
  if (!isRecord(raw) || raw.type !== "chat" || !isDeliveryId(raw.id)) return null;
  if (raw.clientId === undefined) return {};
  if (!isDeliveryId(raw.clientId)) return null;
  return { clientId: raw.clientId };
}

/**
 * Call only after the existing hello parser accepts the frame.
 * Missing or unsupported capabilities are never evidence of an ack.
 */
export function helloSupportsDeliveryReceipts(raw: unknown): boolean {
  if (!isRecord(raw) || raw.type !== "hello" || !isRecord(raw.capabilities)) return false;
  return raw.capabilities.deliveryReceipts === true;
}
