import type { MapEdge, MapNode, OrchestraMap } from "./orchestra-map";
import type { TreeNode } from "./tree";

/** Built once per projected graph. Every per-node lookup in the Orchestra render is O(1) or O(degree). */
export interface Adjacency {
  byId: Map<string, MapNode>;
  outEdges: Map<string, MapEdge[]>;
  inEdges: Map<string, MapEdge[]>;
}

export const HUB_SPOKE_CAP = 12;

export function adjacency(graph: OrchestraMap): Adjacency {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const outEdges = new Map<string, MapEdge[]>();
  const inEdges = new Map<string, MapEdge[]>();
  for (const e of graph.edges) {
    const out = outEdges.get(e.from);
    if (out) out.push(e); else outEdges.set(e.from, [e]);
    const inc = inEdges.get(e.to);
    if (inc) inc.push(e); else inEdges.set(e.to, [e]);
  }
  return { byId, outEdges, inEdges };
}

const none: MapEdge[] = [];
export function edgesOf(adj: Adjacency, id: string): MapEdge[] {
  const out = adj.outEdges.get(id) ?? none, inc = adj.inEdges.get(id) ?? none;
  return out.length && inc.length ? [...out, ...inc] : out.length ? out : inc;
}

/** Distinct neighbours joined by an edge that touches at least one live node. */
export function liveConnectionCounts(adj: Adjacency): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of adj.byId.keys()) {
    const seen = new Set<string>();
    for (const e of edgesOf(adj, id)) {
      if (adj.byId.get(e.from)?.state === "live" || adj.byId.get(e.to)?.state === "live") seen.add(e.from === id ? e.to : e.from);
    }
    counts.set(id, seen.size);
  }
  return counts;
}

export interface Hub { hub: MapNode; edges: MapEdge[]; children: MapNode[]; live: number }

/** Hub rows for the fleet (host → hosted) and work (touched/workspace → repo) views. */
export function hubRows(adj: Adjacency, kind: "host" | "repo", hubEdges: (hub: MapNode) => MapEdge[], liveCounts: Map<string, number>): Hub[] {
  const hubs = [...adj.byId.values()].filter(n => n.kind === kind)
    .sort((a, b) => Number(Boolean(b.collision)) - Number(Boolean(a.collision)) || (liveCounts.get(b.id) ?? 0) - (liveCounts.get(a.id) ?? 0));
  return hubs.map(hub => {
    const edges = hubEdges(hub);
    const ids = new Set<string>();
    for (const e of edges) { ids.add(e.from); ids.add(e.to); }
    ids.delete(hub.id);
    const children = [...adj.byId.values()].filter(n => ids.has(n.id)).sort((a, b) => Number(b.state === "live") - Number(a.state === "live"));
    return { hub, edges, children, live: children.filter(n => n.state === "live").length };
  });
}

/** Delegation forest. Each node appears once; cycles stop at the first repeat (no per-call Set copies). */
export function lineageForest(graph: OrchestraMap, adj: Adjacency, toTreeNode: (node: MapNode, children: TreeNode[] | undefined) => TreeNode): TreeNode[] {
  const roots = graph.nodes.filter(n => !adj.inEdges.has(n.id));
  const onPath = new Set<string>();
  const build = (node: MapNode): TreeNode => {
    onPath.add(node.id);
    const children: TreeNode[] = [];
    for (const e of adj.outEdges.get(node.id) ?? none) {
      const child = adj.byId.get(e.to);
      if (child && !onPath.has(child.id)) children.push(build(child));
    }
    onPath.delete(node.id);
    return toTreeNode(node, children.length ? children : undefined);
  };
  return roots.map(build);
}
