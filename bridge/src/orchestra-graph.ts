import type { HostInfo } from "../../shared/protocol";
import type { OrchestraNode, OrchestraEdge, OrchestraSnapshot, OrchestraState } from "../../shared/orchestra";
import type { KevinItem } from "../../shared/supervision";

export interface GraphSession {
  id: string; title: string; hostId: string; profileId?: string; sessionId?: string; harness?: string; model?: string;
  parent?: string; delegated?: boolean; state: OrchestraState; reason: string; action?: string;
  cwd?: string; repo?: string; branch?: string; touched: string[]; updatedAt: number; provenance: string[];
}
export interface RepoEvidence { path: string; branch?: string; dirty?: number }
export function buildOrchestra(input: { hosts: HostInfo[]; sessions: GraphSession[]; repos?: RepoEvidence[]; needs?: KevinItem[]; health?: Record<string, string>; now: number; hours?: number; limit?: number; warnings?: string[] }): OrchestraSnapshot {
  const nodes: OrchestraNode[] = [], edges: OrchestraEdge[] = [];
  const hours = input.hours ?? 24;
  const addEdge = (from: string, to: string, relation: OrchestraEdge["relation"], active: boolean, provenance: string[]) => {
    const id = `${relation}:${from}:${to}`;
    if (!edges.some(e => e.id === id)) edges.push({ id, from, to, relation, active, provenance });
  };
  const hostIds = new Map<string, string>();
  for (const h of input.hosts) {
    const id = `host:${h.id}`; hostIds.set(h.id, id);
    nodes.push({ id, hostId: id, label: h.hostname || h.name, kind: "host", state: "idle", online: h.online, health: input.health?.[h.hostname ?? h.name], reason: h.online ? "Online · bridge roster" : "Offline · bridge roster", provenance: ["bridge roster"] });
  }
  const recent = input.sessions.filter(s => s.updatedAt >= input.now - hours * 3600000);
  const byId = new Map(input.sessions.map(s => [s.id, s]));
  // Keep recorded parents even outside the time window. Compression continuations
  // are NOT delegation; the collector only sets parent on real delegated children.
  for (const s of [...recent]) {
    let parent = s.parent;
    const seen = new Set([s.id]);
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const p = byId.get(parent); if (!p) break;
      if (!recent.some(r => r.id === p.id)) recent.push(p);
      parent = p.parent;
    }
  }
  for (const s of recent) {
    const hostId = hostIds.get(s.hostId) ?? `host:${s.hostId}`;
    if (!nodes.some(n => n.id === hostId)) nodes.push({ id: hostId, hostId, label: s.hostId, kind: "host", state: "idle", online: true, provenance: ["local collector"] });
    nodes.push({ id: s.id, hostId, label: s.title || "Untitled session", kind: s.delegated ? "subagent" : "chat", state: s.state, reason: s.reason, action: s.action, parentId: s.parent, path: s.repo || s.cwd, branch: s.branch, sessionId: s.sessionId, profileId: s.profileId, harness: s.harness, model: s.model, updatedAt: s.updatedAt, provenance: s.provenance });
    addEdge(hostId, s.id, "hosted", false, s.provenance);
    for (const path of new Set([s.repo, ...s.touched].filter((v): v is string => Boolean(v)))) {
      const id = `repo:${s.hostId}:${path}`;
      if (!nodes.some(n => n.id === id)) {
        const repo = input.repos?.find(r => r.path === path);
        nodes.push({ id, hostId, label: path.split("/").filter(Boolean).at(-1) || path, kind: "repo", state: "idle", path, branch: repo?.branch ?? s.branch, dirty: repo?.dirty, provenance: ["git rev-parse --show-toplevel", ...s.provenance] });
      }
      if (s.repo === path) addEdge(s.id, id, "workspace", false, ["sessions.git_repo_root"]);
      if (s.touched.includes(path)) addEdge(s.id, id, "touched", s.state === "live", ["messages.tool_calls"]);
    }
  }
  for (const s of recent) if (s.parent) {
    if (!nodes.some(n => n.id === s.parent)) nodes.push({ id: s.parent, hostId: hostIds.get(s.hostId) ?? `host:${s.hostId}`, kind: "chat", label: s.parent === "orchestrator" ? "Orchestrator · parent unrecorded" : "Parent session · outside snapshot", state: "idle", reason: "Virtual anchor; no launcher identity recorded", provenance: s.provenance });
    if (s.id !== s.parent) addEdge(s.parent, s.id, "delegated", s.state === "live", s.provenance);
  }
  for (const item of input.needs ?? []) {
    const existing = nodes.find(n => n.id === item.worker || n.provenance?.includes(item.evidence_path));
    if (existing) Object.assign(existing, { state: "needs-you", reason: item.why, action: item.recommended_action });
    else nodes.push({ id: `needs:${item.id}`, label: item.goal || item.worker, kind: "subagent", state: "needs-you", hostId: nodes.find(n => n.kind === "host")?.id ?? "host:unknown", reason: item.why, action: item.recommended_action, provenance: [item.evidence_path, "needs-kevin.json"] });
  }
  // W1 is per worktree path, never per common Git directory. Workspace ownership
  // counts even before a first write; touches count independently of cwd.
  for (const repo of nodes.filter(n => n.kind === "repo")) {
    const owners = new Set(edges.filter(e => e.to === repo.id && (e.relation === "touched" || e.relation === "workspace") && nodes.some(n => n.id === e.from && n.state === "live")).map(e => e.from));
    if (owners.size >= 2) { repo.collision = true; repo.state = "failing"; repo.reason = `W1 collision · ${owners.size} live owners on one worktree`; repo.action = "Choose one owner; move other sessions to isolated worktrees"; }
    else repo.reason = `${owners.size} live owner${owners.size === 1 ? "" : "s"} · ${repo.dirty === undefined ? "dirty count unavailable" : `${repo.dirty} dirty files`}`;
  }
  const rank = (n: OrchestraNode) => n.state === "needs-you" ? 0 : n.collision ? 1 : n.kind === "host" ? 2 : n.state === "failing" ? 3 : n.state === "live" || edges.some(e => e.relation === "delegated" && e.from === n.id && nodes.some(child => child.id === e.to && child.state === "live")) ? 4 : n.kind === "repo" ? 5 : 6;
  const limit = Math.max(2, Math.min(150, input.limit ?? 150));
  const sorted = [...nodes].sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const kept = sorted.length > limit ? sorted.slice(0, limit - 1) : sorted;
  const omitted = nodes.length - kept.length;
  if (omitted) kept.push({ id: "group:more", hostId: "", label: `+${omitted} more`, kind: "chat", state: "idle", grouped: omitted, reason: `${hours}h snapshot capped at ${limit} nodes`, provenance: ["snapshot cap"] });
  const ids = new Set(kept.map(n => n.id));
  return { nodes: kept, edges: edges.filter(e => ids.has(e.from) && ids.has(e.to)), generatedAt: input.now, hours, warnings: input.warnings ?? [] };
}

/** Extract path evidence, never send arguments or command strings to the client.
 * A terminal cwd proves repository involvement, not an actual file write. */
export function toolPaths(raw: unknown, cwd?: string): string[] {
  let calls: unknown = raw;
  if (typeof calls === "string") try { calls = JSON.parse(calls); } catch { return []; }
  if (!Array.isArray(calls)) return [];
  const paths: string[] = [];
  for (const call of calls) {
    if (!record(call) || !record(call.function) || typeof call.function.name !== "string") continue;
    const name = call.function.name.split(".").at(-1);
    if (!["write_file", "patch", "terminal"].includes(name ?? "")) continue;
    let args: unknown = call.function.arguments;
    if (typeof args === "string") try { args = JSON.parse(args); } catch { continue; }
    if (!record(args)) continue;
    // A cwd on `git status`, tests, or a directory listing is not a write. Only
    // explicit mutation commands establish touched evidence; never execute them.
    if (name === "terminal" && (typeof args.command !== "string" || !/\bgit\s+(?:apply|add|commit|checkout|switch|merge|rebase|cherry-pick|reset|restore|am)\b|\bsed\s+[^;\n]*-i\b/.test(args.command))) continue;
    const path = name === "terminal" ? args.workdir ?? args.cwd ?? cwd : args.path ?? args.file_path;
    if (typeof path === "string" && path && !path.includes("\0")) paths.push(path.startsWith("/") ? path : cwd ? `${cwd}/${path}` : "");
  }
  return [...new Set(paths.filter(Boolean))];
}
export function record(v: unknown): v is Record<string, unknown> { return typeof v === "object" && v !== null && !Array.isArray(v); }
