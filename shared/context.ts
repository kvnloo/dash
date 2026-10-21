export type ContextCategory = { id: string; label: string; tokens: number; estimated: boolean; details: { label: string; tokens: number }[]; note?: string };
export type ContextSnapshot = { sessionId: string; model: string; used: number; maximum: number; threshold: number; estimated: boolean; source: string; categories: ContextCategory[]; revision: string; notes: string[] };
export type PlanWindow = { label: string; percent: number; resetsAt?: string };
export type PlanUsage = { provider: string; windows: PlanWindow[]; unavailable?: boolean };
export type ContextView = { context: ContextSnapshot | null; plans: PlanUsage[] };
export function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function count(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
export function parseContext(value: unknown): ContextSnapshot | undefined {
  if (!record(value) || typeof value.sessionId !== "string" || typeof value.model !== "string" || !count(value.used) || !count(value.maximum) || !count(value.threshold) || typeof value.estimated !== "boolean" || typeof value.source !== "string" || typeof value.revision !== "string" || !Array.isArray(value.categories) || !Array.isArray(value.notes) || !value.notes.every(n => typeof n === "string")) return;
  const categories: ContextCategory[] = [];
  for (const item of value.categories) {
    if (!record(item) || typeof item.id !== "string" || typeof item.label !== "string" || !count(item.tokens) || typeof item.estimated !== "boolean" || !Array.isArray(item.details) || (item.note !== undefined && typeof item.note !== "string")) return;
    const details: ContextCategory["details"] = [];
    for (const detail of item.details) { if (!record(detail) || typeof detail.label !== "string" || !count(detail.tokens)) return; details.push({ label: detail.label, tokens: detail.tokens }); }
    categories.push({ id: item.id, label: item.label, tokens: item.tokens, estimated: item.estimated, details, ...(typeof item.note === "string" ? { note: item.note } : {}) });
  }
  return { sessionId: value.sessionId, model: value.model, used: value.used, maximum: value.maximum, threshold: value.threshold, estimated: value.estimated, source: value.source, revision: value.revision, categories, notes: value.notes };
}
export function parsePlan(value: unknown): PlanUsage | undefined {
  if (!record(value) || typeof value.provider !== "string" || !Array.isArray(value.windows)) return;
  const windows: PlanWindow[] = [];
  for (const w of value.windows) { if (!record(w) || typeof w.label !== "string" || !count(w.percent) || w.percent > 100 || (w.resetsAt !== undefined && typeof w.resetsAt !== "string")) return; windows.push({ label: w.label, percent: w.percent, ...(typeof w.resetsAt === "string" ? { resetsAt: w.resetsAt } : {}) }); }
  return { provider: value.provider, windows, ...(value.unavailable === true ? { unavailable: true } : {}) };
}
export function contextTone(snapshot: ContextSnapshot): "normal" | "amber" | "red" { return snapshot.threshold > 0 && snapshot.used >= snapshot.threshold ? "red" : snapshot.maximum > 0 && snapshot.used / snapshot.maximum > .8 ? "amber" : "normal"; }
export function tokenLabel(tokens: number): string { return tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(Math.round(tokens)); }
export function compactionResult(before: ContextSnapshot, after: ContextSnapshot): number | undefined {
  // A smaller estimate alone is not evidence: compaction must replace the active transcript.
  if (before.revision === after.revision || after.used >= before.used) return;
  return before.used - after.used;
}
