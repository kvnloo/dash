/** Evaluate the Dash UX decision tree. Kind is derived. Agents do not pick a fourth option. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Kind = "lock" | "fork" | "claimed" | "gap";

export type Option = {
  id: string;
  label: string;
  seenIn: string[];
  verdict: string;
  because?: string;
};

export type Node = {
  id: string;
  question: string;
  attention: string;
  options: Option[];
  adopted: string;
  target: string;
  wiring: string[];
  pattern: string;
  fork?: string;
  claimedIssue?: string;
};

export type Issue = {
  id: string;
  title: string;
  fromNode: string;
  priority: string;
  area: string;
  why: string;
};

export type Tree = {
  schemaVersion: number;
  walk: string[];
  nodes: Node[];
  proposedIssues: Issue[];
  axioms: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(str);
}

function parseOption(raw: unknown): Option {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.label) || !str(raw.verdict)) {
    throw new Error("option needs id, label, verdict");
  }
  return {
    id: raw.id,
    label: raw.label,
    seenIn: strList(raw.seenIn),
    verdict: raw.verdict,
    because: str(raw.because) ? raw.because : undefined,
  };
}

function parseNode(raw: unknown): Node {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.question) || !str(raw.attention)) {
    throw new Error("node needs id, question, attention");
  }
  if (!str(raw.adopted) || !str(raw.target) || !str(raw.pattern)) {
    throw new Error(`node ${raw.id} needs adopted, target, pattern`);
  }
  if (!Array.isArray(raw.options) || !Array.isArray(raw.wiring)) {
    throw new Error(`node ${raw.id} needs options and wiring`);
  }
  return {
    id: raw.id,
    question: raw.question,
    attention: raw.attention,
    options: raw.options.map(parseOption),
    adopted: raw.adopted,
    target: raw.target,
    wiring: strList(raw.wiring),
    pattern: raw.pattern,
    fork: str(raw.fork) ? raw.fork : undefined,
    claimedIssue: str(raw.claimedIssue) ? raw.claimedIssue : undefined,
  };
}

function parseIssue(raw: unknown): Issue {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.title) || !str(raw.fromNode)) {
    throw new Error("proposedIssue needs id, title, fromNode");
  }
  return {
    id: raw.id,
    title: raw.title,
    fromNode: raw.fromNode,
    priority: str(raw.priority) ? raw.priority : "P2",
    area: str(raw.area) ? raw.area : "app",
    why: str(raw.why) ? raw.why : "",
  };
}

export function loadTree(dir = import.meta.dir): Tree {
  const raw: unknown = JSON.parse(readFileSync(join(dir, "decisions.json"), "utf8"));
  if (!isRecord(raw) || raw.schemaVersion !== 1) {
    throw new Error("decisions.json schemaVersion must be 1");
  }
  if (!Array.isArray(raw.walk) || !Array.isArray(raw.nodes) || !Array.isArray(raw.proposedIssues)) {
    throw new Error("decisions.json needs walk, nodes, proposedIssues");
  }
  return {
    schemaVersion: 1,
    walk: strList(raw.walk),
    nodes: raw.nodes.map(parseNode),
    proposedIssues: raw.proposedIssues.map(parseIssue),
    axioms: strList(raw.axioms),
  };
}

export function kindOf(node: Node): Kind {
  if (node.adopted === node.target) return node.fork ? "fork" : "lock";
  if (node.claimedIssue) return "claimed";
  return "gap";
}

export function indexNodes(tree: Tree): Map<string, Node> {
  const byId = new Map<string, Node>();
  for (const node of tree.nodes) byId.set(node.id, node);
  return byId;
}

export function partition(tree: Tree): Record<Kind, string[]> {
  const out: Record<Kind, string[]> = { lock: [], fork: [], claimed: [], gap: [] };
  for (const id of tree.walk) {
    const node = tree.nodes.find((n) => n.id === id);
    if (!node) continue;
    out[kindOf(node)].push(id);
  }
  return out;
}

/** Every gap node must name at least one proposedIssue. Claimed and lock nodes must not. */
export function issuesByNode(tree: Tree): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const issue of tree.proposedIssues) {
    const list = map.get(issue.fromNode) ?? [];
    list.push(issue.id);
    map.set(issue.fromNode, list);
  }
  return map;
}
