// Source fixture for the real bridge's read-only Kanban collector.
import { Database } from 'bun:sqlite';
const path = process.argv[2], stamp = Number(process.argv[3]);
if (!path || !Number.isFinite(stamp)) throw new Error('fixture DB path and epoch seconds required');
const db = new Database(path);
try {
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT, status TEXT, priority INTEGER, block_kind TEXT, last_failure_error TEXT, created_at INTEGER);
    CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);`);
  db.query('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)').run('army-board-blocked', 'Fixture current board blocker', 'blocked', 9, 'capability', null, stamp);
  db.query('INSERT INTO task_events VALUES (?, ?, ?, ?, ?)').run(1, 'army-board-blocked', 'blocked', JSON.stringify({ reason: 'Fixture credential is missing' }), stamp);
  // A resumed task may retain old blocker metadata; it must not appear blocked.
  db.query('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?)').run('army-board-running', 'Fixture current running work', 'running', 9, 'needs_input', 'Old resolved failure', stamp);
  db.query('INSERT INTO task_events VALUES (?, ?, ?, ?, ?)').run(2, 'army-board-running', 'blocked', JSON.stringify({ reason: 'Old resolved blocker' }), stamp - 60);
  db.query('INSERT INTO task_events VALUES (?, ?, ?, ?, ?)').run(3, 'army-board-running', 'claimed', null, stamp);
} finally { db.close(); }
