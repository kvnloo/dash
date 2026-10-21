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
export function toolTree(reply: ToolTreeReply): TreeNode[] {
  const id = reply.turnId ?? reply.id ?? "reply";
  const tools = reply.tools ?? [];
  const reasoning = reply.reasoning ?? reply.activity?.join("\n") ?? "";
  const children: TreeNode[] = [];
  if (reasoning) children.push({ id: `${id}:thinking`, kind: "thinking", label: "Thinking", children: () => [{ id: `${id}:reasoning`, kind: "thinking", label: "Reasoning", detail: reasoning }] });
  if (tools.length) children.push({
    id: `${id}:tools`, kind: "tools", label: "Tool calls", meta: `${tools.length} · ${(tools.reduce((sum, tool) => sum + tool.durationMs, 0) / 1000).toFixed(1)}s`,
    children: () => tools.map(tool => ({
      id: `${id}:call:${tool.id}`, kind: "call", label: tool.name, detail: tool.summary,
      meta: tool.status === "live" ? "running" : `${(tool.durationMs / 1000).toFixed(1)}s${tool.status === "error" ? " · error" : ""}`,
      status: tool.status === "live" ? "running" : tool.status === "error" ? "offline" : "available",
      children: () => [
        { id: `${id}:args:${tool.id}`, kind: "args", label: "Arguments", detail: tool.args || "No arguments" },
        { id: `${id}:output:${tool.id}`, kind: "output", label: tool.truncated ? "Output (truncated)" : "Output", detail: tool.output || (tool.status === "live" ? "Waiting for output…" : "No output") },
      ],
    })),
  });
  return [{ id: `${id}:turn`, kind: "turn", label: "Turn details", meta: `${tools.length} calls`, children: () => children }];
}

export const TOOL_TREE_FIXTURE: ToolTreeReply = {
  id: "fixture-turn", reasoning: "Trace the roster hostname, then verify the session routing.",
  tools: [{ id: "read-roster", name: "read_file", summary: "bridge/src/roster.ts", args: '{"path":"bridge/src/roster.ts"}', output: "name: node.hostName,\nid: magicDnsLabel", status: "ok", durationMs: 142, truncated: false }],
};
