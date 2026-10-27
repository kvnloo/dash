import type { ReplyPart } from "../../../shared/protocol";

export type DetailMode = "Hide" | "Compact" | "Full";
export const DETAIL_MODES: readonly DetailMode[] = ["Hide", "Compact", "Full"];
export interface ToolView { id: string; name: string; summary: string; args: string; output: string; status: "live" | "ok" | "error"; durationMs: number; truncated: boolean; detailLoaded: boolean }
export interface ReplyDetails { reasoning: string; tools: ToolView[] }
export const EMPTY_DETAILS: ReplyDetails = { reasoning: "", tools: [] };
/** One snapshot per reply, outside the conversation store. All displayed content is bridge-redacted. */
export function reducePart(state: ReplyDetails, part: ReplyPart): ReplyDetails {
  if (part.kind === "reasoning") return { ...state, reasoning: (state.reasoning + part.text).slice(-131072) };
  if (part.kind === "tool_start") {
    if (state.tools.some(tool => tool.id === part.callId)) return { ...state, tools: state.tools.map(tool => tool.id === part.callId ? { ...tool, name: part.name, summary: part.summary, args: part.args, truncated: tool.truncated || (part.truncated ?? false) } : tool) };
    if (state.tools.length >= 128) return state;
    return { ...state, tools: [...state.tools, { id: part.callId, name: part.name, summary: part.summary, args: part.args, output: "", status: "live", durationMs: 0, truncated: part.truncated ?? false, detailLoaded: false }] };
  }
  return { ...state, tools: state.tools.map(tool => tool.id !== part.callId ? tool : part.kind === "tool_finish" ? { ...tool, status: part.status, durationMs: part.durationMs } : part.kind === "tool_detail" ? { ...tool, args: part.args, output: part.text, truncated: part.truncated, detailLoaded: true } : { ...tool, output: (tool.output + part.text).slice(-1048576), truncated: tool.truncated || part.truncated }) };
}
export function detailsOf(parts: ReplyPart[] = []): ReplyDetails { return parts.reduce(reducePart, EMPTY_DETAILS); }
export function readDetails(raw: string): ReplyDetails {
  if (!raw) return EMPTY_DETAILS;
  try { const parts: unknown = JSON.parse(raw); const parsed = parseReplyParts(parts); return parsed ? detailsOf(parsed) : EMPTY_DETAILS; } catch { return EMPTY_DETAILS; }
}
import { parseReplyParts } from "../../../shared/reply-parts";
/** Approximate visual wrapping by available monospace columns; always tails the last three rows. */
export function wrappedTail(text: string, columns: number, lines = 3): string {
  const width = Math.max(1, Math.floor(columns));
  const rows: string[] = [];
  for (const line of text.trimEnd().split("\n")) {
    const chars = Array.from(line);
    if (!chars.length) rows.push("");
    for (let i = 0; i < chars.length; i += width) rows.push(chars.slice(i, i + width).join(""));
  }
  return rows.slice(-lines).join("\n");
}
export function seconds(ms: number): string { return `${(ms / 1000).toFixed(1)} s`; }
export function toolStackLabel(tools: ToolView[]): string { return `${tools.length} ${tools.length === 1 ? "tool" : "tools"} · ${seconds(tools.reduce((sum, tool) => sum + tool.durationMs, 0))}`; }
