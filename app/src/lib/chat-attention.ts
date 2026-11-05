import type { Conversation } from "../model";
export function chatAttention(chat: Conversation): "Needs attention" | "Running" | null {
  if (chat.stale) return null;
  const last = chat.messages.at(-1);
  if (last?.role !== "assistant") return null;
  if (last.state === "error" || last.state === "interrupted") return "Needs attention";
  if (last.state === "streaming" || last.state === "pending") return "Running";
  return null;
}
export function chatPriority(chat: Conversation): number {
  const attention = chatAttention(chat);
  return attention === "Needs attention" ? 0 : attention === "Running" ? 1 : chat.stale ? 3 : 2;
}
