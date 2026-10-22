import { MAX_ATTACHMENTS_PER_TURN } from "../../../shared/protocol";
import type { Conversation, Message, UserMessage, AssistantMessage } from "../model";

export interface QueuedPart { user: UserMessage; assistant: AssistantMessage }

/** Pending pairs are the durable queue. Never infer a queue from delivery receipts. */
export function queuedParts(conversation: Conversation): QueuedPart[] {
  return conversation.messages.flatMap((message, index) => {
    const user = conversation.messages[index - 1];
    return message.role === "assistant" && message.state === "pending" && user?.role === "user"
      ? [{ user, assistant: message }] : [];
  });
}

export function queueMergeError(conversation: Conversation): string | undefined {
  return queuedParts(conversation).flatMap(part => part.user.attachments ?? []).length > MAX_ATTACHMENTS_PER_TURN
    ? "Over 8 attachments: remove messages or turn off combined delivery." : undefined;
}

export function mergedQueue(parts: QueuedPart[]): string {
  return parts.map(part => part.user.text).join("\n\n");
}

/** Preserve the first turn identity; attachments and text retain queue order. */
export function combineQueued(conversation: Conversation, text = mergedQueue(queuedParts(conversation))): Conversation {
  const parts = queuedParts(conversation);
  const first = parts[0];
  if (!first) return conversation;
  const removed = new Set(parts.slice(1).flatMap(part => [part.user.id, part.assistant.id]));
  const attachments = parts.flatMap(part => part.user.attachments ?? []);
  return { ...conversation, messages: conversation.messages.filter(message => !removed.has(message.id)).map(message =>
    message.id === first.user.id ? { ...first.user, text, attachments } : message), queuePreview: undefined };
}

export function reorderQueued(conversation: Conversation, from: number, to: number): Conversation {
  const parts = queuedParts(conversation);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= parts.length || to >= parts.length || from === to) return conversation;
  const [moved] = parts.splice(from, 1);
  if (!moved) return conversation;
  parts.splice(to, 0, moved);
  const ids = new Set(parts.flatMap(part => [part.user.id, part.assistant.id]));
  const ordered: Message[] = parts.flatMap(part => [part.user, part.assistant]);
  let cursor = 0;
  return { ...conversation, messages: conversation.messages.map(message => ids.has(message.id) ? ordered[cursor++] ?? message : message) };
}
