// Fixture-only seeds for RC3 area 10 (Orchestra, Bots, Approvals and Trace screens).
// Runs under bun against ONE isolated bridge directory; never touches owner homes or live services.
//   bun rc3-09-10-seed.ts orchestra <bridge-dir>   (bridge must be stopped)
//     Native Hermes rows in <dir>/.hermes/state.db that the real /orchestra/graph collector reads:
//     a delegating parent, a delegated subagent, a failing worker, a running worker, a worker whose
//     repo root is a GitHub PR URL, and 13 spokes on one throwaway git worktree (<dir>/army-repo).
//   bun rc3-09-10-seed.ts gate <gate-dir>
//     Three more real GateStore proposals beside seed-gate.ts's item (bulk-safe, human-text, CLA).
//   bun rc3-09-10-seed.ts supervision <dir> <n>
//     A needs-kevin.json/state.json pair (same generated_at) with n items for /supervision.
import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ORCHESTRA_SPOKES = 13;
export const HUB_SPOKE_CAP = 12;

const [mode, target, extra] = process.argv.slice(2);
if (!mode || !target) throw Error('usage: rc3-09-10-seed.ts orchestra|gate|supervision <dir> [n]');

if (mode === 'orchestra') {
 if (!target.includes('dash-army-')) throw Error('isolated bridge dir required');
 const repo = join(target, 'army-repo');
 mkdirSync(repo, { recursive: true });
 execFileSync('git', ['init', '-q', '-b', 'army-main', repo], { env: { ...process.env, HOME: target, GIT_CONFIG_NOSYSTEM: '1' } });
 const home = join(target, '.hermes');
 mkdirSync(home, { recursive: true });
 const db = new Database(join(home, 'state.db'));
 db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,source TEXT,title TEXT,started_at REAL,last_activity_at REAL,message_count INTEGER,cwd TEXT,archived INTEGER,hidden INTEGER,parent_session_id TEXT,end_reason TEXT,model_config TEXT)');
 const have = new Set(db.query<{ name: string }, []>('PRAGMA table_info(sessions)').all().map(c => c.name));
 for (const [name, type] of [['model', 'TEXT'], ['git_repo_root', 'TEXT'], ['git_branch', 'TEXT'], ['ended_at', 'REAL'], ['last_activity_description', 'TEXT']] as const)
  if (!have.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`);
 db.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT,
  tool_name TEXT, timestamp REAL NOT NULL, reasoning TEXT, reasoning_content TEXT, active INTEGER NOT NULL DEFAULT 1)`);
 // readSessionPhase needs BOTH tables: a missing session_admissions makes `running` undefined.
 db.exec('CREATE TABLE IF NOT EXISTS worker_executions (session_id TEXT, status TEXT)');
 db.exec('CREATE TABLE IF NOT EXISTS session_admissions (target_session_id TEXT, status TEXT)');
 const now = Date.now() / 1000;
 const insert = db.query('INSERT OR REPLACE INTO sessions (id,source,title,started_at,last_activity_at,message_count,cwd,archived,hidden,parent_session_id,end_reason,model_config,model,git_repo_root,git_branch,ended_at,last_activity_description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 type Row = { id: string; source: string; title: string; age: number; parent?: string; end?: string; model?: string; root?: string };
 const rows: Row[] = [
  { id: 'army-orch-parent', source: 'cli', title: 'ARMY parent orchestrator', age: 60, model: 'army-model-parent' },
  { id: 'army-orch-child', source: 'subagent', title: 'ARMY delegated child', age: 90, parent: 'army-orch-parent', model: 'army-model-child' },
  { id: 'army-orch-failing', source: 'cli', title: 'ARMY failing worker', age: 120, end: 'error: fixture worker crashed' },
  { id: 'army-orch-live', source: 'cli', title: 'ARMY live worker', age: 150 },
  { id: 'army-orch-pr', source: 'kanban', title: 'ARMY PR worker', age: 180, root: 'https://github.com/example/army-fixture/pull/7' },
  ...Array.from({ length: ORCHESTRA_SPOKES }, (_, i) => ({ id: `army-orch-spoke-${String(i + 1).padStart(2, '0')}`, source: 'kanban', title: `ARMY spoke ${String(i + 1).padStart(2, '0')}`, age: 600 + i * 30 })),
 ];
 for (const r of rows) insert.run(r.id, r.source, r.title, now - r.age - 60, now - r.age, 2, repo, 0, 0, r.parent ?? null, r.end ?? null, '{}', r.model ?? null, r.root ?? null, 'army-main', null, null);
 db.query('DELETE FROM worker_executions WHERE session_id=?').run('army-orch-live');
 db.query("INSERT INTO worker_executions VALUES (?, 'running')").run('army-orch-live');
 db.close();
} else if (mode === 'gate') {
 const bridgeRoot = process.env.ARMY_BRIDGE_ROOT;
 if (!bridgeRoot) throw Error('ARMY_BRIDGE_ROOT required');
 const { GateStore } = await import(bridgeRoot + '/bridge/src/gate/store.ts');
 const store = new GateStore(target);
 const origin = () => ({ agent: 'army-fixture', session: 'isolated', created_at: new Date().toISOString() });
 const evidence = [{ label: 'fixture', url_or_path: 'https://example.invalid/fixture' }];
 await store.propose({ kind: 'issue_comment', target: { repo: 'example/army-fixture', number: 2 }, body: 'ARMY_BULK_TWO: second bulk-safe dry-run proposal', evidence, origin: origin() }, [{ path: 'CONTRIBUTING.md', text: 'Tests and clear reproduction are required.' }]);
 await store.propose({ kind: 'issue_comment', target: { repo: 'example/army-human', number: 5 }, body: 'ARMY_HUMAN_WITHHELD generated text', evidence, origin: origin() }, [{ path: 'CONTRIBUTING.md', text: 'Comments must be human-written. Respond in your own words.' }]);
 await store.propose({ kind: 'issue_comment', target: { repo: 'example/army-individual', number: 9 }, body: 'ARMY_INDIVIDUAL: proposal that needs individual review', evidence, origin: origin() }, [{ path: 'CONTRIBUTING.md', text: 'All contributors must sign the CLA before review.' }]);
} else if (mode === 'supervision') {
 const n = Number(extra ?? '2');
 const generated_at = new Date().toISOString();
 const items = Array.from({ length: n }, (_, i) => ({
  id: `army-kevin-${i + 1}`, worker: `army-worker-${i + 1}`, goal: `ARMY_KEVIN_GOAL_${i + 1}`, why: `ARMY_KEVIN_WHY_${i + 1}: fixture worker is blocked on an owner decision`,
  recommended_action: i % 2 ? 'abandon' : 'resume', options: ['resume', 'abandon'], evidence_path: `fixture/army-worker-${i + 1}.log`, phase: 'blocked',
 }));
 mkdirSync(target, { recursive: true });
 // state.json first: the bridge answers 503 while the two generated_at values differ.
 writeFileSync(join(target, 'state.json'), JSON.stringify({ generated_at, workers: [], findings: [] }));
 writeFileSync(join(target, 'needs-kevin.json'), JSON.stringify({ schema: 'z0.fsm.needs-kevin/v1', generated_at, size: n, items }));
} else throw Error('unknown mode ' + mode);
