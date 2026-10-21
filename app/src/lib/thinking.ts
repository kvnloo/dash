import type { AssistantMessage, ConnectionStatus, Message } from "../model";

/** aodl-views' agent phases (src/model/types.ts ThinkingPhase), mirrored to keep this file pure. */
export type ThinkingPhase = "idle" | "thinking" | "tool" | "streaming" | "waiting-approval";
export type Thinking = { phase: ThinkingPhase; tool?: string };

const TOOL = /^Running ([\w.:-]+(?:, [\w.:-]+)*)/;

/**
 * What the agent behind one reply is doing, from what the bridge actually reported:
 * a tool status line names tools, text arriving is streaming, a held handoff is idle,
 * anything else still in flight is thinking. Finished replies are idle.
 */
export function messageThinking(message: AssistantMessage, opts: { liveText?: string; connection?: ConnectionStatus } = {}): Thinking {
  if (message.state !== "streaming" && message.state !== "pending") return { phase: "idle" };
  if (opts.connection === "offline") return { phase: "idle" };
  if (message.state === "pending" || message.handoff === "queued") return { phase: "idle" };
  const tool = message.status ? TOOL.exec(message.status)?.[1] : undefined;
  if (tool) return { phase: "tool", tool };
  if (message.status && /^Waiting for (approval|clarification)|^Approval required|^Clarification required/i.test(message.status)) return { phase: "waiting-approval" };
  if (message.status === "Thinking") return { phase: "thinking" };
  if ((opts.liveText ?? message.text).length > 0) return { phase: "streaming" };
  return { phase: "thinking" };
}

/** Prefer work in flight over a later queued send; a queue is not an approval. */
export function conversationThinking(messages: Message[], connection?: ConnectionStatus): Thinking {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "assistant" && message.state === "streaming") return messageThinking(message, { connection });
  }
  return { phase: "idle" };
}
