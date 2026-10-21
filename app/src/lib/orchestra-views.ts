import type { OrchestraNode, OrchestraEdge } from "../../../shared/orchestra";
export type OrchestraView = "fleet" | "lineage" | "work" | "triage";
export const ORCHESTRA_VIEWS: { id: OrchestraView; title: string; subtitle: string }[] = [
  { id: "fleet", title: "Fleet", subtitle: "Where is work running?" },
  { id: "lineage", title: "Lineage", subtitle: "Who delegated to whom?" },
  { id: "work", title: "Work", subtitle: "What is changing or colliding?" },
  { id: "triage", title: "Triage", subtitle: "What needs me, in order?" },
];
export function viewGraph<T extends OrchestraNode>(graph: { nodes: T[]; edges: OrchestraEdge[] }, view: OrchestraView): { nodes: T[]; edges: OrchestraEdge[] } {
  const relations = view === "fleet" ? ["hosted"] : view === "lineage" ? ["delegated"] : view === "work" ? ["touched", "workspace"] : [];
  const edges = graph.edges.filter(e => relations.includes(e.relation));
  const ids = new Set(edges.flatMap(e => [e.from, e.to]));
  const nodes = graph.nodes.filter(n => view === "triage" ? n.kind !== "host" && n.kind !== "repo" : ids.has(n.id) || (view === "fleet" && n.kind === "host") || (view === "work" && n.kind === "repo"));
  return { nodes, edges };
}
export function defaultView(nodes: OrchestraNode[]): OrchestraView { return nodes.some(n => n.state === "needs-you") ? "triage" : "fleet"; }
export const TRIAGE_LANES = [
  { state: "needs-you", title: "Needs you", action: "Review the recommended decision" },
  { state: "failing", title: "Failing / stalled", action: "Inspect evidence before resuming" },
  { state: "live", title: "Live", action: "Observe; no intervention needed" },
  { state: "done", title: "Recently done", action: "Review output and integrate" },
  { state: "idle", title: "Idle", action: "Open chat when ready" },
] as const;
