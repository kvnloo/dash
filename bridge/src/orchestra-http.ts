import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, hostname } from "node:os";
import { spawnSync } from "node:child_process";
import type { HostInfo } from "../../shared/protocol";
import type { OrchestraSnapshot, OrchestraState } from "../../shared/orchestra";
import { parseKevinBatch, type KevinItem } from "../../shared/supervision";
import type { RoadmapDocument } from "../../shared/roadmap";
import { readRoadmap } from "./roadmap-store";
import { buildOrchestra, record, toolPaths, reconcileWorkerEvidence, type GraphSession, type RepoEvidence } from "./orchestra-graph";
import { readSessionPhase } from "./hermes-phase";
import { DEFAULT_SUPERVISION_DIR } from "./supervision-http";
import { redact } from "./reply-parts";

/** Roadmap items waiting on the owner, as Needs-you triage items (same lane as the supervision batch). */
export function roadmapNeeds(doc: RoadmapDocument): KevinItem[] {
  return doc.items.filter(i => i.attention === "you").map(i => ({ id: `roadmap:${i.id}`, worker: "roadmap", goal: i.title, why: i.evidence || "Waiting on you (Dash roadmap)", recommended_action: i.next || i.title, options: [], evidence_path: "dash roadmap", phase: "waiting-on-you" }));
}
const text = (v: unknown) => typeof v === "string" ? v : "";
const number = (v: unknown) => typeof v === "number" ? v : 0;
function json(path: string): unknown { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; } }
function dirs(path: string): string[] { try { return readdirSync(path).map(name => join(path, name)).filter(p => statSync(p).isDirectory()); } catch { return []; } }
function run(args: string[], cwd?: string): string { const result = spawnSync(args[0]!, args.slice(1), { cwd, encoding: "utf8", timeout: 1500, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }); return result.status === 0 ? result.stdout.trim() : ""; }
function profiles(): string[] {
  const candidates = process.env.DASH_ORCHESTRA_PROFILES?.split(":") ?? [join(homedir(), ".hermes"), ...dirs("/workspace/hermes-home/profiles"), ...dirs(join(homedir(), ".hermes/profiles"))];
  return [...new Set(candidates.flatMap(p => { try { return [realpathSync(p)]; } catch { return []; } }))].filter(p => existsSync(join(p, "state.db")));
}
export async function collectOrchestra(hosts: HostInfo[], hours = 24, now = Date.now()): Promise<OrchestraSnapshot> {
  const sessions: GraphSession[] = [], repos = new Map<string, RepoEvidence>(), warnings: string[] = [];
  const local = hosts.find(h => h.self)?.id ?? hostname();
  const resolveCache = new Map<string, string>();
  function repoFor(path: string): string {
    if (resolveCache.has(path)) return resolveCache.get(path) ?? "";
    let cwd = path;
    try { if (!statSync(cwd).isDirectory()) cwd = dirname(cwd); } catch { cwd = dirname(cwd); }
    // Bounded read-only Git metadata, no network or worktree locks.
    const root = resolveCache.size < 100 ? run(["git", "-C", cwd, "rev-parse", "--show-toplevel"]) : "";
    resolveCache.set(path, root);
    if (root && !repos.has(root)) {
      const status = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8", timeout: 1500, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
      repos.set(root, { path: root, branch: run(["git", "-C", root, "branch", "--show-current"]), dirty: status.status === 0 ? status.stdout.split("\n").filter(Boolean).length : undefined });
    }
    return root;
  }
  for (const home of profiles()) {
    let db: Database | undefined;
    const profile = home.split("/").at(-1) || "default";
    try {
      db = new Database(join(home, "state.db"), { readonly: true });
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=100;");
      // Select metadata only; never system prompts, full transcripts or model config.
      const columns = new Set(db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().map(c => c.name));
      if (!columns.has("id")) continue; // Empty legacy profile, not a session store.
      const select = ["id", "source", "title", "model", "parent_session_id", "started_at", "ended_at", "end_reason", "last_activity_at", "cwd", "git_repo_root", "git_branch"].map(c => columns.has(c) ? c : `NULL AS ${c}`).join(",");
      const activity = columns.has("last_activity_at") ? "coalesce(last_activity_at,started_at)" : "started_at";
      const rows = db.query<Record<string, unknown>, [number]>(`SELECT ${select} FROM sessions WHERE ${activity}>=? ORDER BY ${activity} DESC LIMIT 200`).all((now - hours * 3600000) / 1000);
      const seenParents = new Set(rows.map(r => text(r.id)));
      for (let i = 0; i < rows.length && i < 300; i++) {
        const row = rows[i];
        const parent = text(row?.parent_session_id);
        if (!parent || seenParents.has(parent)) continue;
        seenParents.add(parent);
        const ancestor = db.query<Record<string, unknown>, [string]>(`SELECT ${select} FROM sessions WHERE id=?`).get(parent);
        if (ancestor) rows.push(ancestor);
      }
      const parentEndReasons = new Map(rows.map(row => [text(row.id), text(row.end_reason)]));
      for (const row of rows) {
        const rawId = text(row.id); if (!rawId) continue;
        const id = `hermes:${profile}:${rawId}`;
        if (sessions.some(s => s.id === id)) continue;
        const parentId = text(row.parent_session_id);
        // Hermes delegates often have source=acp; compression continuation is not delegation.
        const delegated = row.source === "subagent" || Boolean(parentId && parentEndReasons.get(parentId) !== "compression");
        const endedWorker = delegated && (row.ended_at !== null && row.ended_at !== undefined || Boolean(text(row.end_reason)));
        const phase = readSessionPhase(home, [rawId], true, now);
        const failing = /interrupt|error|fail|stall/i.test(text(row.end_reason));
        const state: OrchestraState = endedWorker ? "done" : failing ? "failing" : phase.phase === "waiting-approval" ? "needs-you" : phase.phase !== "idle" ? "live" : row.ended_at ? "done" : "idle";
        const cwd = text(row.cwd);
        const repo = text(row.git_repo_root) || (cwd ? repoFor(cwd) : "");
        if (repo) repoFor(repo);
        const touched = new Set<string>();
        try {
          const messages = db.query<{ tool_calls: string }, [string, number]>("SELECT tool_calls FROM messages WHERE session_id=? AND timestamp>=? AND tool_calls IS NOT NULL AND coalesce(active,1)=1 ORDER BY timestamp DESC LIMIT 100").all(rawId, (now - hours * 3600000) / 1000);
          for (const m of messages) for (const path of toolPaths(m.tool_calls, cwd)) { const root = repoFor(path); if (root) touched.add(root); }
        } catch { warnings.push(`${profile}: tool evidence unavailable`); }
        let title = text(row.title);
        if (!title) {
          const first = db.query<{ content: string }, [string]>("SELECT substr(content,1,500) AS content FROM messages WHERE session_id=? AND role='user' ORDER BY timestamp LIMIT 1").get(rawId);
          title = redact(text(first?.content)).replace(/\s+/g, " ").slice(0, 100);
        }
        sessions.push({ id, sessionId: rawId, title: title || `${delegated ? "Worker" : "Hermes"} · ${rawId}`,  profileId: profile, harness: "hermes", model: text(row.model), hostId: local, parent: delegated && row.parent_session_id ? `hermes:${profile}:${text(row.parent_session_id)}` : undefined, delegated, state, reason: failing ? text(row.end_reason) : phase.observed ? `Terminal phase: ${phase.phase}` : row.ended_at ? "Session ended" : "No live phase observed", action: failing ? "Inspect worker evidence before resuming" : state === "needs-you" ? "Review requested clarification or approval" : undefined, cwd, repo, branch: text(row.git_branch), touched: [...touched], updatedAt: number(row.last_activity_at) * 1000 || number(row.started_at) * 1000, provenance: [`${home}/state.db#sessions/${rawId}`] });
      }
    } catch { warnings.push(`${profile}: session metadata unavailable`); } finally { db?.close(); }
    // Manifest status is authoritative for delegation workers with no persisted row.
    for (const dir of dirs(join(home, "cache/delegation/live"))) {
      const manifest = json(join(dir, "manifest.json"));
      if (!record(manifest) || !Array.isArray(manifest.tasks)) continue;
      const updatedAt = Date.parse(text(manifest.completed) || text(manifest.started));
      if (!Number.isFinite(updatedAt) || updatedAt < now - hours * 3600000) continue;
      for (const task of manifest.tasks) if (record(task)) {
        const log = text(task.log), index = number(task.index);
        const sessionId = text(task.session_id);
        if (sessionId && sessions.some(s => s.id === `hermes:${profile}:${sessionId}`)) continue;
        sessions.push({ id: `${text(manifest.delegation_id)}/task-${index}`, title: text(task.goal).slice(0, 100) || "Delegated worker", hostId: local, delegated: true, parent: text(manifest.parent_session_id) ? `hermes:${profile}:${text(manifest.parent_session_id)}` : "orchestrator", state: /interrupt|fail|error/.test(text(task.status)) ? "failing" : /complete|done/.test(text(task.status)) ? "done" : "live", reason: `Delegation manifest: ${text(task.status) || "running"}`, updatedAt, touched: [], provenance: [log, join(dir, "manifest.json")] });
      }
    }
  }
  // Preserve non-Hermes sessions as plain chats unless their own store proves parentage.
  for (const h of hosts) for (const a of h.agents) if (a.sessionId && !(h.self && a.kind === "hermes")) {
    const repo = h.self && a.cwd ? repoFor(a.cwd) : a.cwd;
    sessions.push({ id: `roster:${h.id}:${a.id}`, sessionId: a.sessionId, title: a.name, hostId: h.id, harness: a.kind, state: a.status === "running" ? "live" : "idle", reason: `Bridge roster: ${a.status}`, cwd: a.cwd, repo, updatedAt: a.lastActivityAt ?? now, touched: [], provenance: ["bridge roster"] });
  }
  const units = run(["systemctl", "--user", "list-units", "sol-*", "--all", "--plain", "--no-legend", "--no-pager"]);
  for (const line of units.split("\n")) {
    const [unit, , active] = line.trim().split(/\s+/); if (!unit?.startsWith("sol-")) continue;
    const stamp = run(["systemctl", "--user", "show", unit, `--property=${active === "active" ? "ActiveEnterTimestamp" : "InactiveEnterTimestamp"}`, "--value"]);
    const changedAt = Date.parse(stamp);
    if (active !== "active" && (!Number.isFinite(changedAt) || changedAt < now - hours * 3600000)) continue;
    const command = run(["systemctl", "--user", "show", unit, "--property=ExecStart", "--value"]);
    const runDir = command.match(/--query-file (\/mnt\/zer0models\/workspace\/zer0\/data\/operations\/sol-runs\/[^\s;]+)\/PROMPT.txt/)?.[1];
    const meta = runDir ? json(join(runDir, "metadata.json")) : undefined;
    const parent = record(meta) ? text(meta.parent_session_id) : "";
    sessions.push({ id: unit, title: unit.replace(/^sol-|\.service$/g, ""), hostId: local, harness: "sol", delegated: true, parent: (parent ? sessions.find(s => s.sessionId === parent)?.id ?? parent : "orchestrator"), state: active === "failed" ? "failing" : active === "active" ? "live" : "done", reason: `systemd unit ${active ?? "unknown"}`, action: active === "failed" ? "Inspect run.log and unit failure" : undefined, cwd: runDir, touched: [], updatedAt: active === "active" ? now : changedAt, provenance: [unit, ...(runDir ? [runDir] : [])] });
  }
  const health: Record<string, string> = {};
  // Read cached fleet health only: never probe SSH/ADB or mutate cordon state.
  let registry: unknown;
  try { registry = Bun.YAML.parse(readFileSync("/workspace/.files-k3s/config/fleet/nodes.yaml", "utf8")); } catch { warnings.push("Fleet registry unavailable"); }
  const fleetHosts = [...hosts];
  if (record(registry) && record(registry.nodes)) for (const name of Object.keys(registry.nodes)) {
    const path = join(homedir(), ".local/state/fleet/health", `${name}.json`), sample = json(path);
    const fresh = record(sample) && now - number(sample.ts) * 1000 < 10 * 60000;
    if (!fleetHosts.some(h => h.hostname === name || h.name === name)) fleetHosts.push({ id: name, name, hostname: name, online: Boolean(fresh && record(sample) && record(sample.probe) && !sample.probe.error), self: false, agents: [] });
    if (record(sample) && record(sample.probe)) {
      const p = sample.probe;
      const load = typeof p.load1 === "number" ? `load ${p.load1.toFixed(1)}/${number(p.ncpu)} CPU` : "CPU unavailable";
      const mem = typeof p.mem_available_mb === "number" ? `mem ${p.mem_available_mb}/${number(p.mem_total_mb)} MB free` : "mem unavailable";
      const temp = typeof p.max_temp_c === "number" ? `${p.max_temp_c}°C` : "thermal unavailable";
      health[name] = `${fresh ? "" : "Stale · "}${p.error ? "Offline · probe failed" : `${load} · ${mem} · ${temp}`} · ${sample.healthy ? "healthy" : "degraded"}`;
    }
  }
  const supervision = json(join(DEFAULT_SUPERVISION_DIR, "state.json"));
  if (record(supervision) && Array.isArray(supervision.workers)) reconcileWorkerEvidence(sessions, supervision.workers);
  const batch = parseKevinBatch(json(join(DEFAULT_SUPERVISION_DIR, "needs-kevin.json")));
  if (!batch) warnings.push("Needs Kevin queue unavailable");
  let roadmap: KevinItem[] = [];
  try { roadmap = roadmapNeeds(readRoadmap()); } catch { warnings.push("Dash roadmap unavailable"); }
  return buildOrchestra({ hosts: fleetHosts, sessions, repos: [...repos.values()], needs: [...roadmap, ...(batch?.items ?? [])], health, now, hours, warnings: [...new Set(warnings)] });
}
export function createOrchestraHttpHandler(options: { authorize(request: Request): Promise<boolean>; roster(): Promise<HostInfo[]> }) {
  let cache: OrchestraSnapshot | undefined;
  let pending: Promise<OrchestraSnapshot> | undefined;
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== "/orchestra/graph") return null;
    if (!await options.authorize(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
    const hours = Math.min(24, Math.max(1, Number(url.searchParams.get("hours")) || 24));
    if (!cache || Date.now() - cache.generatedAt > 15000 || cache.hours !== hours) {
      pending ??= options.roster().then(hosts => collectOrchestra(hosts, hours)).finally(() => { pending = undefined; });
      cache = await pending;
    }
    return Response.json(cache, { headers: { "Cache-Control": "no-store" } });
  };
}
