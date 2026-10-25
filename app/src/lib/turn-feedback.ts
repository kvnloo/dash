import type { AssistantMessage } from "../model";
import type { ToolView } from "./reply-details";

/** Presentation only: queued/disconnected never implies the agent is working. */
export function replyFeedback(message: Pick<AssistantMessage, "handoff" | "status">, connected: boolean, hasText: boolean): string {
  if (message.handoff === "queued") return "Queued on host";
  if (!connected) return "Waiting for connection";
  if (message.status && message.status !== "Working") return message.status;
  return hasText ? "Writing reply" : "Waiting for reply";
}

/** Counts are outcomes, not invented progress percentages or parallel wall time. */
export function toolProgressLabel(tools: readonly ToolView[]): string {
  const running = tools.filter(tool => tool.status === "live").length;
  const failed = tools.filter(tool => tool.status === "error").length;
  const count = `${tools.length} ${tools.length === 1 ? "tool" : "tools"}`;
  const states = [running ? `${running} running` : "", failed ? `${failed} failed` : ""].filter(Boolean);
  return `${count} · ${states.join(", ") || "complete"}`;
}
