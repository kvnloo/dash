import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HermesSessions } from "./hermes-sessions";
import { runHermesSession } from "./hermes-session";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const scratch = process.env.TMPDIR ?? join(homedir(), ".cache", "dash-tests");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "dash-hermes-")); roots.push(root);
  mkdirSync(join(root, "profiles/clean"), { recursive: true });
  for (const home of [root, join(root, "profiles/clean")]) {
    const db = new Database(join(home, "state.db"));
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, last_activity_at REAL, message_count INTEGER, cwd TEXT, archived INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, parent_session_id TEXT, end_reason TEXT, model_config TEXT);
      CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, active INTEGER DEFAULT 1);`);
    db.run("INSERT INTO sessions (id,source,title,started_at,last_activity_at,message_count,cwd) VALUES ('same','local','Current CLI',1,3,2,'/project')");
    for (const source of ["oneshot", "cron", "subagent", "kanban", "tool", "kitchen"]) db.run("INSERT INTO sessions (id,source,title) VALUES (?,?,?)", [source, source, source]);
    db.run("INSERT INTO sessions (id,source,archived) VALUES ('archived','cli',1)");
    db.run("INSERT INTO sessions (id,source,hidden) VALUES ('hidden','cli',1)");
    db.run("INSERT INTO messages VALUES (1,'same','user','hello',2,1),(2,'same','assistant','latest',3,1),(3,'same','tool','secret tool output',4,1),(4,'same','assistant','inactive',5,0)");
    db.close();
  }
  return root;
}
test("native HTTP transport continues the exact session without exposing its key or retrying", async () => {
  const requests: { path: string; body?: unknown }[] = [];
  let fail = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(request.headers.get("Authorization")).toBe("Bearer fixture-only-key");
    const path = new URL(request.url).pathname;
    requests.push({ path, body: request.method === "POST" ? await request.json() : undefined });
    if (request.method === "GET") return Response.json({ session: { id: "same" } });
    return fail ? new Response("busy", { status: 409 }) : Response.json({ session_id: "same", message: { role: "assistant", content: "continued" }, status: "completed" });
  } });
  try {
    const logs: unknown[] = [];
    const options = { input: { text: "continue", cwd: "/project", sessionId: "same" }, api: { url: `http://127.0.0.1:${server.port}`, key: "fixture-only-key" }, env: {}, log: (event: string, fields?: Record<string, unknown>) => { logs.push({ event, fields }); } };
    expect(await runHermesSession(options)).toEqual({ path: "api", text: "continued", sessionId: "same" });
    expect(requests).toEqual([{ path: "/api/sessions/same" }, { path: "/api/sessions/same/chat", body: { message: "continue" } }]);
    expect(JSON.stringify(logs)).not.toContain("fixture-only-key");
    fail = true;
    await expect(runHermesSession(options)).rejects.toThrow("No fallback attempted");
    expect(requests).toHaveLength(4);
  } finally { await server.stop(true); }
});
test("profile identity and read-only compression lineage cannot select delegated workers", async () => {
  const root = fixture();
  const db = new Database(join(root, "profiles/clean/state.db"));
  db.run("UPDATE sessions SET end_reason='compression' WHERE id='same'");
  db.run("INSERT INTO sessions (id,source,title,started_at,parent_session_id) VALUES ('tip','local','Continued CLI',10,'same'),('worker','subagent','Private worker',20,'same')");
  db.run("INSERT INTO messages VALUES (5,'tip','assistant','tip text',20,1),(6,'worker','assistant','not in chat',30,1)");
  db.close();
  const sessions = new HermesSessions({ root, env: {} });
  expect(sessions.target(undefined, "same")).toBeUndefined();
  expect(sessions.target("hermes:session:clean:same", "same")?.profile).toBe("clean");
  expect(sessions.target("../clean", "same")).toBeUndefined();
  expect((await sessions.history("clean", "tip")).map(m => m.text)).toEqual(["hello", "latest", "tip text"]);
});

test("read-only multi-profile discovery keeps local CLI but excludes internal and hidden noise", async () => {
  const root = fixture();
  const sessions = new HermesSessions({ root, env: {} });
  const rows = await sessions.list();
  expect(rows).toHaveLength(2);
  expect(rows.map(r => r.profileId).sort()).toEqual(["clean", "default"]);
  expect(rows.find(r => r.profileId === "clean")).toMatchObject({ name: "Current CLI", sessionId: "same", cwd: "/project", lastActivityAt: 3000, messageCount: 2, status: "available" });
  expect(await sessions.history("clean", "same")).toEqual([
    { id: "1", role: "user", text: "hello", at: 2000 }, { id: "2", role: "assistant", text: "latest", at: 3000 },
  ]);
  expect(await sessions.history("../clean", "same")).toEqual([]);
  expect(await sessions.history("clean", "hidden")).toEqual([]);
});
test("prefers profile API pages, enriches cwd from DB and maps native history JSON", async () => {
  const root = fixture();
  writeFileSync(join(root, ".env"), "API_SERVER_KEY=fixture-only-key\nAPI_SERVER_PORT=8642\n");
  const calls: string[] = [];
  const sessions = new HermesSessions({ root, env: {}, fetch: async (input, init) => {
    const url = String(input); calls.push(url);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-only-key");
    if (url.includes("/messages")) return Response.json({ data: [{ id: 9, role: "assistant", content: [{ type: "text", text: "API latest" }], timestamp: 8 }, { id: 10, role: "tool", content: "not shown" }] });
    if (url.includes("offset=200")) return Response.json({ data: [{ id: "api-tail", source: "telegram", title: "Second page", last_active: 6 }], has_more: false });
    return Response.json({ data: [{ id: "same", source: "local", title: "Native API title", last_active: 5, message_count: 8 }, { id: "noise", source: "oneshot" }, { id: "hidden", source: "cli", hidden: true }], has_more: true });
  } });
  const rows = await sessions.list();
  expect(rows.find(r => r.profileId === "default" && r.sessionId === "same")).toMatchObject({ name: "Native API title", lastActivityAt: 5000, messageCount: 8, cwd: "/project" });
  expect(rows.some(r => r.sessionId === "api-tail")).toBe(true);
  expect(sessions.target("default", "api-tail")?.profile).toBe("default");
  expect(rows.some(r => r.sessionId === "noise" || r.sessionId === "hidden")).toBe(false);
  expect(await sessions.history("default", "same")).toEqual([{ id: "9", role: "assistant", text: "API latest", at: 8000 }]);
  expect(calls.some(url => url.includes("order=latest"))).toBe(true);
});
test("a copied default API endpoint cannot replace a named profile's roster or history", async () => {
  const root = fixture();
  writeFileSync(join(root, "profiles/clean/.env"), "API_SERVER_KEY=copied-key\n");
  const sessions = new HermesSessions({ root, env: {}, fetch: async () => Response.json({ data: [{ id: "foreign", source: "cli", title: "Other profile" }], has_more: false }) });
  const rows = await sessions.list();
  expect(rows.find(r => r.profileId === "clean")).toMatchObject({ sessionId: "same", name: "Current CLI" });
  expect(rows.some(r => r.sessionId === "foreign")).toBe(false);
  expect((await sessions.history("clean", "same")).map(m => m.text)).toEqual(["hello", "latest"]);
});

test("unreachable API falls back to DB; one broken profile does not hide others", async () => {
  const root = fixture();
  writeFileSync(join(root, ".env"), "API_SERVER_KEY=fixture-key\n");
  const sessions = new HermesSessions({ root, env: {}, fetch: async () => { throw new TypeError("connection refused"); } });
  expect(await sessions.list()).toHaveLength(2);
  expect(await sessions.history("default", "same")).toHaveLength(2);
});

test("native history previews and on-demand details leave the exact database bytes unchanged", async () => {
  const root = fixture(); const path = join(root, "profiles/clean/state.db"); const db = new Database(path);
  db.exec("ALTER TABLE messages ADD COLUMN reasoning_content TEXT; ALTER TABLE messages ADD COLUMN tool_calls TEXT; ALTER TABLE messages ADD COLUMN tool_call_id TEXT;");
  db.run("UPDATE messages SET reasoning_content=?,tool_calls=? WHERE id=2", ["inspect native session", JSON.stringify([{ id: "a", function: { name: "terminal", arguments: '{\"command\":\"printf sample\"}' } }])]);
  db.run("UPDATE messages SET content=?,tool_call_id='a' WHERE id=3", ["x".repeat(10000)]); db.close();
  const before = readFileSync(path); const sessions = new HermesSessions({ root, env: {} });
  const history = await sessions.history("clean", "same");
  const output = history[1]?.parts?.find(part => part.kind === "tool_output");
  expect(output?.kind === "tool_output" ? output.text.length : 0).toBe(8192);
  expect(output).toMatchObject({ truncated: true });
  const detail = sessions.toolDetail("clean", "same", "2", "a");
  expect(detail?.kind === "tool_detail" ? detail.text.length : 0).toBe(10000);
  expect(sessions.toolDetail("clean", "hidden", "2", "a")).toBeUndefined();
  expect(sessions.toolDetail("clean", "same", "missing", "a")).toBeUndefined();
  expect(readFileSync(path).equals(before)).toBe(true);
}, 20_000); // copies+hashes a real SQLite file; siblings take ~4 s and full-suite load pushed it past the 5 s default

test("a stray profiles/default directory does not make default sessions ambiguous", async () => {
  const root = fixture();
  mkdirSync(join(root, "profiles/default"), { recursive: true });
  writeFileSync(join(root, "profiles/default/state.db"), "");
  const sessions = new HermesSessions({ root, env: {} });
  expect(sessions.target("hermes:session:default:same", "same")?.profile).toBe("default");
  const listed = await sessions.list();
  expect(listed.filter(a => a.sessionId === "same" && a.profileId === "default")).toHaveLength(1);
  // The roster has now named the session; it must still resolve to exactly one profile.
  expect(sessions.target("hermes:session:default:same", "same")?.profile).toBe("default");
  expect(sessions.target("default", "same")?.profile).toBe("default");
});
