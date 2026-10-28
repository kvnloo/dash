// Projects, features and tasks tracked in git, in the format of the zer0-pm repository (_pm):
// one recursive issue record (project, feature, task, ... are only types) and an append-only
// event ledger, `pm/events.jsonl`, that is the only authority. The graph below is a
// deterministic fold of that ledger; nothing else is stored. Pure: no IO here.
//
// Ledger row (the _pm envelope):
//   {"v":1,"source":"dash-pm","kind":"issue.created","subject":"issue:<id>","causation":"…",
//    "seq":1,"ts_ns":0,"payload":{"id":"<id>","kind":6,"type":"task","parent":"<id>","title":"…"}}
// Kinds: issue.created {id, kind, type, parent, title} · issue.state {id, from, to} ·
//        issue.updated {id, set:{…}} · issue.parent {id, from, to} · issue.linked {from, to, relation}
// Ids are path slugs ("dash/roadmap/app-screen") rather than _pm's dense integers, so issues
// added on two branches never collide when git merges the ledger.

/** _pm kernel type ids (contracts.issue_types): every level is the same recursive issue. */
export const PM_TYPE_IDS = { company: 1, portfolio: 2, product: 3, project: 4, feature: 5, task: 6, defect: 7, dependency: 8, owner: 9, objective: 10 } as const;
export type PmType = keyof typeof PM_TYPE_IDS;
export const PM_STATES = ["todo", "running", "blocked", "review", "done"] as const;
export type PmState = (typeof PM_STATES)[number];
export const PM_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type PmPriority = (typeof PM_PRIORITIES)[number];

/** Fields an `issue.updated` row may set. `hermes`: a Hermes kanban task id; `roadmap`: a roadmap.json item id. */
export interface PmFields {
  priority?: PmPriority;
  progress?: number;
  evidence?: string;
  next?: string;
  detail?: string;
  pr?: string;
  assignee?: string;
  hermes?: string;
  roadmap?: string;
  /** `you`: waits on the owner. */
  attention?: "you";
}

/** Live status the bridge adds from the Hermes board; never stored in the ledger. */
export interface PmKanban { id: string; status: string; assignee?: string }

export interface PmIssue extends PmFields {
  id: string;
  type: PmType;
  title: string;
  parent?: string;
  state: PmState;
  /** Repository whose ledger holds this issue. */
  repo: string;
  /** Last ledger change, epoch ms (from ts_ns). */
  updatedAt?: number;
  links?: { to: string; relation: string }[];
  kanban?: PmKanban;
  /** Sources the bridge overlaid live values from ("hermes", "roadmap"). */
  live?: string[];
}

export interface PmGraph { issues: PmIssue[]; errors: string[] }

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = 2000): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const ID = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
const isId = (v: unknown): v is string => typeof v === "string" && v.length <= 160 && ID.test(v);
const PM_TYPES = Object.keys(PM_TYPE_IDS);
const isType = (v: unknown): v is PmType => typeof v === "string" && PM_TYPES.includes(v);
const isState = (v: unknown): v is PmState => PM_STATES.some(s => s === v);
const isPriority = (v: unknown): v is PmPriority => PM_PRIORITIES.some(p => p === v);

function fields(raw: unknown): PmFields | null {
  if (!record(raw)) return null;
  const out: PmFields = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "priority" && isPriority(v)) out.priority = v;
    else if (k === "progress" && typeof v === "number" && Number.isFinite(v)) out.progress = Math.max(0, Math.min(100, Math.round(v)));
    else if ((k === "evidence" || k === "next" || k === "detail" || k === "pr" || k === "assignee") && text(v)) out[k] = v;
    else if (k === "hermes" && typeof v === "string" && /^t_[0-9a-f]{6,16}$/.test(v)) out.hermes = v;
    else if (k === "roadmap" && typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v)) out.roadmap = v;
    else if (k === "attention" && v === "you") out.attention = "you";
    else return null;
  }
  return out;
}

/**
 * Fold ledger rows (already JSON-parsed, in file order; `undefined` = a blank line) into the
 * issue graph. A row that is malformed, or names an unknown issue or parent, is skipped and
 * reported in `errors`: one bad line never hides the rest of a repository's work.
 */
export function foldLedger(rows: readonly unknown[], repo: string): PmGraph {
  const issues = new Map<string, PmIssue>();
  const errors: string[] = [];
  rows.forEach((row, i) => {
    if (row === undefined) return;
    const where = `${repo} pm/events.jsonl:${i + 1}`;
    if (!record(row) || row.v !== 1 || typeof row.kind !== "string" || !record(row.payload)) { errors.push(`${where}: not a ledger row`); return; }
    const p = row.payload;
    const at = typeof row.ts_ns === "number" && row.ts_ns > 0 ? Math.floor(row.ts_ns / 1e6) : undefined;
    const touch = (issue: PmIssue) => { if (at !== undefined) issue.updatedAt = Math.max(issue.updatedAt ?? 0, at); };
    switch (row.kind) {
      case "issue.created": {
        if (!isId(p.id) || !isType(p.type) || !text(p.title, 300) || (p.parent !== undefined && p.parent !== null && !isId(p.parent))) { errors.push(`${where}: bad issue.created`); return; }
        if (p.kind !== undefined && p.kind !== PM_TYPE_IDS[p.type]) { errors.push(`${where}: kind ${String(p.kind)} is not type ${p.type}`); return; }
        if (issues.has(p.id)) { errors.push(`${where}: ${p.id} already exists`); return; }
        const parent = typeof p.parent === "string" ? p.parent : undefined;
        if (parent && !issues.has(parent)) { errors.push(`${where}: parent ${parent} is unknown`); return; }
        const issue: PmIssue = { id: p.id, type: p.type, title: p.title, state: "todo", repo, ...(parent ? { parent } : {}) };
        touch(issue);
        issues.set(p.id, issue);
        return;
      }
      case "issue.state": {
        const issue = isId(p.id) ? issues.get(p.id) : undefined;
        if (!issue || !isState(p.to)) { errors.push(`${where}: bad issue.state`); return; }
        issue.state = p.to; touch(issue);
        return;
      }
      case "issue.updated": {
        const issue = isId(p.id) ? issues.get(p.id) : undefined;
        const set = fields(p.set);
        if (!issue || !set) { errors.push(`${where}: bad issue.updated`); return; }
        Object.assign(issue, set); touch(issue);
        return;
      }
      case "issue.parent": {
        const issue = isId(p.id) ? issues.get(p.id) : undefined;
        const to = typeof p.to === "string" ? p.to : undefined;
        if (!issue || (to !== undefined && !issues.has(to))) { errors.push(`${where}: bad issue.parent`); return; }
        for (let a = to; a; a = issues.get(a)?.parent) if (a === issue.id) { errors.push(`${where}: parent cycle`); return; }
        if (to) issue.parent = to; else delete issue.parent;
        touch(issue);
        return;
      }
      case "issue.linked": {
        const from = isId(p.from) ? issues.get(p.from) : undefined;
        if (!from || !isId(p.to) || !issues.has(p.to) || !text(p.relation, 40)) { errors.push(`${where}: bad issue.linked`); return; }
        const links = from.links ?? (from.links = []);
        if (!links.some(l => l.to === p.to && l.relation === p.relation)) links.push({ to: p.to, relation: p.relation });
        touch(from);
        return;
      }
      default:
        // intent.attached and other _pm rows are evidence, not graph changes.
        return;
    }
  });
  return { issues: [...issues.values()], errors };
}

/** Parse ledger text (JSONL). Unparseable lines become errors with their line number. */
export function parseLedger(body: string, repo: string): PmGraph {
  const bad: string[] = [];
  const rows = body.split("\n").map((line, i): unknown => {
    if (!line.trim()) return undefined;
    try { return JSON.parse(line); } catch { bad.push(`${repo} pm/events.jsonl:${i + 1}: not JSON`); return undefined; }
  });
  const graph = foldLedger(rows, repo);
  return { issues: graph.issues, errors: [...bad, ...graph.errors] };
}

/** The wire document of GET /pm. */
export interface PmDocument { issues: PmIssue[]; repos: { repo: string; issues: number; errors: string[] }[]; kanban: "live" | "unavailable" | "off" }

const WIRE_KEYS = new Set(["id", "type", "title", "state", "repo", "parent", "updatedAt", "links", "kanban", "live"]);

function parseIssue(v: unknown): PmIssue | null {
  if (!record(v) || !isId(v.id) || !isType(v.type) || !text(v.title, 300) || !isState(v.state) || !text(v.repo, 120)) return null;
  const set = fields(Object.fromEntries(Object.entries(v).filter(([k, x]) => !WIRE_KEYS.has(k) && x !== undefined)));
  if (!set) return null;
  const issue: PmIssue = { id: v.id, type: v.type, title: v.title, state: v.state, repo: v.repo, ...set };
  if (isId(v.parent)) issue.parent = v.parent;
  if (typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt)) issue.updatedAt = v.updatedAt;
  if (Array.isArray(v.links)) issue.links = v.links.flatMap(l => record(l) && isId(l.to) && text(l.relation, 40) ? [{ to: l.to, relation: l.relation }] : []);
  const k = v.kanban;
  if (record(k) && typeof k.id === "string" && text(k.status, 40)) issue.kanban = { id: k.id, status: k.status, ...(text(k.assignee, 80) ? { assignee: k.assignee } : {}) };
  if (Array.isArray(v.live)) issue.live = v.live.filter((s): s is string => text(s, 20));
  return issue;
}

export function parsePmDocument(raw: unknown): PmDocument | null {
  if (!record(raw) || !Array.isArray(raw.issues) || raw.issues.length > 5000 || !Array.isArray(raw.repos)) return null;
  const issues: PmIssue[] = [];
  for (const v of raw.issues) { const issue = parseIssue(v); if (issue) issues.push(issue); }
  const repos = raw.repos.flatMap(r => record(r) && text(r.repo, 120) && typeof r.issues === "number" && Array.isArray(r.errors)
    ? [{ repo: r.repo, issues: r.issues, errors: r.errors.filter((e): e is string => typeof e === "string").slice(0, 50) }] : []);
  const kanban = raw.kanban === "live" || raw.kanban === "unavailable" ? raw.kanban : "off";
  return { issues, repos, kanban };
}

// ---- views (same ordering rules as the roadmap's minimal view) --------------------------------

const rank = (i: PmIssue) => i.priority ? PM_PRIORITIES.indexOf(i.priority) : PM_PRIORITIES.length;
const STATE_ORDER: Record<PmState, number> = { blocked: 0, running: 1, review: 2, todo: 3, done: 4 };

/** Running and blocked first, done last; then priority. */
export function byAttention(a: PmIssue, b: PmIssue): number {
  return STATE_ORDER[a.state] - STATE_ORDER[b.state] || rank(a) - rank(b) || a.title.localeCompare(b.title);
}

export function childrenOf(issues: readonly PmIssue[], id: string | undefined): PmIssue[] {
  return issues.filter(i => i.parent === id);
}

/** Every task-like issue (task, defect) at any depth below `id`. */
export function tasksUnder(issues: readonly PmIssue[], id: string): PmIssue[] {
  const out: PmIssue[] = [];
  const walk = (parent: string) => {
    for (const c of childrenOf(issues, parent)) {
      if (c.type === "task" || c.type === "defect") out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out.sort(byAttention);
}

/** The issue's parents, outermost first. */
export function ancestors(issues: readonly PmIssue[], issue: PmIssue): PmIssue[] {
  const byId = new Map(issues.map(i => [i.id, i]));
  const out: PmIssue[] = [];
  for (let parent = issue.parent ? byId.get(issue.parent) : undefined; parent && out.length < 32; parent = parent.parent ? byId.get(parent.parent) : undefined) out.unshift(parent);
  return out;
}

export function projects(issues: readonly PmIssue[]): PmIssue[] {
  return issues.filter(i => i.type === "project" || i.type === "product").sort((a, b) => a.title.localeCompare(b.title));
}

export function features(issues: readonly PmIssue[], projectId: string): PmIssue[] {
  return childrenOf(issues, projectId).filter(i => i.type === "feature").sort(byAttention);
}

/** Done share of the tasks under `id` (progress counts for tasks that report it). */
export function progressUnder(issues: readonly PmIssue[], id: string): { done: number; total: number; percent: number } {
  const tasks = tasksUnder(issues, id);
  const value = (t: PmIssue) => t.state === "done" ? 100 : t.progress ?? 0;
  const percent = tasks.length ? Math.round(tasks.reduce((n, t) => n + value(t), 0) / tasks.length) : 0;
  return { done: tasks.filter(t => t.state === "done").length, total: tasks.length, percent };
}

/** The issue's pull request as a URL: `pr` as a URL, or a bare number (kvnloo/dash). */
export function pmPrUrl(issue: PmIssue): string | undefined {
  const pr = issue.pr?.trim();
  if (!pr) return undefined;
  if (/^#?\d{1,6}$/.test(pr)) return `https://github.com/kvnloo/dash/pull/${pr.replace("#", "")}`;
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr) ? pr : undefined;
}
