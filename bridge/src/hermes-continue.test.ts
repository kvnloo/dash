import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { awaitHandoff, chooseHermesRoute, claimContinuation, HandoffAborted, handoffText } from "./hermes-continue";
import { ownerOf, readLiveOwners, surfaceLabel } from "./hermes-owner";
import { HermesSessions } from "./hermes-sessions";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function scratchRoot(): string {
  const scratch = process.env.TMPDIR ?? join(homedir(), ".cache", "dash-tests");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "dash-handoff-")); roots.push(root);
  return root;
}

function writeLeases(home: string, entries: unknown[]): void {
  mkdirSync(join(home, "runtime"), { recursive: true });
  writeFileSync(join(home, "runtime", "active_sessions.json"), JSON.stringify({ entries }));
}

const alive = (pids: Record<number, number | undefined>) => ({
  alive: (pid: number) => pid in pids,
  startTime: (pid: number) => pids[pid],
});

test("live owners come from Hermes's lease registry; dead and reused PIDs are ignored", () => {
  const home = scratchRoot();
  writeLeases(home, [
    { session_id: "open", surface: "cli", pid: 101, process_start_time: 1000.2 },
    { session_id: "dead", surface: "cli", pid: 102, process_start_time: 1000 },
    { session_id: "reused", surface: "tui", pid: 103, process_start_time: 1000 },
    { session_id: "", surface: "cli", pid: 104 },
    { session_id: "nopid", surface: "cli" },
    { session_id: "self", surface: "cli", pid: process.pid },
    "garbage",
  ]);
  const owners = readLiveOwners(home, alive({ 101: 1000, 103: 5000, 104: undefined, [process.pid]: undefined }));
  expect(owners).toEqual([{ surface: "cli", pid: 101, sessionId: "open" }]);
  expect(ownerOf(owners, new Set(["x", "open"]))?.sessionId).toBe("open");
  expect(ownerOf(owners, new Set(["x"]))).toBeUndefined();
  expect(readLiveOwners(join(home, "missing"), alive({}))).toEqual([]);
  writeFileSync(join(home, "runtime", "active_sessions.json"), "{not json");
  expect(readLiveOwners(home, alive({ 101: 1000 }))).toEqual([]);
  expect(surfaceLabel("cli")).toBe("CLI");
  expect(surfaceLabel("desktop")).toBe("desktop");
});

test("roster marks a CLI-held chat, including its compressed ancestors, and nothing else", async () => {
  const root = scratchRoot();
  const db = new Database(join(root, "state.db"));
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, last_activity_at REAL, message_count INTEGER, cwd TEXT, archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, parent_session_id TEXT, end_reason TEXT, model_config TEXT);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, active INTEGER DEFAULT 1);`);
  db.run("INSERT INTO sessions (id,source,title,started_at,last_activity_at,end_reason) VALUES ('old','cli','Long chat',1,2,'compression')");
  db.run("INSERT INTO sessions (id,source,title,started_at,last_activity_at,parent_session_id) VALUES ('tip','cli','Long chat',3,4,'old')");
  db.run("INSERT INTO sessions (id,source,title,started_at,last_activity_at) VALUES ('free','acp','Dash chat',5,6)");
  db.close();
  writeLeases(root, [{ session_id: "tip", surface: "cli", pid: 4242 }]);
  const sessions = new HermesSessions({ root, env: {}, processes: alive({ 4242: undefined }) });
  const agents = await sessions.list();
  const byId = new Map(agents.map(a => [a.sessionId, a]));
  expect(byId.get("tip")?.openIn).toBe("CLI");
  expect(byId.get("old")?.openIn).toBe("CLI");
  expect(byId.get("free")?.openIn).toBeUndefined();
  expect(byId.get("tip")?.status).toBe("available");
  expect(sessions.liveOwner("default", "old")?.sessionId).toBe("tip");
  expect(sessions.liveOwner("default", "free")).toBeUndefined();
  expect(sessions.liveOwner("nope", "tip")).toBeUndefined();
  expect(sessions.profileForHome(root)).toBe("default");
  expect(sessions.profileForHome(join(root, "missing"))).toBeUndefined();
  expect(sessions.homeOf("default")).toBe(root);
  const released = new HermesSessions({ root, env: {}, processes: alive({}) });
  expect((await released.list()).some(a => a.openIn)).toBe(false);
});

test("route prefers the native API, then Hermes ACP, and never a classic CLI", () => {
  const api = { url: "http://127.0.0.1:1", key: "k" };
  expect(chooseHermesRoute({ api, home: "/h", acpCommand: ["/bin/hermes", "acp"] })).toEqual({ kind: "api", api });
  expect(chooseHermesRoute({ home: "/h", acpCommand: ["/bin/hermes", "acp"] })).toEqual({ kind: "acp", command: ["/bin/hermes", "acp"], home: "/h" });
  expect(chooseHermesRoute({ home: "/h", acpCommand: null }).kind).toBe("unavailable");
  expect(chooseHermesRoute({ acpCommand: ["/bin/hermes", "acp"] }).kind).toBe("unavailable");
});

test("one Dash continuation per session; release is idempotent", () => {
  const release = claimContinuation("clean", "s1");
  expect(release).toBeDefined();
  expect(claimContinuation("clean", "s1")).toBeUndefined();
  expect(claimContinuation("default", "s1")).toBeDefined();
  release?.();
  release?.();
  const again = claimContinuation("clean", "s1");
  expect(again).toBeDefined();
  expect(claimContinuation("clean", "s1")).toBeUndefined();
  again?.();
});

const owner = { surface: "cli", pid: 7, sessionId: "s" };
const instant = async () => {};

test("no owner: no queued state, continue at once", async () => {
  const queued: unknown[] = [];
  const result = await awaitHandoff({ owner: () => undefined, signal: new AbortController().signal, onQueued: o => queued.push(o), sleep: instant });
  expect(result).toBeUndefined();
  expect(queued).toEqual([]);
});

test("owner present: queue once, then continue only after it closes", async () => {
  let polls = 0;
  const queued: unknown[] = [];
  const result = await awaitHandoff({ owner: () => (++polls < 4 ? owner : undefined), signal: new AbortController().signal, onQueued: o => queued.push(o), sleep: instant });
  expect(result).toEqual(owner);
  expect(queued).toEqual([owner]);
  expect(polls).toBe(4);
});

test("cancel or an endless owner sends nothing", async () => {
  const abort = new AbortController();
  const waiting = awaitHandoff({ owner: () => owner, signal: abort.signal, onQueued: () => abort.abort(), sleep: instant });
  await expect(waiting).rejects.toBeInstanceOf(HandoffAborted);
  await expect(awaitHandoff({ owner: () => owner, signal: new AbortController().signal, onQueued: () => {}, sleep: instant, maxWaitMs: 0 })).rejects.toThrow("too long");
  // Real timer path: abort wakes the sleeper instead of waiting out the poll.
  const live = new AbortController();
  const started = Date.now();
  const pending = awaitHandoff({ owner: () => owner, signal: live.signal, onQueued: () => {}, pollMs: 60_000 });
  setTimeout(() => live.abort(), 10);
  await expect(pending).rejects.toBeInstanceOf(HandoffAborted);
  expect(Date.now() - started).toBeLessThan(5_000);
});

test("handoff copy is honest about what was sent", () => {
  expect(handoffText({ state: "queued", surface: "cli", host: "groot" })).toBe("Open in CLI on groot · reply queued until it closes");
  expect(handoffText({ state: "sending", surface: "tui", host: "groot" })).toBe("TUI on groot closed · sending queued reply");
});
