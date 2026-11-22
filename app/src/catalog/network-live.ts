import type { HostInfo } from "../../../shared/protocol";
import type { OrchestraSnapshot } from "../../../shared/orchestra";
import { AODL_NETWORK_IDS, hydrateOrchestras, loadAodlOrchestras, repoIs, type AgentRepo, type AodlNetworkId } from "./orchestra";

/** Observed state of one pinned AODL network node. Never inferred from the catalog itself. */
export interface AodlNodeLive {
  state: "live" | "idle" | "unobserved";
  /** Live sessions in the bridge session graph whose repository or cwd is this node. */
  sessions: number;
  /** Running harness kinds: roster agents (#43 rules) plus graph sessions. */
  harnesses: string[];
}

function pathHas(path: string | undefined, id: string): boolean {
  if (!path) return false;
  return path.replace(/\\/g, "/").split("/").some((part) => part === id);
}

/**
 * The repository root the bridge resolved for each graph session (its "workspace"
 * edge to a repo node, from git rev-parse --show-toplevel), keyed by session node id.
 */
function workspaceRepos(snapshot: OrchestraSnapshot | null): Map<string, string> {
  const repos = new Map<string, string>();
  for (const node of snapshot?.nodes ?? []) if (node.kind === "repo" && node.path) repos.set(node.id, node.path);
  const out = new Map<string, string>();
  for (const edge of snapshot?.edges ?? []) {
    const root = edge.relation === "workspace" ? repos.get(edge.to) : undefined;
    if (root) out.set(edge.from, root);
  }
  return out;
}

/**
 * A session belongs to a node when its repository is that node's repository. A folder
 * that merely sits under a parent named like the node (a CI checkout at .../dash/dash,
 * a scratch dir inside a checkout) is not that repository. Only sessions whose
 * repository the bridge could not resolve fall back to the path rule.
 */
function inNode(root: string | undefined, path: string | undefined, id: string): boolean {
  return root ? repoIs(root, id) : pathHas(path, id);
}

/**
 * Live state per catalog node from the bridge roster (the #43 rules in
 * hydrateOrchestras) plus the bridge's session graph: a live chat or worker
 * whose repository or working directory is the node's repository. Without any
 * bridge evidence every node is "unobserved", never idle.
 */
export function aodlLiveStates(hosts: HostInfo[], snapshot: OrchestraSnapshot | null, now = Date.now()): Map<AodlNetworkId, AodlNodeLive> {
  const observed = hosts.some((host) => host.online) || snapshot !== null;
  const workspaces = workspaceRepos(snapshot);
  // The bridge resolves repositories for its own host's roster only (roster:<host>:<agent> nodes).
  const repoOf: AgentRepo = (host, agent) => host.self ? workspaces.get(`roster:${host.id}:${agent.id}`) : undefined;
  const roster = new Map(hydrateOrchestras(loadAodlOrchestras(), hosts, now, repoOf).map((row) => [row.id, row]));
  const out = new Map<AodlNetworkId, AodlNodeLive>();
  for (const id of AODL_NETWORK_IDS) {
    const row = roster.get(id);
    if (!row) continue;
    if (!observed) { out.set(id, { state: "unobserved", sessions: 0, harnesses: [] }); continue; }
    const harnesses = new Set(row.agents);
    let sessions = 0;
    // Roster rows are represented by row.agents; the graph adds Hermes, delegated and local sessions.
    for (const node of snapshot?.nodes ?? []) {
      if (node.id.startsWith("roster:") || node.state !== "live" || (node.kind !== "chat" && node.kind !== "subagent")) continue;
      if (!inNode(workspaces.get(node.id), node.path, id)) continue;
      sessions++;
      if (node.harness) harnesses.add(node.harness);
    }
    out.set(id, { state: sessions > 0 || harnesses.size > 0 ? "live" : "idle", sessions, harnesses: [...harnesses] });
  }
  return out;
}

export function aodlLiveLabel(live: AodlNodeLive | undefined): string {
  if (!live || live.state === "unobserved") return "Not observed · pair with a bridge";
  if (live.state === "idle") return "Idle · no running session";
  const parts = ["Live"];
  if (live.sessions) parts.push(`${live.sessions} live session${live.sessions === 1 ? "" : "s"}`);
  if (live.harnesses.length) parts.push(live.harnesses.join(", "));
  return parts.join(" · ");
}
