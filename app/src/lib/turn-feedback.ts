import { formatTool } from "../../../shared/tool-format";
import type { AssistantMessage } from "../model";
import type { ToolView } from "./reply-details";

/** Presentation only: queued/disconnected never implies the agent is working. */
export function replyFeedback(message: Pick<AssistantMessage, "handoff" | "status">, connected: boolean, hasText: boolean): string {
  if (message.handoff === "queued") return "Waiting to send";
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

/** Parse intact structured output; the rendering layer bounds the visible tail. */
export function compactToolPreview(tools: readonly ToolView[]) {
  const tool = tools.at(-1);
  return tool ? { tool, formatted: formatTool(tool) } : undefined;
}
