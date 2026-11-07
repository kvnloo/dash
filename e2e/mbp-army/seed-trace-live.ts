// A deterministic native Hermes activity projection in the isolated source DB.
import { Database } from 'bun:sqlite';
const path = process.argv[2];
if (!path) throw new Error('isolated state DB required');
const db = new Database(path);
try {
  db.exec('ALTER TABLE sessions ADD COLUMN last_activity_description TEXT');
  db.query('UPDATE sessions SET last_activity_at=?, last_activity_description=? WHERE id=?').run(Date.now() / 1000, 'streaming', 'army-fixture-session');
} finally { db.close(); }
