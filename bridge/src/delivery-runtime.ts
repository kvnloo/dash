import { DeliveryLedger } from "./delivery-ledger";
import { deliveryFingerprint, deliveryInputFromChat, deliveryPrincipalScope } from "./delivery-dedupe";
import type { BridgePrincipal } from "./z0bridge-identity";
import type { ClientMessage } from "../../shared/protocol";
import type { DeliveryReceipt } from "../../shared/delivery";

type Chat = Extract<ClientMessage, { type: "chat" }>;

/** Serialize admission, not execution. A restarted reservation never licenses a second start. */
export class DeliveryRuntime {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly ledger: DeliveryLedger) {}

  admit(principal: BridgePrincipal, message: Chat, receipt: (value: DeliveryReceipt) => void,
    start: (started: () => void) => void): Promise<boolean> {
    const operation = this.tail.then(async () => {
      if (!message.clientId) { start(() => {}); return true; }
      const input = deliveryInputFromChat(principal, message);
      const key = { principalId: deliveryPrincipalScope(principal), clientId: message.clientId };
      const fingerprint = deliveryFingerprint(input);
      const previous = await this.ledger.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.turnId !== message.id) throw new Error("Delivery identity already belongs to a different send.");
        receipt(previous.receipt);
        return false;
      }
      const reserved = await this.ledger.reserve({ ...key, turnId: message.id, fingerprint, at: Date.now() });
      receipt(reserved.receipt);
      let reported = false;
      try {
        start(() => {
          if (reported) return;
          reported = true;
          void this.ledger.update(key, { state: "started", at: Date.now() }).then(row => receipt(row.receipt)).catch(error => console.warn("Delivery start receipt unavailable", error));
        });
      } catch (error) {
        await this.ledger.update(key, { state: "unknown", at: Date.now() });
        throw error;
      }
      return true;
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
