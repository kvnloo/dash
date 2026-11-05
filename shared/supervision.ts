// Pull-only worker supervision. Never an approval or execution capability.
export interface KevinItem {
  id: string;
  worker: string;
  goal: string;
  why: string;
  recommended_action: string;
  options: string[];
  evidence_path: string;
  phase: string;
}
export interface KevinBatch { schema: "z0.fsm.needs-kevin/v1"; generated_at: string; size: number; items: KevinItem[] }
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export function parseKevinBatch(raw: unknown): KevinBatch | null {
  if (!record(raw) || raw.schema !== "z0.fsm.needs-kevin/v1" || typeof raw.generated_at !== "string" || !Number.isFinite(Date.parse(raw.generated_at)) || !Array.isArray(raw.items)) return null;
  const items: KevinItem[] = [];
  const ids = new Set<string>();
  for (const v of raw.items) {
    if (!record(v) || typeof v.id !== "string" || !v.id || ids.has(v.id) || typeof v.worker !== "string" || typeof v.goal !== "string" || typeof v.why !== "string" || typeof v.recommended_action !== "string" || typeof v.evidence_path !== "string" || typeof v.phase !== "string" || !Array.isArray(v.options) || !v.options.every((o: unknown): o is string => typeof o === "string")) return null;
    ids.add(v.id);
    items.push({ id: v.id, worker: v.worker, goal: v.goal, why: v.why, recommended_action: v.recommended_action, options: v.options, evidence_path: v.evidence_path, phase: v.phase });
  }
  return raw.size === items.length ? { schema: "z0.fsm.needs-kevin/v1", generated_at: raw.generated_at, size: items.length, items } : null;
}
export function groupKevinItems(items: KevinItem[]): { decision: string; items: KevinItem[] }[] {
  return [...new Set(items.map(i => i.recommended_action))].sort().map(decision => ({ decision, items: items.filter(i => i.recommended_action === decision) }));
}
