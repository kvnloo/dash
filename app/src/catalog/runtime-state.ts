import type { AgentInfo } from "../../../shared/protocol";
import type { AssistantState, ConnectionStatus } from "../model";

export function runtimeStateFromTurn(input: {
  turnState?: AssistantState;
  agentStatus?: AgentInfo["status"];
  connectionStatus?: ConnectionStatus;
}): string {
  if (input.turnState === "error") return "blocked";
  if (input.turnState === "interrupted") return "stale";
  if (input.turnState === "pending") return "claimed";
  if (input.turnState === "streaming") {
    if (input.connectionStatus === "offline" || input.agentStatus === "offline") return "stale";
    return "running";
  }
  return "unknown";
}

export function runtimeStateFromAgent(status: AgentInfo["status"] | undefined): string {
  if (status === "running") return "running";
  if (status === "available") return "paused";
  if (status === "offline") return "stale";
  return "unknown";
}

export function runtimeStateFromOrchestra(input: {
  status: "active" | "idle" | "paused";
  streaming: boolean;
}): string {
  if (input.streaming) return "running";
  if (input.status === "paused") return "paused";
  if (input.status === "idle") return "stale";
  if (input.status === "active") return "claimed";
  return "unknown";
}

export function effortIdForTurn(input: { turnState?: AssistantState; effortId?: string }): string | undefined {
  if (input.effortId) return input.effortId;
  if (input.turnState === "streaming") return "standard";
  return undefined;
}

export function conversationStreaming(messages: Array<{ role: string; state?: string }>): boolean {
  for (const message of messages) {
    if (message.role === "assistant" && message.state === "streaming") return true;
  }
  return false;
}

export function lastAssistantState(messages: Array<{ role: string; state?: string }>): AssistantState | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.role === "assistant") {
      const state = message.state;
      if (
        state === "pending" ||
        state === "streaming" ||
        state === "done" ||
        state === "error" ||
        state === "interrupted"
      ) {
        return state;
      }
      return undefined;
    }
  }
  return undefined;
}
