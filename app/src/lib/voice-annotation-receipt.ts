import type { AssistantMessage } from "../model";

/** beginTurn's empty seq-0 placeholder is local; a bridge event or streamed content is acceptance. */
export function annotationReceipt(reply: Pick<AssistantMessage, "state" | "delivery" | "seq" | "text" | "parts"> | undefined): "pending" | "accepted" | "final" | "failed" {
  if (!reply) return "pending";
  if (reply.state === "error" || reply.state === "interrupted") return "failed";
  if (reply.state === "done") return "final";
  if (reply.seq > 0 || reply.text.length > 0 || (reply.parts?.length ?? 0) > 0) return "accepted";
  return reply.delivery === "started" || reply.delivery === "queued" || reply.delivery === "steered" ? "accepted" : "pending";
}
