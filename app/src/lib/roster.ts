import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import { parseHosts } from "../../../shared/protocol";
import type { AgentTarget } from "../mock/agents";
import type { Settings } from "../model";

export function chatKind(agent: { id: string; kind: string }): string {
  if (agent.kind !== "a2a") return agent.kind;
  return /grok/i.test(agent.id) ? "grok" : "hermes";
}

export function canChatWithAgent(
  agent: { id: string; kind: string },
  opts: { self: boolean; availableKinds: Set<string> },
): boolean {
  return opts.self && opts.availableKinds.has(chatKind(agent));
}

/** A persisted host chat (e.g. a saved Hermes session). It belongs in Chats, not in the project mesh. */
export function isPersistedChat(agent: { id: string }): boolean {
  return agent.id.startsWith("hermes:session:");
}

export function emptyHostProfile(host: HostInfo): AgentTarget {
  return {
    id: `host:${host.id}`,
    harness: "host",
    name: host.online ? "Online" : "Offline",
    role: "No Dash agents listed",
    description: host.self ? "This computer" : "On the tailnet",
    online: host.online,
  };
}

export function profilesFromHosts(hosts: HostInfo[]): AgentTarget[] {
  const out: AgentTarget[] = [];
  for (const host of hosts) {
    if (host.agents.length === 0) {
      out.push(emptyHostProfile(host));
      continue;
    }
    for (const agent of host.agents) {
      out.push(profileFromAgent(host, agent));
    }
  }
  return out;
}

export function profileFromAgent(host: HostInfo, agent: AgentInfo): AgentTarget {
  const hostLabel = host.name === host.hostname ? host.name : `${host.name} · ${host.hostname}`;
  return {
    id: `${host.id}:${agent.id}`,
    harness: chatKind(agent),
    name: agent.name,
    role: hostLabel,
    description: agent.detail ?? agent.status,
    online: host.online && agent.status !== "offline",
    live: host.online && agent.status === "running",
    cwd: agent.cwd,
    targetHostId: host.id,
    profileId: agent.id,
    sessionId: agent.sessionId,
  };
}

export async function fetchRoster(settings: Settings): Promise<HostInfo[] | undefined> {
  try {
    const res = await fetch(`http://${settings.address}/roster?token=${encodeURIComponent(settings.token)}`, {
      method: "GET",
    });
    if (!res.ok) return undefined;
    const raw: unknown = await res.json();
    if (typeof raw !== "object" || raw === null) return undefined;
    return "hosts" in raw ? parseHosts(raw.hosts) : undefined;
  } catch {
    return undefined;
  }
}
