import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecentModelsHttpHandler, modelProfileHome, readRecentModels } from "./recent-models-http";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dash-recent-models-")); dirs.push(root);
  const home = join(root, "profiles", "clean"); mkdirSync(home, { recursive: true });
  const db = new Database(join(home, "state.db"));
  db.exec("CREATE TABLE sessions(id TEXT, model TEXT, model_config TEXT, billing_provider TEXT, started_at REAL)");
  const now = 1800000000000;
  const add = (id: string, model: string, provider: string, days = 0, config = "{}") => db.run("INSERT INTO sessions VALUES(?,?,?,?,?)", [id, model, config, provider, now / 1000 - days * 86400]);
  add("one", "gpt-6.1-sol", "openai-codex"); add("two", "gpt-6.1-sol", "openai-codex", 13);
  add("old", "old", "anthropic", 15); add("boundary", "claude-opus-5-5", "anthropic", 14);
  add("cancelled", "grok", "xai"); add("future", "future", "anthropic", -1);
  add("runtime", "wrong", "xai", 0, JSON.stringify({ gateway_runtime: { provider: "nous", model: "anthropic/claude-opus-5.5" } }));
  db.close();
  writeFileSync(join(home, "provider_models_cache.json"), JSON.stringify({ "openai-codex": { models: ["gpt-6.1-sol", "gpt-6-luna"], fingerprint: "must-not-leak" }, xai: { models: ["grok"] } }));
  return { root, home, now };
}
test("ranks exact provider/model pairs over inclusive 14 days, filters cancelled providers, reads runtime identity", () => {
  const { home, now } = fixture();
  const result = readRecentModels(home, now, "runtime");
  expect(result.models).toEqual([
    { provider: "openai-codex", model: "gpt-6.1-sol", count: 2 },
    { provider: "anthropic", model: "claude-opus-5-5", count: 1 },
    { provider: "nous", model: "anthropic/claude-opus-5.5", count: 1 },
  ]);
  expect(result.current).toMatchObject({ provider: "nous", model: "anthropic/claude-opus-5.5" });
  expect(result.catalog).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain("must-not-leak");
  expect(result.canApply).toBe(false);
  const db = new Database(join(home, "state.db"), { readonly: true });
  expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM sessions").get()?.n).toBe(7); db.close();
});
test("authenticated, read-only HTTP; malformed targets fail, missing profile does not initialize DB", async () => {
  const { root, now } = fixture();
  const denied = createRecentModelsHttpHandler({ root, authorize: async () => false });
  expect((await denied(new Request("http://bridge/models/recent?profile=clean")))?.status).toBe(401);
  const handler = createRecentModelsHttpHandler({ root, now: () => now, authorize: async () => true });
  expect(await handler(new Request("http://bridge/other"))).toBeNull();
  expect((await handler(new Request("http://bridge/models/recent?profile=clean", { method: "POST" })))?.status).toBe(405);
  expect((await handler(new Request("http://bridge/models/recent?profile=..%2fclean")))?.status).toBe(400);
  expect((await handler(new Request("http://bridge/models/recent?profile=missing")))?.status).toBe(503);
  expect((await handler(new Request("http://bridge/models/recent?profile=clean&session=runtime")))?.status).toBe(200);
});
test("profile symlink escapes are rejected", () => {
  const { root } = fixture(); const outside = mkdtempSync(join(tmpdir(), "outside-models-")); dirs.push(outside);
  symlinkSync(outside, join(root, "profiles", "escape"));
  expect(() => modelProfileHome(root, "escape")).toThrow("outside root");
});
