import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import { parseHosts } from "../../../shared/protocol";
import type { BotProfile } from "../mock/bots";
import type { Settings } from "../model";

export function profilesFromHosts(hosts: HostInfo[]): BotProfile[] {
  const out: BotProfile[] = [];
  for (const host of hosts) {
    if (host.agents.length === 0) {
      out.push({
        id: `host:${host.id}`,
        harness: host.self ? "omp" : "hermes",
        name: host.name,
        role: host.hostname === host.name ? "Host" : host.hostname,
        description: host.online ? "Online on tailnet" : "Offline",
        online: host.online,
      });
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
    harness: agent.kind,
    name: agent.name,
    role: hostLabel,
    description: agent.detail ?? agent.status,
    online: host.online && agent.status !== "offline",
    cwd: agent.cwd,
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
    return parseHosts((raw as { hosts?: unknown }).hosts);
  } catch {
    return undefined;
  }
}
