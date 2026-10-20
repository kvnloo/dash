import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import { parseHosts } from "../../../shared/protocol";
import type { BotProfile } from "../mock/bots";
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

/** A persisted host chat (e.g. a saved Hermes session). It belongs in Chats, not in Bots or the project mesh. */
export function isPersistedChat(agent: { id: string }): boolean {
  return agent.id.startsWith("hermes:session:");
}

/**
 * Bots shows agents and profiles, not every saved chat. Persisted Hermes sessions
 * collapse into a count on their profile row ("clean · 37 chats"), and into the
 * generic Hermes row when the host lists no profile rows.
 */
export function botAgents(host: HostInfo): AgentInfo[] {
  const chats = new Map<string, number>();
  let total = 0;
  for (const agent of host.agents) {
    if (!isPersistedChat(agent)) continue;
    total += 1;
    const profile = agent.profileId ?? "default";
    chats.set(profile, (chats.get(profile) ?? 0) + 1);
  }
  const visible = host.agents.filter(agent => !isPersistedChat(agent));
  const hasProfiles = visible.some(agent => agent.kind === "hermes" && agent.id.startsWith("hermes:") && agent.id !== "hermes:default");
  return visible.map(agent => {
    const count = agent.id.startsWith("hermes:") ? chats.get(agent.id.slice("hermes:".length)) ?? 0
      : agent.kind === "hermes" && !hasProfiles ? total : 0;
    if (!count) return agent;
    const label = `${count} chat${count === 1 ? "" : "s"}`;
    return { ...agent, detail: agent.detail ? `${label} · ${agent.detail}` : label };
  });
}

export function emptyHostProfile(host: HostInfo): BotProfile {
  return {
    id: `host:${host.id}`,
    harness: "host",
    name: host.online ? "Online" : "Offline",
    role: "No Dash agents listed",
    description: host.self ? "This computer" : "On the tailnet",
    online: host.online,
  };
}

export function profilesFromHosts(hosts: HostInfo[]): BotProfile[] {
  const out: BotProfile[] = [];
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

export function profileFromAgent(host: HostInfo, agent: AgentInfo): BotProfile {
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
