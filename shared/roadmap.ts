// The Dash roadmap: one document the Ripple roadmap view, the orchestrate triage lane and the
// Tern "minimal roadmap" pane all read. It is the Ripple RoadmapDocument (vendor/ripple/native)
// with optional fields for what the owner has to act on now: priority, proven progress, whether
// the item waits on the owner or is running, and its pull request. Pure: no IO here.

export const ROADMAP_STAGES = ["planned", "partial", "candidate", "preview", "verified"] as const;
export type RoadmapStage = (typeof ROADMAP_STAGES)[number];
export const ROADMAP_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type RoadmapPriority = (typeof ROADMAP_PRIORITIES)[number];
/** `you`: blocked on the owner; `running`: an agent or job is on it now. */
export type RoadmapAttention = "you" | "running";

export interface RoadmapItem {
  id: string;
  title: string;
  stage: RoadmapStage;
  area: string;
  detail: string;
  evidence: string;
  /** The single next action. For a `you` item: what the owner does. */
  next: string;
  priority?: RoadmapPriority;
  /** Proven progress, 0–100: on main, on the owner's device, or army-tested. */
  progress?: number;
  attention?: RoadmapAttention;
  /** Pull request URL or number (a number means kvnloo/dash). */
  pr?: string;
  /** Last change, epoch ms. */
  updatedAt?: number;
}
export interface RoadmapDocument { id: string; title: string; updated: string; items: RoadmapItem[] }

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" ? v : "";
const isStage = (v: unknown): v is RoadmapStage => ROADMAP_STAGES.some(s => s === v);
const isPriority = (v: unknown): v is RoadmapPriority => ROADMAP_PRIORITIES.some(p => p === v);

export function emptyRoadmap(): RoadmapDocument { return { id: "dash-roadmap", title: "Dash roadmap", updated: "", items: [] }; }

/** The stage a bare progress number implies, for items that only report progress. */
export function stageFor(progress: number): RoadmapStage {
  return progress >= 100 ? "verified" : progress >= 80 ? "preview" : progress >= 50 ? "candidate" : progress > 0 ? "partial" : "planned";
}

export function clampProgress(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }

export function parseRoadmapItem(v: unknown): RoadmapItem | null {
  if (!record(v) || typeof v.id !== "string" || !v.id || typeof v.title !== "string" || !v.title || !isStage(v.stage)) return null;
  const item: RoadmapItem = { id: v.id, title: v.title, stage: v.stage, area: str(v.area), detail: str(v.detail), evidence: str(v.evidence), next: str(v.next) };
  if (isPriority(v.priority)) item.priority = v.priority;
  if (typeof v.progress === "number" && Number.isFinite(v.progress)) item.progress = clampProgress(v.progress);
  if (v.attention === "you" || v.attention === "running") item.attention = v.attention;
  if (typeof v.pr === "string" && v.pr) item.pr = v.pr;
  if (typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt)) item.updatedAt = v.updatedAt;
  return item;
}

/** A valid document, or null. Duplicate ids or a bad item reject the whole document. */
export function parseRoadmap(raw: unknown): RoadmapDocument | null {
  if (!record(raw) || typeof raw.id !== "string" || typeof raw.title !== "string" || !Array.isArray(raw.items) || raw.items.length > 500) return null;
  const items: RoadmapItem[] = [];
  const ids = new Set<string>();
  for (const v of raw.items) {
    const item = parseRoadmapItem(v);
    if (!item || ids.has(item.id)) return null;
    ids.add(item.id);
    items.push(item);
  }
  return { id: raw.id, title: raw.title, updated: str(raw.updated), items };
}

const rank = (i: RoadmapItem) => i.priority ? ROADMAP_PRIORITIES.indexOf(i.priority) : ROADMAP_PRIORITIES.length;
const done = (i: RoadmapItem) => i.stage === "verified" || (i.progress ?? 0) >= 100;

/** The order of the minimal view: what blocks on the owner, what runs, then the rest by priority (finished last). */
export function roadmapSections(doc: RoadmapDocument): { you: RoadmapItem[]; running: RoadmapItem[]; list: RoadmapItem[] } {
  const byPriority = (a: RoadmapItem, b: RoadmapItem) => rank(a) - rank(b);
  return {
    you: doc.items.filter(i => i.attention === "you").sort(byPriority),
    running: doc.items.filter(i => i.attention === "running").sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    list: doc.items.filter(i => !i.attention).sort((a, b) => Number(done(a)) - Number(done(b)) || byPriority(a, b) || (a.progress ?? 0) - (b.progress ?? 0)),
  };
}

/** Overall proven progress across items that report it. */
export function roadmapProgress(doc: RoadmapDocument): number | undefined {
  const xs = doc.items.flatMap(i => i.progress === undefined ? [] : [i.progress]);
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : undefined;
}

/** Ids whose content differs between two documents (new items included). */
export function changedItems(prev: RoadmapDocument, next: RoadmapDocument): string[] {
  const before = new Map(prev.items.map(i => [i.id, JSON.stringify({ ...i, updatedAt: 0 })]));
  return next.items.filter(i => before.get(i.id) !== JSON.stringify({ ...i, updatedAt: 0 })).map(i => i.id);
}

export type RoadmapPatch = Partial<Omit<RoadmapItem, "id" | "attention">> & { attention?: RoadmapAttention | null };

/** Applies a patch to item `id`, creating it when `patch.title` is given. Progress without a stage moves the stage. */
export function patchRoadmap(doc: RoadmapDocument, id: string, patch: RoadmapPatch, now: number): RoadmapDocument {
  const at = doc.items.findIndex(i => i.id === id);
  const prev = at >= 0 ? doc.items[at] : undefined;
  if (!prev && !patch.title) throw new Error(`no roadmap item "${id}"; give --title to create it`);
  const base: RoadmapItem = prev ?? { id, title: patch.title ?? id, stage: "planned", area: "", detail: "", evidence: "", next: "" };
  const { attention, ...rest } = patch;
  const next: RoadmapItem = { ...base, ...rest, id, updatedAt: now };
  if (attention === null) delete next.attention;
  else if (attention) next.attention = attention;
  if (patch.progress !== undefined) {
    next.progress = clampProgress(patch.progress);
    if (!patch.stage) next.stage = stageFor(next.progress);
  }
  const checked = parseRoadmapItem(next);
  if (!checked) throw new Error(`invalid roadmap item "${id}"`);
  const items = [...doc.items];
  if (at >= 0) items[at] = checked; else items.push(checked);
  return { ...doc, items, updated: new Date(now).toISOString() };
}

export function removeRoadmapItem(doc: RoadmapDocument, id: string, now: number): RoadmapDocument {
  if (!doc.items.some(i => i.id === id)) throw new Error(`no roadmap item "${id}"`);
  return { ...doc, items: doc.items.filter(i => i.id !== id), updated: new Date(now).toISOString() };
}

/** The item's pull request as a URL: its `pr` field, else the first `PR #n` / `#n` in its evidence (kvnloo/dash). */
export function prUrl(item: RoadmapItem): string | undefined {
  // `#n` right after another repo's name (".files #120", "kvnloo/z0 #12") is not a Dash PR.
  const pr = item.pr ?? [...item.evidence.matchAll(/(\S+)?\s*#(\d{2,5})\b/g)].find(m => !m[1] || !/[./]/.test(m[1]))?.[2];
  if (!pr) return undefined;
  return /^\d+$/.test(pr) ? `https://github.com/kvnloo/dash/pull/${pr}` : /^https:\/\/github\.com\//.test(pr) ? pr : undefined;
}

/**
 * One-time import of the owner-asks board (`board.json`: rows of [id, ask, priority, percent,
 * evidence], plus `now` and `you` lists of free text) into roadmap items. Rows keep their number as
 * id; `you-N` and `now-N` hold the lists.
 */
export function importBoard(doc: RoadmapDocument, raw: unknown, now: number): RoadmapDocument {
  if (!record(raw) || !Array.isArray(raw.rows)) throw new Error("not a board: missing rows");
  let out = doc;
  for (const row of raw.rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const [n, ask, pri, pct, evidence] = row;
    if (typeof ask !== "string" || typeof pct !== "number") continue;
    out = patchRoadmap(out, String(n), { title: ask, area: "Owner asks", evidence: str(evidence), progress: pct, ...(isPriority(pri) ? { priority: pri } : {}) }, now);
  }
  const list = (key: string, attention: RoadmapAttention, prefix: string) => {
    const xs = Array.isArray(raw[key]) ? raw[key] : [];
    xs.forEach((text, i) => {
      if (typeof text !== "string" || !text) return;
      out = patchRoadmap(out, `${prefix}-${i + 1}`, { title: text, area: attention === "you" ? "Waiting on you" : "Running now", next: attention === "you" ? text : "", attention }, now);
    });
  };
  list("you", "you", "you");
  list("now", "running", "now");
  return out;
}
