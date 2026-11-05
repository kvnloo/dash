import type { UserMessage } from "../model";
import type { OutboxRecord, OutboxStage } from "../store/outbox";
import type { DeliveryStage } from "./delivery-status";

export interface MessageDeliveryProps {
  stage: DeliveryStage;
  retryNeeded: boolean;
  retryBusy: boolean;
  note: string | null;
}

const STARTED_VISIBLE_MS = 5_000;

function note(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function outboxStage(stage: OutboxStage): DeliveryStage {
  switch (stage) {
    case "queued":
      return "queued";
    case "sent":
      return "sending"; // Socket acceptance is not a bridge acknowledgement.
    case "acked-by-bridge":
      return "received";
    case "started":
      return "started";
    default: {
      const exhaustive: never = stage;
      return exhaustive;
    }
  }
}

function legacyStage(delivery: NonNullable<UserMessage["delivery"]>): DeliveryStage {
  switch (delivery) {
    case "failed":
      return "sending";
    case "started":
    case "steered":
      return "started";
    case "queued":
    case "steering":
      return "queued";
    default: {
      const exhaustive: never = delivery;
      return exhaustive;
    }
  }
}

/**
 * Pure projection of an existing user bubble and its persisted delivery record.
 * The caller must match the record to the bubble before passing it in. Outbox
 * receipts take precedence over stale legacy message.delivery flags.
 */
export function messageDeliveryProps(
  message: UserMessage,
  record: OutboxRecord | undefined,
  options: { retryBusy: boolean; now: number },
): MessageDeliveryProps | null {
  if (record) {
    const stage = outboxStage(record.stage);
    // receiptAt records when the bridge reported "started"; updatedAt is the
    // fallback for older records without that timestamp.
    if (stage === "started" && options.now - (record.receiptAt ?? record.updatedAt) > STARTED_VISIBLE_MS) {
      return null;
    }
    return {
      stage,
      retryNeeded: record.retryNeeded === true,
      retryBusy: options.retryBusy,
      note: note(record.error),
    };
  }

  if (message.delivery === undefined) return null;
  const stage = legacyStage(message.delivery);
  if (stage === "started" && options.now - (message.deliveryAt ?? message.at) > STARTED_VISIBLE_MS) {
    return null;
  }
  return {
    stage,
    retryNeeded: message.delivery === "failed",
    retryBusy: options.retryBusy,
    note: note(message.deliveryNote),
  };
}

/** Stable retry identity: never mint a new clientId or turnId on a retry. */
export function retryKey(record: Pick<OutboxRecord, "clientId" | "turnId">): string {
  return `${record.clientId}:${record.turnId}`;
}
