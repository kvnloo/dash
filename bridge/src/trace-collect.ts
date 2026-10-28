import { Database } from "bun:sqlite";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { extractIntent, discoverArtifacts, readTraceText, tracePath, validateChecks } from "./trace-http";
import { readSessionPhase } from "./hermes-phase";
import { redact } from "./reply-parts";
import type { HostInfo } from "../../shared/protocol";
import type { TraceRow, TraceWorker } from "../../app/src/trace/model";

export const TRACE_RUNS = process.env.DASH_TRACE_RUNS || join(homedir(), ".local/state/dash/runs");
export function traceRoots(): string[] {
  return [TRACE_RUNS, join(homedir(), ".dash/attachments")];
}
const text = (v: unknown): string => typeof v === "string" ? v : "";
const num = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : 0;
function dirs(path: string): string[] { try { return readdirSync(path).map(n => join(path, n)).filter(p => statSync(p).isDirectory()); } catch { return []; } }
function json(path: string, roots: string[]): unknown { try { return JSON.parse(readTraceText(path, roots)); } catch { return null; } }
function worker(id: string, model: string, start: number, end: number, status: TraceWorker["status"], calls = 0): TraceWorker {
  return { id, model, s: start, e: Math.max(start + 1, end), status, calls, errors: 0, asks: [], resumed: false, isResume: false, density: [], fails: [], stalls: [] };
}
/** Read-only, bounded native collection. Never runs commands, probes fleet or writes sibling runs. */
export async function collectTrace(options: { runs?: string; profiles?: string[]; roots?: string[]; fleet?: string; now?: number; hosts?: HostInfo[] } = {}) {
  const now = options.now ?? Date.now(), runs = options.runs ?? TRACE_RUNS, roots = options.roots ?? traceRoots();
  const start = now - 24 * 3600000;
  // The app prints t0 as a wall clock, so it must be the bridge's local time, not UTC.
  const t0 = new Date(start - new Date(start).getTimezoneOffset() * 60000).toISOString().replace(/Z$/, "");
  const rows: TraceRow[] = [], warnings: string[] = [];
  const sorted = dirs(runs).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, 150);
  for (const dir of sorted) {
    const promptPath = join(dir, "PROMPT.txt"), prompt = readTraceText(promptPath, roots);
    if (!prompt) continue;
    const report = readTraceText(join(dir, "REPORT.md"), roots);
    const evidence = extractIntent(prompt, promptPath);
    evidence.artifacts = discoverArtifacts(report).filter(a => !a.target.startsWith("/") || Boolean(tracePath(a.target, roots)));
    // Only exact check-bound structured observations can pass/fail. Prose is not a verifier.
    evidence.checks = validateChecks(evidence.checks, report, json(join(dir, "VALIDATION.json"), roots), path => Boolean(tracePath(path, roots)) && Boolean(readTraceText(path, roots)), evidence.intent.provenance.sourceHash);
    if (report) evidence.artifacts.unshift({ kind: "file", title: "Worker report (claims, not automatic acceptance)", target: join(dir, "REPORT.md"), preview: redact(report.slice(0, 1200)) });
    for (const name of (() => { try { return readdirSync(dir).filter(n => /\.(png|jpe?g|webp)$/i.test(n)).slice(0, 6); } catch { return []; } })()) {
      const target = join(dir, name);
      if (tracePath(target, roots)) evidence.artifacts.push({ kind: /story|sheet/i.test(name) ? "storyboard" : "image", title: name, target });
    }
    evidence.artifacts = evidence.artifacts.slice(0, 64);
    evidence.warnings.push("Run liveness and tool counts are unavailable without a correlated session; no phone verification inferred.");
    const stamp = statSync(promptPath).mtimeMs, end = statSync(dir).mtimeMs;
    rows.push({ key: `run:${basename(dir)}`, project: /dash|trace|composer|mic|orchestra|voice|context|annotate/.test(basename(dir)) ? "Dash" : basename(dir).replace(/^\d{8}-/, "").split("-")[0] || "Runs", goal: basename(dir).replace(/^\d{8}-/, ""), group: "earlier", workers: [worker(basename(dir), "Run · liveness unknown", Math.max(0, (stamp - start) / 1000), Math.max(1, (Math.min(now, end) - start) / 1000), "unknown")], evidence });
    if (rows.length >= 60) break;
  }
  const base = process.env.HERMES_HOME || join(homedir(), ".hermes");
  const homes = options.profiles ?? [...new Set([base, ...dirs(join(base, "profiles"))].flatMap(p => { try { return [realpathSync(p)]; } catch { return []; } }))];
  for (const home of homes.slice(0, 12)) {
    let db: Database | undefined;
    try {
      db = new Database(join(home, "state.db"), { readonly: true });
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=100");
      const columns = new Set(db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().map(c => c.name));
      if (!columns.has("id") || !columns.has("started_at")) continue;
      const fields = ["id", "title", "model", "started_at", "ended_at", "end_reason", "last_activity_at", "parent_session_id", "git_repo_root", "cwd"].map(c => columns.has(c) ? c : `NULL AS ${c}`).join(",");
      const activity = columns.has("last_activity_at") ? "coalesce(last_activity_at,started_at)" : "started_at";
      const sessions = db.query<Record<string, unknown>, [number]>(`SELECT ${fields} FROM sessions WHERE ${activity}>=? ORDER BY ${activity} DESC LIMIT 30`).all(start / 1000);
      for (const s of sessions) {
        const id = text(s.id), phase = readSessionPhase(home, [id], true, now);
        const status = /interrupt|error|fail/i.test(text(s.end_reason)) ? "interrupted" : s.ended_at ? "completed" : phase.observed && phase.phase !== "idle" ? "running" : "unknown";
        const source = `${home}/state.db#sessions/${id}`;
        let evidence;
        try {
          const first = db.query<{ content: string; contentLength: number }, [string]>("SELECT CASE WHEN length(content)<=65000 THEN content ELSE '' END AS content, length(content) AS contentLength FROM messages WHERE session_id=? AND role='user' ORDER BY timestamp LIMIT 1").get(id);
          if (first?.content) {
            const embedded = extractIntent(first.content, source);
            evidence = embedded.quote ? embedded : extractIntent(first.content, source, first.content);
          } else if (first && first.contentLength > 65000) {
            evidence = extractIntent("", source);
            evidence.warnings.push("Original request exceeds bounded read; no truncated quote is presented as verbatim.");
          }
        } catch { warnings.push("Original session request unavailable"); }
        let calls = 0;
        try {
          const events = db.query<{ tool_calls: string }, [string]>("SELECT tool_calls FROM messages WHERE session_id=? AND tool_calls IS NOT NULL ORDER BY timestamp DESC LIMIT 100").all(id);
          for (const e of events) { try { const parsed: unknown = JSON.parse(e.tool_calls); if (Array.isArray(parsed)) calls += parsed.length; } catch { /* malformed tool metadata */ } }
        } catch { warnings.push("Tool metadata unavailable"); }
        const updated = num(s.ended_at) || num(s.last_activity_at) || num(s.started_at);
        rows.push({ key: `hermes:${basename(home)}:${id}`, project: basename(text(s.git_repo_root) || text(s.cwd)) || "Hermes", goal: redact(text(s.title)).slice(0, 100) || "Session · original request not loaded", group: status === "running" ? "live" : now / 1000 - updated < 10800 ? "recent" : "earlier", workers: [worker(id, text(s.model) || "Hermes", Math.max(0, num(s.started_at) - start / 1000), Math.min(now / 1000, updated) - start / 1000, status, calls)], ...(evidence ? { evidence } : {}), provenance: { parentSessionId: text(s.parent_session_id), source } });
      }
    } catch { warnings.push(`${basename(home)} session metadata unavailable`); } finally { db?.close(); }
  }
  const fleet = options.fleet ?? join(homedir(), ".local/state/fleet/runs");
  let logs: string[] = [];
  try { logs = readdirSync(fleet).filter(n => /^\d{8}-\d{6}-[a-f0-9]+-[\w-]+\.log$/.test(n)).sort().reverse().slice(0, 30); } catch { warnings.push("Fleet receipts unavailable"); }
  for (const name of logs) {
    const path = join(fleet, name), stamp = statSync(path).mtimeMs;
    if (stamp < start) continue;
    const log = readTraceText(path, [fleet]), exit = log.match(/\n# exit (\d+)\s*$/)?.[1];
    const evidence = extractIntent("", path);
    evidence.warnings.push(exit === undefined ? "Fleet exit receipt unavailable" : `Fleet process exit ${exit}; not an acceptance verdict. Criterion association requires review.`);
    rows.push({ key: `fleet:${name}`, project: "Fleet", goal: name.replace(/\.log$/, ""), group: now - stamp < 10800000 ? "recent" : "earlier", workers: [worker(name, "fleet-build receipt", Math.max(0, (stamp - start) / 1000), Math.max(1, (stamp - start) / 1000), exit === undefined ? "unknown" : exit === "0" ? "completed" : "interrupted")], evidence });
  }
  for (const host of options.hosts ?? []) for (const agent of host.agents) {
    if (!agent.sessionId || rows.some(r => r.workers.some(w => w.id === agent.sessionId))) continue;
    const updated = agent.lastActivityAt ?? now;
    const live = host.online && agent.status === "running" && now - updated < 5 * 60000;
    rows.push({ key: `roster:${host.id}:${agent.id}`, project: agent.kind, goal: agent.name, group: live ? "live" : "recent", workers: [worker(agent.sessionId, agent.kind, Math.max(0, (updated - start) / 1000), 86400, live ? "running" : "unknown")], provenance: { parentSessionId: "", source: "authenticated bridge roster" } });
  }
  rows.sort((a, b) => ({ live: 0, recent: 1, earlier: 2 }[a.group] - { live: 0, recent: 1, earlier: 2 }[b.group]));
  const workers = rows.flatMap(r => r.workers);
  return { schema: "dash.trace.snapshot/v1", sourceKind: "observations", generatedAt: now, t0, now: 86400, bucketS: 60, read: "Read-only native sessions + run contracts + fleet receipts. Rows are source observations, not a deduplicated worker census. Unknown is not acceptance. Quota, errors and uncorrelated run liveness are not measured.", actions: [], stats: { workers: workers.length, live: workers.filter(w => w.status === "running").length, cut: workers.filter(w => w.status === "interrupted").length, resumed: 0, asks: 0, calls: workers.reduce((n, w) => n + w.calls, 0), errors: 0, claudeUsed: 0, claudeResetH: 0, codexUsed: 0 }, owner: [], rows, warnings: [...new Set(warnings)] };
}
