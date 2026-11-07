import type { AssistantMessage } from "../model";

/** Local streaming/queued state exists before transport acceptance. It is not a receipt. */
export function annotationReceipt(reply: Pick<AssistantMessage, "state" | "delivery"> | undefined): "pending" | "accepted" | "final" | "failed" {
  if (!reply) return "pending";
  if (reply.state === "error" || reply.state === "interrupted") return "failed";
  if (reply.state === "done") return "final";
  return reply.delivery === "started" ? "accepted" : "pending";
}
