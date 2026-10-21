import type { Thinking } from "./thinking";

export type TreeKind = "host" | "bot" | "harness" | "session" | "repo" | "turn" | "thinking" | "tools" | "call" | "args" | "output" | "note";

export interface TreeNode {
  id: string;
  label: string;
  kind: TreeKind;
  detail?: string;
  meta?: string;
  status?: "running" | "available" | "offline";
  dimmed?: boolean;
  thinking?: Thinking;
  children?: TreeNode[] | (() => TreeNode[] | Promise<TreeNode[]>);
  onPress?(): void;
  onLongPress?(): void;
}

/** Only visible branches are requested. IDs must be unique across the tree. */
export function treeIndex(nodes: TreeNode[]) {
  const root: TreeNode = { id: "dash-tree-root", label: "Tree", kind: "note", children: nodes };
  const index = new Map<string, TreeNode>([[root.id, root]]);
  for (const node of nodes) index.set(node.id, node);
  return { root, index };
}

export function childNodes(node: TreeNode): TreeNode[] | Promise<TreeNode[]> {
  return typeof node.children === "function" ? node.children() : node.children ?? [];
}
