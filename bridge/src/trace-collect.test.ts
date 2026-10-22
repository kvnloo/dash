import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { collectTrace } from "./trace-collect";
import { parseTraceSnapshot } from "../../app/src/trace/model";

test("native run/session/fleet collection remains read-only and does not infer acceptance", async () => {
  const root = mkdtempSync(join(tmpdir(), "trace-native-"));
  const runs = join(root, "runs"), profile = join(root, "profile"), fleet = join(root, "fleet");
  mkdirSync(join(runs, "20261021-dash"), { recursive: true }); mkdirSync(profile); mkdirSync(fleet);
  const prompt = 'OWNER:\n"Show exactly this request"\n\nACCEPTANCE\n- Opens output';
  writeFileSync(join(runs, "20261021-dash/PROMPT.txt"), prompt);
  writeFileSync(join(runs, "20261021-dash/REPORT.md"), "Everything passes. Phone verified from Metro.");
  writeFileSync(join(fleet, "20261021-120000-aabb-mbp.log"), "34 pass\n0 fail\n# exit 0\n");
  const db = new Database(join(profile, "state.db"));
  db.exec("CREATE TABLE sessions(id TEXT, title TEXT, model TEXT, started_at REAL, ended_at REAL, last_activity_at REAL, parent_session_id TEXT); CREATE TABLE messages(session_id TEXT, role TEXT, content TEXT, timestamp REAL, tool_calls TEXT)");
  db.query("INSERT INTO sessions VALUES(?,?,?,?,?,?,?)").run("session1", "Test session", "Sol", Date.now() / 1000 - 100000, null, Date.now() / 1000, "parent1");
  db.query("INSERT INTO messages VALUES(?,?,?,?,?)").run("session1", "user", "Original unicode — request\ntoken=never-show-me", 1, null);
  db.query("INSERT INTO messages VALUES(?,?,?,?,?)").run("session1", "assistant", "", 2, '[{"name":"read_file"}]');
  db.close();
  try {
    const raw = await collectTrace({ runs, profiles: [profile], roots: [runs], fleet });
    const snapshot = parseTraceSnapshot(raw);
    expect(snapshot.rows).toHaveLength(3);
    const run = snapshot.rows.find(r => r.key.startsWith("run:"));
    expect(run?.workers[0]?.status).toBe("unknown");
    expect(run?.evidence?.quote).toBe("Show exactly this request");
    expect(run?.evidence?.checks[0]?.status).toBe("unknown");
    const session = snapshot.rows.find(r => r.key.startsWith("hermes:"));
    expect(session?.workers[0]?.calls).toBe(1);
    expect(session?.evidence?.quote).toContain("Original unicode — request");
    expect(JSON.stringify(snapshot)).not.toContain("never-show-me");
    expect(session?.workers[0]?.status).toBe("unknown");
    const job = snapshot.rows.find(r => r.key.startsWith("fleet:"));
    expect(job?.workers[0]?.status).toBe("completed");
    expect(job?.evidence?.checks).toEqual([]);
    const readback = new Database(join(profile, "state.db"), { readonly: true });
    expect(readback.query<{ n: number }, []>("SELECT count(*) AS n FROM messages").get()?.n).toBe(2); readback.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
