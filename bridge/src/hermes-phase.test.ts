import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activityPhase, readSessionPhase, sessionPhaseHttp, UNOBSERVED } from "./hermes-phase";

test("status-only activity labels, never arbitrary descriptions, become phases", () => {
  expect(activityPhase("executing tool: terminal", true)).toMatchObject({ phase: "tool", tool: "terminal" });
  expect(activityPhase("sequential tool running (12s): terminal", true)).toMatchObject({ phase: "tool", tool: "terminal" });
  expect(activityPhase("executing 2 tools concurrently: terminal, read_file", true)).toMatchObject({ phase: "tool", tool: "terminal, read_file" });
  expect(activityPhase("tool completed: terminal (1.0s)", true).phase).toBe("thinking");
  expect(activityPhase("Waiting for clarification", true).phase).toBe("waiting-approval");
  expect(activityPhase("waiting for non-streaming API response", true).phase).toBe("thinking");
  expect(activityPhase("arbitrary private description", true)).toEqual({ phase: "thinking", observed: true, source: "terminal" });
  expect(activityPhase("executing tool: terminal", false).phase).toBe("idle");
});

test("read-only observer works without any messages table, bounds stale labels, handles gateway loss", () => {
  const home = mkdtempSync(join(tmpdir(), "dash-phase-"));
  const db = new Database(join(home, "state.db"));
  try {
    db.exec("CREATE TABLE sessions(id TEXT PRIMARY KEY,last_activity_at REAL,last_activity_description TEXT); CREATE TABLE worker_executions(session_id TEXT,status TEXT); CREATE TABLE session_admissions(target_session_id TEXT,status TEXT)");
    db.query("INSERT INTO sessions VALUES(?,?,?)").run("s", 100, "executing tool: terminal");
    expect(readSessionPhase(home, ["s"], true, 101000)).toMatchObject({ phase: "tool", tool: "terminal" });
    expect(readSessionPhase(home, ["s"], true, 200000).phase).toBe("idle");
    db.query("INSERT INTO worker_executions VALUES(?,?)").run("s", "running");
    expect(readSessionPhase(home, ["s"], true, 200000).phase).toBe("thinking");
    expect(readSessionPhase(home, ["s"], false, 101000)).toEqual(UNOBSERVED);
    db.query("DELETE FROM worker_executions").run();
    db.query("UPDATE sessions SET last_activity_description=''").run();
    expect(readSessionPhase(home, ["s"], true, 101000).phase).toBe("idle");
    db.query("INSERT INTO session_admissions VALUES(?,?)").run("s", "started");
    expect(readSessionPhase(home, ["s"], true, 101000).phase).toBe("thinking");
  } finally { db.close(); rmSync(home, { recursive: true, force: true }); }
});

test("phase endpoint authenticates before reading and never caches", async () => {
  let reads = 0;
  const read = () => { reads++; return UNOBSERVED; };
  const req = new Request("http://host/hermes/phase?profile=clean&session=local-1");
  expect(sessionPhaseHttp(req, false, read)?.status).toBe(401);
  expect(reads).toBe(0);
  expect(sessionPhaseHttp(new Request("http://host/hermes/phase"), true, read)?.status).toBe(400);
  const response = sessionPhaseHttp(req, true, read);
  expect(response?.status).toBe(200);
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
  expect(await response?.json()).toEqual(UNOBSERVED);
  expect(reads).toBe(1);
});
