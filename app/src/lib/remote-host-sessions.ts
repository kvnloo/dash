import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import { isCatalogHarness } from "../../../shared/catalog";

export interface AdoptableSession {
  host: HostInfo;
  agent: AgentInfo;
  key: string;
}

/** Compare raw text without depending on the device's locale. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSessions(left: AdoptableSession, right: AdoptableSession): number {
  if (left.host.self !== right.host.self) return left.host.self ? -1 : 1;

  const byHostName = compareText(left.host.name, right.host.name);
  if (byHostName !== 0) return byHostName;

  // No timestamp sorts behind a known timestamp, including the value zero.
  const leftAt = left.agent.lastActivityAt;
  const rightAt = right.agent.lastActivityAt;
  if (leftAt !== rightAt) {
    if (leftAt === undefined) return 1;
    if (rightAt === undefined) return -1;
    return rightAt - leftAt;
  }

  // The remaining fields break ties independent of roster/agent input order.
  return compareText(left.host.id, right.host.id)
    || compareText(left.agent.kind, right.agent.kind)
    || compareText(left.agent.sessionId ?? "", right.agent.sessionId ?? "")
    || compareText(left.agent.id, right.agent.id)
    || compareText(left.agent.name, right.agent.name)
    || compareText(left.agent.status, right.agent.status);
}

/**
 * Pure roster selection. Local eligibility exactly follows the legacy
 * sessionAgents rule; remote rows additionally require host identity agreement
 * when the agent supplies a hostId. Missing hostId remains valid for old peers.
 */
export function adoptableSessions(
  hosts: readonly HostInfo[],
  options: { includeRemote: boolean },
): AdoptableSession[] {
  const sessions: AdoptableSession[] = [];

  for (const host of hosts) {
    if (!host.online || (!host.self && !options.includeRemote)) continue;

    for (const agent of host.agents) {
      if (agent.status === "offline" || !isCatalogHarness(agent.kind) || !agent.sessionId) continue;
      if (!host.self && agent.hostId !== undefined && agent.hostId !== host.id) continue;

      sessions.push({
        host,
        agent,
        key: host.self
          ? `live:${agent.kind}:${agent.sessionId}`
          : `live:${host.id}:${agent.kind}:${agent.sessionId}`,
      });
    }
  }

  return sessions.sort(compareSessions);
}
