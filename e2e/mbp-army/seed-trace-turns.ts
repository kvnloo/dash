// Seed native history in the isolated fixture DB; the real bridge reads it.
import { Database } from 'bun:sqlite';

const path = process.argv[2];
if (!path) throw new Error('isolated state DB required');
const db = new Database(path);
try {
  const id = 'army-fixture-session';
  const now = Date.now() / 1000;
  db.transaction(() => {
    db.query('DELETE FROM messages WHERE session_id = ?').run(id);
    const insert = db.query('INSERT INTO messages (session_id, role, content, timestamp, active) VALUES (?, ?, ?, ?, ?)');
    insert.run(id, 'user', 'First fixture turn', now - 4, 1);
    insert.run(id, 'assistant', 'Produced https://example.com/first-output', now - 3, 1);
    insert.run(id, 'user', 'Second fixture turn\n\n## Acceptance\n- Review the second output', now - 2, 1);
    insert.run(id, 'assistant', 'Produced https://example.com/second-output', now - 1, 1);
    insert.run(id, 'assistant', 'Produced https://example.com/discarded-output', now, 0);
  })();
} finally { db.close(); }
