import type { HostInfo } from "../../../shared/protocol";
import { hostDisplayName } from "../../../shared/host-display";
import type { Conversation } from "../model";
import { conversationThinking, type Thinking } from "./thinking";
import { graphHosts } from "./orchestra-graph";

export type MapKind = "chat" | "subagent" | "repo" | "host";
export type MapRelation = "delegated" | "touched" | "hosted" | "workspace";
export type MapLayout = "spine" | "constellation" | "radial" | "islands";
export type MapState = "idle" | "live" | "needs-you" | "failing";
export interface MapNode { id: string; label: string; kind: MapKind; state: MapState; thinking: Thinking; hostId: string; path?: string }
export interface MapEdge { id: string; from: string; to: string; relation: MapRelation; active: boolean }
export interface OrchestraMap { nodes: MapNode[]; edges: MapEdge[] }
export interface MapFilter { kind: MapKind | MapRelation; only: boolean }
export interface Point { x: number; y: number }

/** Roster membership and cwd are NOT evidence of delegation or file touches. */
export function orchestraMap(hosts: HostInfo[], conversations: Conversation[]): OrchestraMap {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  for (const host of graphHosts(hosts)) {
    const hostId = `host:${host.id}`;
    nodes.push({ id: hostId, label: hostDisplayName(host), kind: "host", state: "idle", thinking: { phase: "idle" }, hostId });
    for (const agent of host.agents) {
      const chat = conversations.find(c => c.sessionId === agent.sessionId && c.harness === agent.kind && (!c.targetHostId ? host.self : c.targetHostId === host.id));
      const thinking = chat ? conversationThinking(chat.messages) : { phase: "idle" } satisfies Thinking;
      const latest = chat?.messages.filter(m => m.role === "assistant").at(-1);
      const state: MapState = latest?.state === "error" || latest?.state === "interrupted" ? "failing" : thinking.phase === "waiting-approval" ? "needs-you" : thinking.phase !== "idle" || agent.status === "running" ? "live" : "idle";
      const id = `chat:${host.id}:${agent.id}`;
      nodes.push({ id, label: agent.name, kind: "chat", state, thinking: state === "live" && thinking.phase === "idle" ? { phase: "thinking" } : thinking, hostId, path: agent.cwd });
      edges.push({ id: `hosted:${id}`, from: hostId, to: id, relation: "hosted", active: false });
      if (agent.cwd) {
        const repoId = `repo:${host.id}:${agent.cwd}`;
        if (!nodes.some(n => n.id === repoId)) nodes.push({ id: repoId, label: agent.cwd.split("/").filter(Boolean).at(-1) ?? agent.cwd, kind: "repo", state: "idle", thinking: { phase: "idle" }, hostId, path: agent.cwd });
        edges.push({ id: `workspace:${id}`, from: id, to: repoId, relation: "workspace", active: false });
      }
    }
  }
  return { nodes, edges };
}

export function matchesFilter(node: MapNode, graph: OrchestraMap, filter: MapFilter | null): boolean {
  return !filter || node.kind === filter.kind || graph.edges.some(e => e.relation === filter.kind && (e.from === node.id || e.to === node.id));
}

export function projectMap(graph: OrchestraMap, filter: MapFilter | null, focusId: string | null, focusOnly: boolean): OrchestraMap {
  const neighbours = new Set([focusId]);
  for (const e of graph.edges) {
    if (e.from === focusId) neighbours.add(e.to);
    if (e.to === focusId) neighbours.add(e.from);
  }
  const nodes = graph.nodes.filter(n => (!filter?.only || matchesFilter(n, graph, filter)) && (!focusOnly || !focusId || neighbours.has(n.id)));
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: graph.edges.filter(e => ids.has(e.from) && ids.has(e.to)) };
}

/** Stable node IDs retain their shared values across all four organisations. */
export function mapPositions(nodes: MapNode[], width: number, height: number, layout: MapLayout): Map<string, Point> {
  const out = new Map<string, Point>();
  const cx = width / 2;
  const cy = height / 2;
  const rows = Math.max(1, Math.ceil(nodes.length / Math.max(1, Math.floor(width / 72))));
  const columns = Math.max(1, Math.ceil(nodes.length / rows));
  nodes.forEach((node, i) => {
    const angle = i * Math.PI * 2 / Math.max(1, nodes.length) - Math.PI / 2;
    let x = 32 + (i % columns + 0.5) * (width - 64) / columns;
    let y = 32 + (Math.floor(i / columns) + 0.5) * (height - 64) / rows;
    if (layout === "radial") {
      x = cx + Math.cos(angle) * Math.max(0, cx - 48);
      y = cy + Math.sin(angle) * Math.max(0, cy - 42);
    } else if (layout === "spine") {
      const kinds: MapKind[] = ["host", "chat", "subagent", "repo"];
      const peers = nodes.filter(n => n.kind === node.kind);
      const perRow = Math.max(1, Math.floor((width - 64) / 64));
      const rowCounts = kinds.map(kind => Math.ceil(nodes.filter(n => n.kind === kind).length / perRow));
      const totalRows = rowCounts.reduce((sum, count) => sum + count, 0);
      const offset = rowCounts.slice(0, kinds.indexOf(node.kind)).reduce((sum, count) => sum + count, 0);
      const index = peers.indexOf(node);
      const inRow = Math.min(perRow, peers.length - Math.floor(index / perRow) * perRow);
      x = 32 + (index % perRow + 0.5) * (width - 64) / inRow;
      y = 32 + (offset + Math.floor(index / perRow)) * (height - 76) / Math.max(1, totalRows - 1);
    } else if (layout === "islands") {
      const hosts = [...new Set(nodes.map(n => n.hostId))];
      const peers = nodes.filter(n => n.hostId === node.hostId);
      const a = peers.indexOf(node) * Math.PI * 2 / peers.length;
      const radiusX = Math.max(24, (width / hosts.length - 96) / 2);
      x = width * (hosts.indexOf(node.hostId) + 0.5) / hosts.length + Math.cos(a) * radiusX;
      y = cy + Math.sin(a) * Math.max(24, cy - 48);
    }
    out.set(node.id, { x, y });
  });
  return out;
}
