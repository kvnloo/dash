import type { AssistantMessage, ConnectionStatus, Message } from "../model";

/** aodl-views' agent phases (src/model/types.ts ThinkingPhase), mirrored to keep this file pure. */
export type ThinkingPhase = "idle" | "thinking" | "tool" | "streaming" | "waiting-approval";
export type Thinking = { phase: ThinkingPhase; tool?: string };

const TOOL = /^Running ([\w.:-]+)/;

/**
 * What the agent behind one reply is doing, from what the bridge actually reported:
 * a tool status line names a tool, text arriving is streaming, a held handoff waits,
 * anything else still in flight is thinking. Finished replies are idle.
 */
export function messageThinking(message: AssistantMessage, opts: { liveText?: string; connection?: ConnectionStatus } = {}): Thinking {
  if (message.state !== "streaming" && message.state !== "pending") return { phase: "idle" };
  if (opts.connection === "offline") return { phase: "idle" };
  if (message.state === "pending" || message.handoff === "queued") return { phase: "waiting-approval" };
  const tool = message.status ? TOOL.exec(message.status)?.[1] : undefined;
  if (tool) return { phase: "tool", tool };
  if (message.status && /approv|permission|waiting for/i.test(message.status)) return { phase: "waiting-approval" };
  if ((opts.liveText ?? message.text).length > 0) return { phase: "streaming" };
  return { phase: "thinking" };
}

/** A chat's state is its latest reply's state. */
export function conversationThinking(messages: Message[], connection?: ConnectionStatus): Thinking {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role === "assistant") return messageThinking(message, { connection });
  }
  return { phase: "idle" };
}
