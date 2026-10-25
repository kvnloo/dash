import type { Message } from "../model";
/** Undefined means pending/unknown; empty means terminal without a speakable final. */
export function finalVoiceReply(messages: readonly Message[], turnId: string): string | undefined {
  const reply = messages.find(message => message.role === "assistant" && message.turnId === turnId);
  if (!reply || reply.role !== "assistant") return undefined;
  if (reply.state === "error" || reply.state === "interrupted") return "";
  return reply.state === "done" ? reply.text.trim() : undefined;
}
