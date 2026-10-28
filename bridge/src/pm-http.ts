// GET /pm: the projects, features and tasks that repositories track in git (`pm/events.jsonl`,
// shared/pm.ts), for the app's Roadmap screen. The ledgers are the authority; the bridge only
// overlays live status where a task links to it: its Hermes kanban card (`hermes`) and its item
// in the host roadmap file (`roadmap`, the file the Tern pane and `dash-roadmap` use).
//
//   DASH_PM_ROOTS="dash=/path/to/checkout,other=/path"   default: dash = this bridge's checkout
//   DASH_PM_KANBAN="hermes -p clean kanban list --json"   unset: no kanban overlay
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseLedger, type PmDocument, type PmIssue } from "../../shared/pm";
import { readRoadmap, roadmapFile } from "./roadmap-store";
import type { RoadmapItem } from "../../shared/roadmap";

export function pmRoots(env: Record<string, string | undefined> = process.env): { repo: string; root: string }[] {
  const raw = env.DASH_PM_ROOTS?.trim();
  if (!raw) return [{ repo: "dash", root: resolve(import.meta.dir, "../..") }];
  return raw.split(",").flatMap(entry => {
    const at = entry.indexOf("=");
    const repo = entry.slice(0, at).trim();
    const root = entry.slice(at + 1).trim();
    return at > 0 && /^[A-Za-z0-9._-]{1,64}$/.test(repo) && root.startsWith("/") ? [{ repo, root }] : [];
  });
}

type Card = { id: string; status: string; assignee?: string };
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Hermes board snapshot, refreshed at most once a minute; a failed read keeps the last one. */
class KanbanCache {
  private cards = new Map<string, Card>();
  private at = 0;
  private ok = false;
  private running: Promise<void> | undefined;
  constructor(private command: string[] | undefined) {}

  state(): PmDocument["kanban"] { return !this.command ? "off" : this.ok ? "live" : "unavailable"; }
  get(id: string): Card | undefined { return this.cards.get(id); }

  async fresh(waitMs: number): Promise<void> {
    if (!this.command || Date.now() - this.at < 60_000) return;
    this.running ??= this.read().finally(() => { this.running = undefined; });
    await Promise.race([this.running, Bun.sleep(waitMs)]);
  }

  private async read(): Promise<void> {
    const command = this.command;
    if (!command) return;
    try {
      const proc = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
      const timer = setTimeout(() => proc.kill("SIGKILL"), 20_000);
      const out = await new Response(proc.stdout).text();
      clearTimeout(timer);
      const list: unknown = JSON.parse(out);
      if (!Array.isArray(list)) throw new Error("not a list");
      const cards = new Map<string, Card>();
      for (const c of list) {
        if (record(c) && typeof c.id === "string" && typeof c.status === "string") {
          cards.set(c.id, { id: c.id, status: c.status, ...(typeof c.assignee === "string" && c.assignee ? { assignee: c.assignee } : {}) });
        }
      }
      this.cards = cards;
      this.ok = true;
    } catch {
      this.ok = this.cards.size > 0;
    } finally {
      this.at = Date.now();
    }
  }
}

/** A Hermes card status as an issue state. */
function stateOf(status: string): PmIssue["state"] {
  return status === "running" || status === "blocked" || status === "review" || status === "done" ? status : "todo";
}

function overlay(issue: PmIssue, kanban: KanbanCache, roadmap: Map<string, RoadmapItem>): PmIssue {
  const live: string[] = [];
  let out: PmIssue = issue;
  const card = issue.hermes ? kanban.get(issue.hermes) : undefined;
  if (card) {
    out = { ...out, kanban: card, state: stateOf(card.status) };
    live.push("hermes");
  }
  const item = issue.roadmap ? roadmap.get(issue.roadmap) : undefined;
  if (item) {
    out = {
      ...out,
      ...(item.progress !== undefined ? { progress: item.progress } : {}),
      ...(item.evidence ? { evidence: item.evidence } : {}),
      ...(item.next ? { next: item.next } : {}),
      ...(item.attention === "you" ? { attention: "you" as const } : {}),
      ...(!card && item.attention === "running" && out.state === "todo" ? { state: "running" as const } : {}),
      ...(!card && (item.progress ?? 0) >= 100 ? { state: "done" as const } : {}),
      ...(item.updatedAt ? { updatedAt: Math.max(out.updatedAt ?? 0, item.updatedAt) } : {}),
    };
    live.push("roadmap");
  }
  return live.length ? { ...out, live } : out;
}

export function readPm(roots: { repo: string; root: string }[]): { issues: PmIssue[]; repos: PmDocument["repos"] } {
  const issues: PmIssue[] = [];
  const repos: PmDocument["repos"] = [];
  for (const { repo, root } of roots) {
    let body = "";
    try { body = readFileSync(join(root, "pm", "events.jsonl"), "utf8"); }
    catch { repos.push({ repo, issues: 0, errors: [`${repo}: no pm/events.jsonl`] }); continue; }
    const graph = parseLedger(body, repo);
    // Ids are per repository; another repository's same id is a different issue.
    const taken = new Set(issues.map(i => i.id));
    const own = graph.issues.filter(i => !taken.has(i.id));
    issues.push(...own);
    repos.push({ repo, issues: own.length, errors: [...graph.errors, ...(own.length < graph.issues.length ? [`${repo}: ids already used by another repository were skipped`] : [])].slice(0, 50) });
  }
  return { issues, repos };
}

export function createPmHttpHandler(options: { authorize(request: Request): Promise<boolean>; env?: Record<string, string | undefined> }) {
  const env = options.env ?? process.env;
  const command = env.DASH_PM_KANBAN?.trim().split(/\s+/).filter(Boolean);
  const kanban = new KanbanCache(command?.length ? command : undefined);
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== "/pm") return null;
    if (!await options.authorize(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 });
    const { issues, repos } = readPm(pmRoots(env));
    await kanban.fresh(4000);
    let items = new Map<string, RoadmapItem>();
    try { items = new Map(readRoadmap(roadmapFile(env)).items.map(i => [i.id, i])); } catch { /* the roadmap file is optional */ }
    const doc: PmDocument = { issues: issues.map(i => overlay(i, kanban, items)), repos, kanban: kanban.state() };
    return Response.json(doc, { headers: { "Cache-Control": "no-store" } });
  };
}
