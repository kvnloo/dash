import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsviewSessions, nativeSessionId, rosterArchiveHead } from "./agentsview-sessions";
import { ChatIndexEngine } from "./chat-index/worker";
import type { AgentInfo } from "../../shared/protocol";

// Large-payload test: correctness is load-independent; 5 s default timed out at load ~37 on MBP fleet.
const HEAVY_TEST_TIMEOUT_MS = 30_000;

// The archive is read by chat-index workers; the roster gets the engine's snapshot head.
async function engineFor(path: string): Promise<ChatIndexEngine> {
  const dir = mkdtempSync(join(tmpdir(), "dash-av-side-"));
  const engine = new ChatIndexEngine({ role: "primary", sidecarPath: join(dir, "side.db"), agentsviewPath: path, hermesRoot: join(dir, "none"), selfMachines: ["m"], manual: true });
  await engine.ingest();
  await engine.reconcileAgentsview();
  return engine;
}
async function head(path = fixture()): Promise<AgentInfo[]> {
  const engine = await engineFor(path);
  try { return engine.snapshot().head; } finally { engine.stop(); }
}
function agentsviewHistory(harness: string, sessionId: string, path: string) {
  const dir = mkdtempSync(join(tmpdir(), "dash-av-side-"));
  const engine = new ChatIndexEngine({ role: "primary", sidecarPath: join(dir, "side.db"), agentsviewPath: path, hermesRoot: join(dir, "none"), manual: true });
  try { return engine.wsHistory({ kind: harness, sessionId }).messages; } finally { engine.stop(); }
}

function fixture(): string {
  const path = join(mkdtempSync(join(tmpdir(), "dash-av-")), "sessions.db");
  const db = new Database(path);
  db.run(`create table sessions (id text primary key, project text, machine text, agent text, session_kind text default '',
    first_message text, display_name text, session_name text, started_at text, ended_at text, message_count integer,
    user_message_count integer, parent_session_id text, deleted_at text, is_automated integer, cwd text, entrypoint text default '')`);
  db.run(`create table messages (id integer primary key, session_id text, ordinal integer, role text, content text,
    timestamp text, is_system integer default 0, content_length integer not null default 0)`);
  const add = db.prepare(`insert into sessions (id, project, machine, agent, session_kind, first_message, display_name, session_name, started_at, ended_at, message_count, user_message_count, parent_session_id, deleted_at, is_automated, cwd) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  add.run("codex:c1", "dash", "m", "codex", "", "fix the chat list\nmore", null, null, "2026-10-25T10:00:00Z", "2026-10-25T11:00:00Z", 4, 2, null, null, 0, "/w/dash");
  add.run("c2", "dash", "m", "claude", "", "claude chat", "Named claude chat", null, "2026-10-25T09:00:00Z", null, 12, 1, null, null, 0, null);
  add.run("codex:auto", "x", "m", "codex", "non-interactive", "auto", null, null, "2026-10-25T12:00:00Z", null, 2, 1, null, null, 1, null);
  add.run("agent-sub", "x", "m", "claude", "", "sub", null, null, "2026-10-25T12:00:00Z", null, 2, 1, "c2", null, 0, null);
  add.run("omp:o1", "x", "m", "omp", "", "omp chat", null, null, "2026-10-25T08:00:00Z", null, 4, 2, null, null, 0, "/w");
  add.run("hermes:h1", "x", "m", "hermes", "", "hermes", null, null, "2026-10-25T08:00:00Z", null, 2, 1, null, null, 0, null);
  const msg = db.prepare(`insert into messages (session_id, ordinal, role, content, timestamp, is_system, content_length) values (?,?,?,?,?,?,length(?4))`);
  msg.run("codex:c1", 0, "user", "fix the chat list", "2026-10-25T10:00:00Z", 0);
  msg.run("codex:c1", 1, "assistant", "done; token=sk-abcdefghijklmnopqrstuvwxyz123456", "2026-10-25T10:01:00Z", 0);
  msg.run("codex:c1", 2, "system", "injected", "2026-10-25T10:02:00Z", 1);
  add.run("probe", "x", "m", "claude", "", "Reply with exactly ok", null, null, "2026-10-25T13:00:00Z", null, 2, 1, null, null, 0, null);
  db.run(`update sessions set entrypoint = 'sdk-cli' where id = 'probe'`);
  add.run("oneshot", "x", "m", "codex", "", "one prompt", null, null, "2026-10-25T13:00:00Z", null, 2, 1, null, null, 0, null);
  db.close();
  return path;
}

describe("agentsview sessions", () => {
  test("red before / green after: codex and claude chats reach the roster", async () => {
    const rows = agentsviewSessions(new Set(), await head());
    expect(rows.map(r => `${r.kind}:${r.sessionId}`).sort()).toEqual(["claude:c2", "codex:c1", "omp:o1"]);
    const codex = rows.find(r => r.kind === "codex")!;
    expect(codex.name).toBe("fix the chat list");
    expect(codex.status).toBe("available");
    expect(codex.id).toBe("av:codex:c1");
    expect(rows.find(r => r.kind === "claude")!.name).toBe("Named claude chat");
  });
  test("automated runs, subagents and hermes stay out", async () => {
    const ids = agentsviewSessions(new Set(), await head()).map(r => r.sessionId);
    expect(ids).not.toContain("auto");
    expect(ids).not.toContain("agent-sub");
    expect(ids).not.toContain("h1");
    expect(ids).not.toContain("probe");
    expect(ids).not.toContain("oneshot");
  });
  test("live rows win over archived copies", async () => {
    expect(agentsviewSessions(new Set(["omp:o1"]), await head()).map(r => r.sessionId)).not.toContain("o1");
  });
  test("the hello head is capped per catalog kind and DASH_AGENTSVIEW=0 drops it", async () => {
    const path = fixture();
    const db = new Database(path);
    const add = db.prepare(`insert into sessions (id, project, machine, agent, first_message, started_at, ended_at, message_count, user_message_count, is_automated) values (?,?,?,?,?,?,?,?,?,0)`);
    for (let i = 0; i < 60; i++) add.run(`codex:bulk${i}`, "p", "m", "codex", `bulk ${i}`, "2026-10-20T00:00:00Z", `2026-10-20T00:${String(i).padStart(2, "0")}:00Z`, 12, 3);
    db.close();
    const rows = await head(path);
    expect(rows.filter(r => r.kind === "codex").length).toBe(50);
    expect(rows.length).toBeLessThanOrEqual(50 * 4);
    expect(agentsviewSessions(new Set(), rows, { DASH_AGENTSVIEW: "0" })).toEqual([]);
    expect(rosterArchiveHead({})).toBe(50);
    expect(rosterArchiveHead({ DASH_ROSTER_ARCHIVE_HEAD: "3" })).toBe(3);
  }, HEAVY_TEST_TIMEOUT_MS);
  test("history opens archived chats, skips system rows, redacts", () => {
    const history = agentsviewHistory("codex", "c1", fixture());
    expect(history.map(h => h.role)).toEqual(["user", "assistant"]);
    expect(history[1]!.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(agentsviewHistory("hermes", "h1", fixture())).toEqual([]);
  });
  test("missing archive degrades to no extra rows", async () => {
    expect(await head("/nonexistent/dash-av/sessions.db")).toEqual([]);
    expect(agentsviewSessions(new Set(), [])).toEqual([]);
    expect(nativeSessionId("codex", "codex:x")).toBe("x");
  });
});
