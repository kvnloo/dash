import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseKevinBatch } from '../../shared/supervision';
import { prUrl, ROADMAP_PRIORITIES } from '../../shared/roadmap';
import type { TriageItem, TriageSnapshot } from '../../shared/triage';
import { DEFAULT_SUPERVISION_DIR } from './supervision-http';
import { readRoadmap } from './roadmap-store';
import { record } from './orchestra-graph';
import { kanbanTriage } from './triage-kanban';

const text = (v: unknown) => typeof v === 'string' ? v : '';
function timestamp(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
async function json(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')); }
/** Every request re-reads the atomic source files. Missing sources are warnings, never demo data. */
export async function collectTriage(now = Date.now()): Promise<TriageSnapshot> {
  const board = kanbanTriage();
  const items: TriageItem[] = [...board.items], warnings: string[] = [...board.warnings];
  try {
    const doc = readRoadmap();
    const sourceUpdatedAt = timestamp(doc.updated);
    for (const item of doc.items) if (item.attention === 'you' && item.stage !== 'verified' && (item.progress ?? 0) < 100) {
      items.push({ id: `roadmap:${item.id}`, title: item.title, reason: [item.detail, item.evidence].filter(Boolean).join(' · '), next: item.next || 'Review roadmap item', kind: 'roadmap', priority: item.priority ? ROADMAP_PRIORITIES.indexOf(item.priority) : 3, updatedAt: timestamp(item.updatedAt), sourceUpdatedAt, source: 'Dash roadmap', url: prUrl(item) });
    }
  } catch { warnings.push('Roadmap unavailable'); }
  const directory = process.env.DASH_SUPERVISION_DIR || DEFAULT_SUPERVISION_DIR;
  try {
    const [state, raw] = await Promise.all([json(join(directory, 'state.json')), json(join(directory, 'needs-kevin.json'))]);
    const batch = parseKevinBatch(raw);
    const sourceUpdatedAt = record(state) ? timestamp(state.generated_at) : null;
    const batchAt = timestamp(batch?.generated_at);
    for (const item of batch?.items ?? []) {
      items.push({ id: `owner:${item.id}`, title: item.goal || item.worker, reason: item.why, next: item.recommended_action, kind: 'owner', priority: 0, updatedAt: batchAt, sourceUpdatedAt, source: 'Worker supervision' });
    }
    if (!batch) warnings.push('Owner-needed queue unavailable');
    if (record(state) && Array.isArray(state.workers)) for (const w of state.workers) {
      if (!record(w) || !/block|waiting|approval|stall|overdue/i.test(text(w.phase)) || typeof w.id !== 'string' || batch?.items.some(i => i.worker === w.id)) continue;
      const meta = record(w.meta) ? w.meta : {};
      items.push({ id: `blocked:${w.id}`, title: text(w.goal) || text(meta.goal) || w.id, reason: text(w.reason) || `Running work · ${text(w.phase)}`, next: text(w.recommended_action) || 'Inspect blocker and unblock the worker', kind: 'blocked', priority: 0, updatedAt: timestamp(w.updated_at) ?? sourceUpdatedAt, sourceUpdatedAt, source: 'Worker supervision', ...(typeof meta.session === 'string' ? { sessionId: meta.session } : {}) });
    }
  } catch { warnings.push('Worker supervision unavailable'); }
  return { generatedAt: now, items: items.slice(0, 500), warnings };
}
export function createTriageHttpHandler(options: { authorize(request: Request): Promise<boolean> }) {
  return async (request: Request): Promise<Response | null> => {
    if (new URL(request.url).pathname !== '/triage') return null;
    if (!await options.authorize(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (request.method !== 'GET') return Response.json({ error: 'method not allowed' }, { status: 405 });
    return Response.json(await collectTriage(), { headers: { 'Cache-Control': 'no-store' } });
  };
}
