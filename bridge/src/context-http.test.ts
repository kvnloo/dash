import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compactionEnabled, contextHttp, parseProviderUsage, planCache } from "./context-http";
import { HermesSessions } from "./hermes-sessions";
import { contextFixture } from "../../shared/context.test";

describe("provider plan projection", () => {
  test("allows percentages and reset timestamps, never identity or tokens", () => {
    const result = parseProviderUsage([{ provider: "claude", token: "never-forward", usage: { identity: { email: "private" }, primary: { usedPercent: 68, resetsAt: "2026-10-22T01:00:00Z" }, secondary: { usedPercent: 24 }, extraRateWindows: [{ title: "Opus", window: { usedPercent: 17 } }] } }], "claude");
    expect(result).toEqual({ provider: "claude", windows: [{ label: "Session limit", percent: 68, resetsAt: "2026-10-22T01:00:00Z" }, { label: "Weekly limit", percent: 24 }, { label: "Opus", percent: 17 }] });
    expect(JSON.stringify(result)).not.toMatch(/private|never-forward|identity|token/);
  });
  test("handles missing and malformed windows without inventing zero", () => {
    expect(parseProviderUsage(null, "codex")).toEqual({ provider: "codex", windows: [], unavailable: true });
    expect(parseProviderUsage([{ provider: "codex", usage: { primary: null, secondary: { usedPercent: 14 }, tertiary: { usedPercent: NaN } } }], "codex").windows).toEqual([{ label: "Weekly limit", percent: 14 }]);
    for (const usedPercent of [-1, 101, Infinity, "20"]) expect(parseProviderUsage({ provider: "claude", usage: { primary: { usedPercent } } }, "claude").windows).toEqual([]);
  });
  test("coalesces and caches 60 seconds", async () => {
    let calls = 0; let now = 0;
    const read = planCache(async provider => { calls++; return { provider, windows: [] }; }, () => now);
    const first = read(); expect(read()).toBe(first); await first; expect(calls).toBe(2);
    now = 59_999; await read(); expect(calls).toBe(2);
    now = 60_000; await read(); expect(calls).toBe(4);
  });
});

test("context endpoint with compaction opted in authenticates, resolves native identity, verifies compaction readback", async () => {
  const root = mkdtempSync(join(tmpdir(), "dash-context-"));
  try {
    const db = new Database(join(root, "state.db"));
    db.exec("CREATE TABLE sessions(id TEXT,source TEXT,title TEXT,started_at REAL,last_activity_at REAL,message_count INTEGER,cwd TEXT,archived INTEGER,hidden INTEGER,parent_session_id TEXT,end_reason TEXT,model_config TEXT); INSERT INTO sessions VALUES('scratch','cli','Scratch',1,1,2,'/workspace',0,0,NULL,NULL,'{}');"); db.close();
    const sessions = new HermesSessions({ root, env: {} });
    let reads = 0; let writes = 0;
    const handler = contextHttp({ sessions, plans: async () => [], read: async () => { reads++; return contextFixture(writes ? { used: 80_000, revision: "summary" } : {}); }, compact: async () => { writes++; return { ok: true, code: "committed" }; }, compaction: true });
    const url = "http://localhost/chat/context?profile=default&session=scratch";
    expect((await handler(new Request(url), false))?.status).toBe(401); expect(reads).toBe(0);
    expect((await handler(new Request(url.replace("scratch", "unknown")), true))?.status).toBe(404);
    expect((await handler(new Request(url.replace("default", "../../etc")), true))?.status).toBe(404);
    expect((await handler(new Request(url, { method: "POST" }), true))?.status).toBe(405);
    const response = await handler(new Request(url.replace("context?", "context/compact?"), { method: "POST" }), true);
    expect(response?.status).toBe(200); expect(writes).toBe(1); expect(reads).toBe(2);
    expect(await response?.json()).toMatchObject({ ok: true, context: { used: 80_000, revision: "summary" } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("context endpoint authenticates before any read, resolves native identity, never compacts unless opted in", async () => {
  const root = mkdtempSync(join(tmpdir(), "dash-context-"));
  try {
    const db = new Database(join(root, "state.db"));
    db.exec("CREATE TABLE sessions(id TEXT,source TEXT,title TEXT,started_at REAL,last_activity_at REAL,message_count INTEGER,cwd TEXT,archived INTEGER,hidden INTEGER,parent_session_id TEXT,end_reason TEXT,model_config TEXT); INSERT INTO sessions VALUES('scratch','cli','Scratch',1,1,2,'/workspace',0,0,NULL,NULL,'{}');"); db.close();
    const sessions = new HermesSessions({ root, env: {} });
    let reads = 0; let planReads = 0;
    const handler = contextHttp({ sessions, plans: async () => { planReads++; return []; }, read: async () => { reads++; return contextFixture({}); } });
    const url = "http://localhost/chat/context?profile=default&session=scratch";
    const compactUrl = url.replace("context?", "context/compact?");
    // Fail closed: unauthenticated GET and POST compact read nothing.
    expect((await handler(new Request(url), false))?.status).toBe(401);
    expect((await handler(new Request(compactUrl, { method: "POST" }), false))?.status).toBe(401);
    expect(reads + planReads).toBe(0);
    expect((await handler(new Request(url.replace("scratch", "unknown")), true))?.status).toBe(404);
    expect((await handler(new Request(url.replace("default", "../../etc")), true))?.status).toBe(404);
    expect((await handler(new Request("http://localhost/chat/context?profile=default"), true))?.status).toBe(400);
    expect((await handler(new Request(url, { method: "POST" }), true))?.status).toBe(405);
    expect(reads).toBe(0);
    // Read-only rollout: compaction is explicitly unavailable, and neither reads nor executes anything.
    const compact = await handler(new Request(compactUrl, { method: "POST" }), true);
    expect(compact?.status).toBe(501);
    expect(await compact?.json()).toEqual({ ok: false, code: "unavailable", error: "Compaction is not available on this host" });
    expect(reads).toBe(0);
    const response = await handler(new Request(url), true);
    expect(response?.status).toBe(200); expect(reads).toBe(1);
    expect(await response?.json()).toMatchObject({ context: { sessionId: "scratch" }, plans: [] });
    // Unrelated paths fall through to other handlers.
    expect(await handler(new Request("http://localhost/chat/contextual"), true)).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("compaction is opt-in only through DASH_CONTEXT_COMPACTION=1", () => {
  expect(compactionEnabled({})).toBe(false);
  for (const value of ["0", "true", "yes", ""]) expect(compactionEnabled({ DASH_CONTEXT_COMPACTION: value })).toBe(false);
  expect(compactionEnabled({ DASH_CONTEXT_COMPACTION: "1" })).toBe(true);
});
