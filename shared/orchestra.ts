/** Read-only evidence projection. IDs are opaque; paths never authorize execution. */
export type OrchestraKind = "chat" | "subagent" | "repo" | "host";
export type OrchestraRelation = "delegated" | "touched" | "hosted" | "workspace";
export type OrchestraState = "idle" | "live" | "needs-you" | "failing" | "done";
export interface OrchestraNode {
  id: string; label: string; kind: OrchestraKind; state: OrchestraState; hostId: string;
  reason?: string; action?: string; path?: string; branch?: string; dirty?: number;
  sessionId?: string; profileId?: string; harness?: string; model?: string; parentId?: string;
  online?: boolean; health?: string; updatedAt?: number; collision?: boolean; grouped?: number;
  provenance?: string[];
}
export interface OrchestraEdge { id: string; from: string; to: string; relation: OrchestraRelation; active: boolean; provenance?: string[] }
export interface OrchestraSnapshot { nodes: OrchestraNode[]; edges: OrchestraEdge[]; generatedAt: number; warnings: string[]; hours: number }
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export function parseOrchestra(raw: unknown): OrchestraSnapshot | null {
  if (!record(raw) || !Array.isArray(raw.nodes) || raw.nodes.length > 150 || !Array.isArray(raw.edges) || raw.edges.length > 2000 || typeof raw.generatedAt !== "number" || typeof raw.hours !== "number" || !Array.isArray(raw.warnings) || !raw.warnings.every((x: unknown) => typeof x === "string")) return null;
  const nodes: OrchestraNode[] = [], edges: OrchestraEdge[] = [];
  const ids = new Set<string>();
  for (const n of raw.nodes) {
    if (!record(n) || typeof n.id !== "string" || ids.has(n.id) || typeof n.label !== "string" || !n.label || typeof n.hostId !== "string" || !["chat", "subagent", "repo", "host"].includes(String(n.kind)) || !["idle", "live", "needs-you", "failing", "done"].includes(String(n.state))) return null;
    const kind = n.kind === "host" ? "host" : n.kind === "repo" ? "repo" : n.kind === "subagent" ? "subagent" : "chat";
    const state = n.state === "live" ? "live" : n.state === "needs-you" ? "needs-you" : n.state === "failing" ? "failing" : n.state === "done" ? "done" : "idle";
    const node: OrchestraNode = { id: n.id, label: n.label, hostId: n.hostId, kind, state };
    for (const key of ["reason", "action", "path", "branch", "sessionId", "profileId", "harness", "model", "parentId", "health"] as const) if (typeof n[key] === "string") node[key] = n[key];
    for (const key of ["dirty", "updatedAt", "grouped"] as const) if (typeof n[key] === "number" && Number.isFinite(n[key])) node[key] = n[key];
    for (const key of ["online", "collision"] as const) if (typeof n[key] === "boolean") node[key] = n[key];
    if (Array.isArray(n.provenance) && n.provenance.every((v: unknown): v is string => typeof v === "string")) node.provenance = n.provenance;
    nodes.push(node); ids.add(node.id);
  }
  for (const e of raw.edges) {
    if (!record(e) || typeof e.id !== "string" || typeof e.from !== "string" || typeof e.to !== "string" || !ids.has(e.from) || !ids.has(e.to) || typeof e.active !== "boolean" || !["delegated", "touched", "hosted", "workspace"].includes(String(e.relation))) return null;
    const relation = e.relation === "delegated" ? "delegated" : e.relation === "touched" ? "touched" : e.relation === "workspace" ? "workspace" : "hosted";
    edges.push({ id: e.id, from: e.from, to: e.to, relation, active: e.active, ...(Array.isArray(e.provenance) && e.provenance.every((v: unknown): v is string => typeof v === "string") ? { provenance: e.provenance } : {}) });
  }
  return { nodes, edges, generatedAt: raw.generatedAt, hours: raw.hours, warnings: raw.warnings.filter((v: unknown): v is string => typeof v === "string") };
}
