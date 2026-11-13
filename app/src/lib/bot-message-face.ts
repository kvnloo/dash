import type { Message } from "../model";

/** The final assistant in a consecutive run owns its face; hidden queued rows do not count. */
export function assistantFaceIds(messages: readonly Message[]): Set<string> {
  const visible = messages.filter(message => message.role === "user" || (message.delivery !== "steered" && !(message.delivery === "queued" && message.state === "streaming")));
  return new Set(visible.filter((message, index) => message.role === "assistant" && visible[index + 1]?.role !== "assistant").map(message => message.id));
}
