import { formatTool, redactTool } from "../../../shared/tool-format";
import type { TreeNode } from "./tree";

/** Structurally matches sol-dash-thinking-tools' ReplyDetails; no protocol fork. */
export interface ToolTreeReply {
  id?: string;
  turnId?: string;
  reasoning?: string;
  activity?: string[];
  tools?: { id: string; name: string; summary: string; args: string; output: string; status: "live" | "ok" | "error"; durationMs: number; truncated: boolean }[];
}

/** Pass only bridge-redacted details. Never fetch raw tool output from a tree row. */
type ToolTreeCall = NonNullable<ToolTreeReply["tools"]>[number];

const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** Details arrive over the wire: keep only well-formed calls so a malformed row never becomes inspectable state. */
function isToolCall(value: unknown): value is ToolTreeCall {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const status = Reflect.get(value, "status");
  const durationMs = Reflect.get(value, "durationMs");
  // Check stored output types without invoking an accessor while collapsed.
  const outputDescriptor = Object.getOwnPropertyDescriptor(value, "output");
  if (!outputDescriptor || ("value" in outputDescriptor && typeof outputDescriptor.value !== "string")) return false;
  return nonBlank(Reflect.get(value, "id")) && typeof Reflect.get(value, "name") === "string"
    && typeof Reflect.get(value, "summary") === "string" && typeof Reflect.get(value, "args") === "string"
    && (status === "live" || status === "ok" || status === "error")
    && typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0
    && typeof Reflect.get(value, "truncated") === "boolean";
}

function replyReasoning(reply: ToolTreeReply): string {
  const reasoning: unknown = reply.reasoning;
  if (typeof reasoning === "string") return reasoning;
  const activity: unknown = reply.activity;
  return Array.isArray(activity) ? activity.filter((line): line is string => typeof line === "string").join("\n") : "";
}

/** Group adjacent calls by name without formatting or reading their detail fields. */
function groupByName(tools: readonly ToolTreeCall[]): ToolTreeCall[][] {
  const groups: ToolTreeCall[][] = [];
  for (const tool of tools) {
    const last = groups[groups.length - 1];
    if (last && last[0]?.name === tool.name) last.push(tool);
    else groups.push([tool]);
  }
  return groups;
}

export function toolTree(reply: ToolTreeReply, inspect?: (id: string) => void): TreeNode[] {
  const turnId: unknown = reply.turnId;
  const replyId: unknown = reply.id;
  const id = nonBlank(turnId) ? turnId : nonBlank(replyId) ? replyId : "reply";
  const rawTools: unknown = reply.tools;
  const tools = Array.isArray(rawTools) ? rawTools.filter(isToolCall) : [];
  const reasoning = replyReasoning(reply);
  const children: TreeNode[] = [];
  const callNode = (tool: ToolTreeCall): TreeNode => ({
    id: `${id}:call:${tool.id}`, kind: "call", label: redactTool(tool.name),
    meta: tool.status === "live" ? "running" : `${(tool.durationMs / 1000).toFixed(1)}s${tool.status === "error" ? " · error" : ""}`,
    status: tool.status === "live" ? "running" : tool.status === "error" ? "offline" : "available",
    children: () => {
      // Only an opened call formats its arguments/output; a collapsed call holds no detail.
      let output: unknown;
      try { output = tool.output; } catch { return []; }
      if (typeof output !== "string") return [];
      const f = formatTool({ name: tool.name, args: tool.args, output, status: tool.status, durationMs: tool.durationMs });
      return [
        { id: `${id}:args:${tool.id}`, kind: "args", label: "Arguments", detail: f.args.slice(0, 400), onPress: () => inspect?.(tool.id) },
        { id: `${id}:output:${tool.id}`, kind: "output", label: tool.truncated ? "Output (truncated) · inspect / copy" : "Output · inspect / copy", detail: f.output.slice(-300), onPress: () => inspect?.(tool.id) },
        { id: `${id}:inspect:${tool.id}`, kind: "note", label: "Inspect full details", onPress: () => inspect?.(tool.id) },
      ];
    },
  });
  if (reasoning) children.push({ id: `${id}:thinking`, kind: "thinking", label: "Thinking", children: () => [{ id: `${id}:reasoning`, kind: "thinking", label: "Reasoning", detail: reasoning }] });
  if (tools.length) children.push({
    id: `${id}:tools`, kind: "tools", label: "Tool calls", meta: `${tools.length} · ${(tools.reduce((sum, tool) => sum + tool.durationMs, 0) / 1000).toFixed(1)}s`,
    children: () => {
      const nodes: TreeNode[] = [];
      for (const group of groupByName(tools)) {
        const first = group[0];
        if (!first) continue;
        if (group.length > 1) {
          nodes.push({
            id: `${id}:group:${first.id}`, kind: "tools", label: redactTool(`${first.name} ×${group.length}`),
            children: () => group.map(callNode),
          });
        } else nodes.push(callNode(first));
      }
      return nodes;
    },
  });
  return [{ id: `${id}:turn`, kind: "turn", label: "Turn details", meta: `${tools.length} calls`, children: () => children }];
}

export const TOOL_TREE_FIXTURE: ToolTreeReply = {
  id: "fixture-turn", reasoning: "Trace the roster hostname, then verify the session routing.",
  tools: [{ id: "read-roster", name: "read_file", summary: "bridge/src/roster.ts", args: '{"path":"bridge/src/roster.ts"}', output: "name: node.hostName,\nid: magicDnsLabel", status: "ok", durationMs: 142, truncated: false }],
};
