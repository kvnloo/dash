import type { HostInfo } from "../../../shared/protocol";
import type { OrchestraNode } from "../../../shared/orchestra";
import { hostDisplayName } from "../../../shared/host-display";
import type { Conversation } from "../model";
import { conversationThinking, type Thinking } from "./thinking";
import { GRAPH_CHATS_PER_HOST } from "./orchestra-graph";

export type MapKind = "chat" | "subagent" | "repo" | "host";
export type MapRelation = "delegated" | "touched" | "hosted" | "workspace";
export type MapState = import("../../../shared/orchestra").OrchestraState;
export interface MapNode extends OrchestraNode { thinking: Thinking }
export interface MapEdge { id: string; from: string; to: string; relation: MapRelation; active: boolean }
export interface OrchestraMap { nodes: MapNode[]; edges: MapEdge[] }
export interface MapFilter { kind: MapKind | MapRelation; only: boolean }
export interface Point { x: number; y: number }

/** Roster membership and cwd are NOT evidence of delegation or file touches. */
export function orchestraMap(hosts: HostInfo[], conversations: Conversation[]): OrchestraMap {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  for (const host of hosts.map(h => ({ ...h, agents: h.agents.filter(a => a.sessionId).slice(0, GRAPH_CHATS_PER_HOST) }))) {
    const hostId = `host:${host.id}`;
    nodes.push({ id: hostId, label: hostDisplayName(host), kind: "host", state: "idle", online: host.online, reason: `${host.online ? "Online" : "Offline"} · roster only`, thinking: { phase: "idle" }, hostId });
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
