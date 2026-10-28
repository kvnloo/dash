import { Database } from 'bun:sqlite';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { TriageItem } from '../../shared/triage';
import { record } from './orchestra-graph';
import { redact } from './reply-parts';

/** Canonical board DBs only, read-only and WAL-aware. Never snapshot/copy a live DB. */
function boardFiles(): string[] {
  if (process.env.DASH_KANBAN_DB) return [process.env.DASH_KANBAN_DB];
  const home = join(homedir(), '.hermes');
  const root = join(home, 'kanban/boards');
  try {
    const boards = readdirSync(root).map(name => join(root, name, 'kanban.db')).filter(existsSync);
    if (boards.length) return boards;
  } catch { /* Older single-board layout. */ }
  const legacy = join(home, 'kanban.db');
  return existsSync(legacy) ? [legacy] : [];
}
export function kanbanTriage(): { items: TriageItem[]; warnings: string[] } {
  const items: TriageItem[] = [], warnings: string[] = [];
  const files = boardFiles();
  if (!files.length) return { items, warnings: ['Work board unavailable'] };
  for (const path of files.slice(0, 20)) {
    const board = process.env.DASH_KANBAN_DB ? "configured" : basename(dirname(path));
    let db: Database | undefined;
    try {
      db = new Database(path, { readonly: true });
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100;');
      const rows = db.query<{ id: string; title: string; status: string; priority: number; block_kind: string | null; last_failure_error: string | null; updated: number }, []>(`SELECT t.id, t.title, t.status, t.priority, t.block_kind, t.last_failure_error,
        coalesce((SELECT max(e.created_at) FROM task_events e WHERE e.task_id=t.id AND e.kind NOT IN ('heartbeat','considered')), t.created_at) AS updated
        FROM tasks t WHERE t.status IN ('blocked','triage') ORDER BY t.priority DESC, t.created_at DESC LIMIT 100`).all();
      for (const row of rows) {
        const event = db.query<{ payload: string | null }, [string]>("SELECT payload FROM task_events WHERE task_id=? AND kind='blocked' ORDER BY id DESC LIMIT 1").get(row.id);
        let payload: unknown;
        try { payload = JSON.parse(event?.payload ?? 'null'); } catch { /* Legacy block without structured payload. */ }
        const reason = record(payload) && typeof payload.reason === 'string' ? payload.reason : row.last_failure_error || row.block_kind || 'Review blocked work';
        const stamp = Number.isFinite(row.updated) && row.updated > 0 ? row.updated * 1000 : null;
        items.push({ id: `kanban:${board}:${row.id}`, title: redact(row.title), reason: redact(reason), next: row.block_kind === 'needs_input' || row.status === 'triage' ? 'Review the blocker and supply the owner decision' : 'Inspect the blocker and resume work when its dependency is resolved', kind: row.block_kind === 'needs_input' || row.status === 'triage' ? 'owner' : 'blocked', priority: Math.max(0, 3 - Math.min(3, Math.floor(row.priority / 3))), updatedAt: stamp, sourceUpdatedAt: stamp, source: `Work board · ${row.id}` });
      }
    } catch { warnings.push('Work board unavailable'); } finally { db?.close(); }
  }
  return { items, warnings };
}
