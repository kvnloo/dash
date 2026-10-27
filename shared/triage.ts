/** Read-only priority evidence; source timestamps are never replaced by fetch time. */
export type TriageItem = {
  id: string; title: string; reason: string; next: string;
  kind: 'blocked' | 'owner' | 'roadmap'; priority: number;
  updatedAt: number | null; sourceUpdatedAt: number | null;
  source: string; sessionId?: string; url?: string;
};
export type TriageSnapshot = { generatedAt: number; items: TriageItem[]; warnings: string[] };
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const stamp = (v: unknown): v is number | null => v === null || typeof v === 'number' && Number.isFinite(v) && v > 0;
export function parseTriage(raw: unknown): TriageSnapshot | null {
  if (!record(raw) || typeof raw.generatedAt !== 'number' || !Number.isFinite(raw.generatedAt) || !Array.isArray(raw.items) || raw.items.length > 500 || !Array.isArray(raw.warnings) || !raw.warnings.every((v: unknown): v is string => typeof v === 'string')) return null;
  const items: TriageItem[] = [];
  const ids = new Set<string>();
  for (const i of raw.items) {
    if (!record(i) || typeof i.id !== 'string' || ids.has(i.id) || typeof i.title !== 'string' || typeof i.reason !== 'string' || typeof i.next !== 'string' || typeof i.source !== 'string' || !stamp(i.updatedAt) || !stamp(i.sourceUpdatedAt) || typeof i.priority !== 'number' || !Number.isFinite(i.priority)) return null;
    if (i.kind !== 'blocked' && i.kind !== 'owner' && i.kind !== 'roadmap') return null;
    items.push({ id: i.id, title: i.title, reason: i.reason, next: i.next, source: i.source, updatedAt: i.updatedAt, sourceUpdatedAt: i.sourceUpdatedAt, priority: i.priority, kind: i.kind, ...(typeof i.sessionId === 'string' ? { sessionId: i.sessionId } : {}), ...(typeof i.url === 'string' && /^https:\/\/github\.com\//.test(i.url) ? { url: i.url } : {}) });
    ids.add(i.id);
  }
  return { generatedAt: raw.generatedAt, items, warnings: raw.warnings };
}
export function triageStale(item: TriageItem, now: number): boolean {
  return item.updatedAt === null || item.sourceUpdatedAt === null || item.updatedAt < item.sourceUpdatedAt || item.updatedAt > now + 60000 || now - item.updatedAt > 86400000;
}
export function triageAge(item: TriageItem, now: number): string {
  if (item.updatedAt === null) return 'Age unknown';
  const seconds = Math.max(0, Math.floor((now - item.updatedAt) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
}
