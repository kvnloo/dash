// Fixture-only chat-index sources for RC3 Chats-list journeys (area 02).
// Writes native Hermes state.db rows/messages and AgentsView sessions into the
// isolated bridge HOME while the bridge is stopped; the real bridge indexes them on boot.
// Usage: bun rc3-chat-index-seed.ts <bridge-dir> <spec.json>
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type HermesSeed = { id: string; title: string; cwd?: string; activityMs: number; messages?: { role: 'user' | 'assistant'; text: string }[]; hidden?: boolean };
export type AgentsviewSeed = { id: string; agent: string; machine: string; title: string; cwd?: string; endedMs: number };
export type SeedSpec = { hermes?: HermesSeed[]; agentsview?: AgentsviewSeed[] };

const [dir, specPath] = process.argv.slice(2);
if (!dir || !specPath) throw Error('usage: rc3-chat-index-seed.ts <bridge-dir> <spec.json>');
const spec: SeedSpec = JSON.parse(readFileSync(specPath, 'utf8'));

if (spec.hermes?.length) {
 const hermesHome = join(dir, '.hermes');
 mkdirSync(hermesHome, { recursive: true });
 const db = new Database(join(hermesHome, 'state.db'));
 db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,source TEXT,title TEXT,started_at REAL,last_activity_at REAL,message_count INTEGER,cwd TEXT,archived INTEGER,hidden INTEGER,parent_session_id TEXT,end_reason TEXT,model_config TEXT)');
 db.exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT,
  tool_name TEXT, timestamp REAL NOT NULL, reasoning TEXT, reasoning_content TEXT, active INTEGER NOT NULL DEFAULT 1)`);
 const insertSession = db.query('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
 const insertMessage = db.query('INSERT INTO messages (session_id, role, content, timestamp, active) VALUES (?,?,?,?,1)');
 for (const s of spec.hermes) {
  const at = s.activityMs / 1000;
  const messages = s.messages ?? [];
  insertSession.run(s.id, 'cli', s.title, at - 60, at, Math.max(messages.length, 1), s.cwd ?? null, 0, s.hidden ? 1 : 0, null, null, '{}');
  db.query('DELETE FROM messages WHERE session_id = ?').run(s.id);
  messages.forEach((m, i) => insertMessage.run(s.id, m.role, m.text, at - 50 + i));
 }
 db.close();
}

if (spec.agentsview?.length) {
 const avDir = join(dir, '.agentsview');
 mkdirSync(avDir, { recursive: true });
 const db = new Database(join(avDir, 'sessions.db'));
 db.exec(`create table if not exists sessions (id text primary key, project text not null default '', machine text not null default 'local', agent text not null default 'claude',
  entrypoint text not null default '', session_kind text not null default '', first_message text, display_name text, session_name text,
  started_at text, ended_at text, message_count integer not null default 0, user_message_count integer not null default 0,
  parent_session_id text, deleted_at text, is_automated integer not null default 0, cwd text not null default '');
  create index if not exists idx_sessions_ended on sessions(ended_at desc, id);
  create table if not exists messages (id integer primary key, session_id text not null, ordinal integer not null, role text not null, content text not null,
  timestamp text, content_length integer not null default 0, is_system integer not null default 0, unique(session_id, ordinal));
  create virtual table if not exists messages_fts using fts5(content, content='messages', content_rowid='id', tokenize='porter unicode61');`);
 const insert = db.query(`insert or replace into sessions (id, project, machine, agent, first_message, display_name, started_at, ended_at, message_count, user_message_count, cwd)
  values (?,?,?,?,?,?,?,?,?,?,?)`);
 for (const s of spec.agentsview) {
  insert.run(s.id, 'army-fixture', s.machine, s.agent, s.title, s.title, new Date(s.endedMs - 60_000).toISOString(), new Date(s.endedMs).toISOString(), 12, 4, s.cwd ?? '');
 }
 db.close();
}
