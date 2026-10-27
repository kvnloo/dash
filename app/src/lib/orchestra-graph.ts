import type { HostInfo } from "../../../shared/protocol";

export const GRAPH_CHATS_PER_HOST = 12;

/**
 * The hosts the Orchestra graph draws: online computers and their most recent real
 * sessions (bare harness entries are launchers, not chats). Keeps the graph readable on a
 * phone; the full list stays in Chats.
 */
export function graphHosts(hosts: HostInfo[], limit = GRAPH_CHATS_PER_HOST): HostInfo[] {
  return hosts
    .filter(h => h.online)
    .map(h => ({ ...h, agents: h.agents.filter(a => Boolean(a.sessionId)).sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)).slice(0, limit) }))
    .filter(h => h.agents.length > 0);
}
