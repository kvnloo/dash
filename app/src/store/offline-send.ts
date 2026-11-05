import type { AssistantMessage, Conversation } from "../model";

/** A send that never left the phone is pending, not an error. Reconnect should retry it. */
export function parkMessage(message: AssistantMessage): AssistantMessage {
  if (message.state === "done" || message.state === "interrupted") return message;
  return { ...message, state: "pending", error: undefined, status: undefined };
}

export type PendingSend = {
  turnId: string;
  harness: string;
  text: string;
  sessionId?: string;
  cwd?: string;
};

export function nextPendingSend(conv: Conversation): PendingSend | null {
  if (conv.messages.some((m) => m.role === "assistant" && m.state === "streaming")) return null;
  for (let i = 0; i < conv.messages.length; i++) {
    const message = conv.messages[i];
    const user = i > 0 ? conv.messages[i - 1] : undefined;
    if (message?.role === "assistant" && message.state === "pending" && user?.role === "user") {
      return {
        turnId: message.turnId,
        harness: conv.harness,
        text: user.text,
        sessionId: conv.sessionId,
        cwd: conv.cwd,
      };
    }
  }
  return null;
}
