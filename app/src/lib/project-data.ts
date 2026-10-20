import type { HostInfo } from "../../../shared/protocol";
import type { OrchestraProject } from "../catalog/orchestra";
import type { AgentTarget } from "../mock/agents";
import type { Conversation } from "../model";
import { isPersistedChat, profileFromAgent } from "./roster";

export interface LiveProject extends OrchestraProject {
  hostId?: string;
  hostName: string;
  cwd: string;
  agentRows: AgentTarget[];
}

function directory(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\\/g, "/");
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, "") || "/";
}

function projectId(hostId: string | undefined, cwd: string): string {
  return `project:${encodeURIComponent(hostId ?? "paired")}:${encodeURIComponent(cwd)}`;
}

export function projectsFromHosts(input: {
  hosts: HostInfo[];
  conversations: Conversation[];
  cwd?: string;
  now: number;
}): LiveProject[] {
  const projects = new Map<string, LiveProject>();
  const self = input.hosts.find((host) => host.self);
  const ensureProject = (hostId: string | undefined, cwd: string): LiveProject => {
    const id = projectId(hostId, cwd);
    const existing = projects.get(id);
    if (existing) return existing;
    const host = input.hosts.find((item) => item.id === hostId);
    const hostName = host?.name ?? hostId ?? "Paired computer";
    const project: LiveProject = {
      id,
      name: cwd.split("/").filter(Boolean).at(-1) ?? cwd,
      subtitle: `${hostName} · ${cwd}`,
      hostId,
      hostName,
      cwd,
      agents: [],
      agentRows: [],
      chatIds: [],
      status: "idle",
      updatedAt: 0,
      topologyId: "unknown",
      providerId: "unknown",
    };
    projects.set(id, project);
    return project;
  };

  // The bridge may report its folder as `~/x` while live agents report `/home/me/x`.
  // When the self host's agents show exactly one home prefix, use it so one folder
  // is one project, not two cards with the same name.
  const homes = new Set<string>();
  for (const agent of self?.agents ?? []) {
    const match = /^(\/(?:home|Users)\/[^/]+)\//.exec(directory(agent.cwd) ?? "");
    if (match?.[1]) homes.add(match[1]);
  }
  const home = homes.size === 1 ? [...homes][0] : undefined;
  const rawBridgeCwd = directory(input.cwd);
  const bridgeCwd = home && rawBridgeCwd?.startsWith("~/") ? `${home}${rawBridgeCwd.slice(1)}` : rawBridgeCwd;
  if (bridgeCwd) ensureProject(self?.id, bridgeCwd);
  for (const host of input.hosts) {
    for (const agent of host.agents) {
      // Saved chats are not agents; they add chat counts below, never projects of their own.
      if (isPersistedChat(agent)) continue;
      const cwd = directory(agent.cwd) ?? (host.self && agent.status === "available" ? bridgeCwd : undefined);
      if (!cwd) continue;
      const project = ensureProject(host.id, cwd);
      const profile = profileFromAgent(host, { ...agent, cwd });
      if (!project.agentRows.some((row) => row.id === profile.id)) project.agentRows.push(profile);
      if (!project.agents.includes(profile.harness)) project.agents.push(profile.harness);
      if (host.online && agent.status === "running") project.status = "active";
    }
  }

  for (const conversation of input.conversations) {
    const hostId = conversation.targetHostId ?? self?.id;
    let cwd = directory(conversation.cwd);
    if (!cwd && conversation.sessionId) {
      const host = input.hosts.find((item) => item.id === hostId);
      cwd = directory(host?.agents.find((agent) => agent.kind === conversation.harness && agent.sessionId === conversation.sessionId)?.cwd);
    }
    if (!cwd) continue;
    // A host's saved Hermes chats can span dozens of scratch folders. They join an
    // existing project's count but do not mint projects (the mesh stays readable).
    const adopted = conversation.profileId?.startsWith("hermes:session:") === true;
    if (adopted && !projects.has(projectId(hostId, cwd))) continue;
    const project = ensureProject(hostId, cwd);
    project.chatIds.push(conversation.id);
    project.updatedAt = Math.max(project.updatedAt, conversation.updatedAt);
  }

  for (const project of projects.values()) {
    if (project.updatedAt === 0 || project.status === "active") project.updatedAt = input.now;
  }
  return [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
