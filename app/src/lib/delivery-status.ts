/** Presentation-only view model for the durable delivery workflow.
 * This does not send, dedupe, or infer acknowledgement from socket success.
 * "sending" means waiting for an explicit bridge receipt, even if socket.send returned.
 */
export type DeliveryStage = "queued" | "sending" | "received" | "started";
export type DeliveryTone = "quiet" | "warning" | "confirmed";

export interface DeliveryStatusInput {
  stage: DeliveryStage;
  retryNeeded: boolean;
  retryBusy: boolean;
  note?: string | null;
}

export interface DeliveryStatusView {
  label: string;
  helper: string;
  note: string | null;
  tone: DeliveryTone;
  retryVisible: boolean;
  retryDisabled: boolean;
  retryBusy: boolean;
  accessibilityLabel: string;
}

const UNCONFIRMED_HELPER =
  "Delivery is unconfirmed. The bridge may already have received this message. Retry with the same client and turn IDs; do not create a second turn.";

function statusView(
  label: string,
  helper: string,
  tone: DeliveryTone,
  retryVisible: boolean,
  retryBusy: boolean,
  note: string | null,
): DeliveryStatusView {
  return {
    label,
    helper,
    note,
    tone,
    retryVisible,
    retryDisabled: !retryVisible || retryBusy,
    retryBusy: retryVisible && retryBusy,
    accessibilityLabel: [label, helper, note].filter(Boolean).join(" "),
  };
}

/** An explicit receipt outranks a stale timeout/drop flag. */
export function describeDeliveryStatus(input: DeliveryStatusInput): DeliveryStatusView {
  const note = input.note?.trim() || null;
  if (input.retryNeeded && (input.stage === "queued" || input.stage === "sending")) {
    return statusView("Not sent · Retry", UNCONFIRMED_HELPER, "warning", true, input.retryBusy, note);
  }

  switch (input.stage) {
    case "queued":
      return statusView("Queued", "Waiting in the local outbox to be sent to the bridge.", "quiet", false, false, note);
    case "sending":
      return statusView("Sending", "Waiting for an explicit bridge receipt. Sending does not confirm delivery.", "quiet", false, false, note);
    case "received":
      return statusView("Received by bridge", "The bridge acknowledged receipt; execution has not been confirmed yet.", "confirmed", false, false, note);
    case "started":
      return statusView("Started", "The bridge reported that execution started; completion is not implied.", "confirmed", false, false, note);
    default: {
      const exhaustive: never = input.stage;
      return exhaustive;
    }
  }
}

/** Gate both the controlled busy flag and an immediate local tap latch. */
export function canRequestDeliveryRetry(status: DeliveryStatusView, locallyRequested: boolean): boolean {
  return status.retryVisible && !status.retryDisabled && !locallyRequested;
}
