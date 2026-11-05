import { formatTool, redactTool } from "../../../shared/tool-format";
import type { DetailMode } from "./reply-details";
import type { TreeNode } from "./tree";

export type ToolTreeTool = { id: string; name: string; summary: string; args: string; output: string; status: "live" | "ok" | "error"; durationMs: number; truncated: boolean };
export interface ToolTreeReply { id?: string; turnId?: string; tools?: ToolTreeTool[] }
/** Compact keeps the latest calls as rows; earlier ones fold into one node. */
export const COMPACT_CALLS = 5;
const tailShort = (text: string, max: number) => text.length <= max ? text : `…${text.slice(-(max - 1))}`;

/** One row per call: what ran, its state, and the line that explains the result. */
export function callSummary(tool: ToolTreeTool): { label: string; detail: string } {
  const f = formatTool(tool);
  // A path reads file-first: the name and line range lead, the directory follows in the detail.
  const slash = f.path?.lastIndexOf("/") ?? -1;
  const range = f.path && f.title.startsWith(f.path) ? f.title.slice(f.path.length) : /:\d+(?:–\d+)?$/.exec(f.title)?.[0] ?? "";
  const title = f.path ? redactTool(`${f.path.slice(slash + 1)}${range}`) : f.title.length > 96 ? `${f.title.slice(0, 60)}…${f.title.slice(-35)}` : f.title;
  const folder = f.path && slash > 0 ? redactTool(tailShort(f.path.slice(0, slash), 64)) : "";
  const state = tool.status === "live" ? "running" : tool.status === "error" ? "failed" : "";
  // The row already says "failed" and has two lines: drop a repeated runner marker and trailing timing.
  const outcome = f.outcome.replace(/^(?:\(fail\)|FAIL\b|✗|✘|not ok\b)\s*/, "").replace(/\s*[[(]\d+(?:\.\d+)?\s*m?s[\])]$/, "");
  const result = tool.status !== "ok" || f.exit !== undefined ? outcome : f.facts.split("\n")[0] || folder;
  return { label: `${tool.name} · ${title}`, detail: [state, f.exit !== undefined && f.exit !== "0" ? `exit ${f.exit}` : "", result].filter(Boolean).join(" · ") };
}

/** Pass only bridge-redacted details. Never fetch raw tool output from a tree row. */
export function toolTree(reply: ToolTreeReply, inspect?: (id: string) => void, mode: DetailMode = "Full"): TreeNode[] {
  const id = reply.turnId ?? reply.id ?? "reply";
  const tools = reply.tools ?? [];
  const callNode = (tool: ToolTreeTool): TreeNode => {
    const f = formatTool(tool);
    const { label, detail } = callSummary(tool);
    return { id: `${id}:call:${tool.id}`, kind: "call", label, detail,
      meta: tool.status === "live" ? undefined : `${(tool.durationMs / 1000).toFixed(1)}s`, status: tool.status === "live" ? "running" : tool.status === "error" ? "offline" : "available",
      children: () => [
        { id: `${id}:args:${tool.id}`, kind: "args", label: "Arguments", detail: f.args.slice(0, 400), onPress: () => inspect?.(tool.id) },
        { id: `${id}:output:${tool.id}`, kind: "output", label: tool.truncated ? "Output (truncated) · inspect / copy" : "Output · inspect / copy", detail: f.output.slice(-300), onPress: () => inspect?.(tool.id) },
        { id: `${id}:inspect:${tool.id}`, kind: "note", label: "Inspect full details", onPress: () => inspect?.(tool.id) },
      ] };
  };
  const split = mode === "Compact" ? Math.max(0, tools.length - COMPACT_CALLS) : 0;
  const earlier = tools.slice(0, split);
  return [
    ...(earlier.length ? [{ id: `${id}:earlier`, kind: "tools" as const, label: `${earlier.length} earlier ${earlier.length === 1 ? "call" : "calls"}`, meta: earlier.some(tool => tool.status === "error") ? "error" : undefined, children: () => earlier.map(callNode) }] : []),
    ...tools.slice(split).map(callNode),
  ];
}

