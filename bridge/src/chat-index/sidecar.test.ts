import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { AgentsviewFixture, engineConfig, HermesFixture, tempDir } from "../fixtures/chat-index/make-fixtures";
import { ChatIndexEngine } from "./worker";

const SELF = { id: "0", name: "groot" };
const engines: ChatIndexEngine[] = [];
afterEach(() => { for (const e of engines.splice(0)) e.stop(); });

function setup() {
  const dir = tempDir();
  const av = new AgentsviewFixture(join(dir, "av.db"));
  const make = () => { const e = new ChatIndexEngine(engineConfig(dir, { agentsviewPath: av.path })); engines.push(e); return e; };
  return { dir, av, make };
}
const all = (e: ChatIndexEngine) => e.list({ limit: 100, fh: "f", kinds: [], hosts: [], chatable: false, self: SELF }).items;

describe("sidecar ingest", () => {
  test("incremental ingest picks up new and changed ended_at rows", async () => {
    const { av, make } = setup();
    av.session({ id: "codex:c1", agent: "codex", first_message: "fix the list", ended_at: "2026-10-01T01:00:00Z" });
    const engine = make();
    await engine.ingest();
    expect(all(engine).map(c => c.sessionId)).toEqual(["c1"]);
    av.session({ id: "codex:c2", agent: "codex", first_message: "second", ended_at: "2026-10-02T01:00:00Z" });
    av.session({ id: "codex:c1", agent: "codex", first_message: "renamed chat", ended_at: "2026-10-03T01:00:00Z" });
    const rev = engine.snapshot().rev;
    await engine.ingest();
    const rows = all(engine);
    expect(rows.map(c => c.sessionId)).toEqual(["c1", "c2"]);
    expect(rows[0]?.title).toBe("renamed chat");
    expect(engine.snapshot().rev).toBeGreaterThan(rev);
    // Nothing changed: no new revision.
    const steady = engine.snapshot().rev;
    await engine.ingest();
    expect(engine.snapshot().rev).toBe(steady);
  });

  test("reconcile marks deleted and automated rows gone and ingests NULL ended_at rows", async () => {
    const { av, make } = setup();
    av.session({ id: "codex:keep", agent: "codex", ended_at: "2026-10-01T01:00:00Z" });
    av.session({ id: "codex:del", agent: "codex", ended_at: "2026-10-01T02:00:00Z" });
    av.session({ id: "codex:auto", agent: "codex", ended_at: "2026-10-01T03:00:00Z" });
    av.session({ id: "claude:open", agent: "claude", ended_at: null, started_at: "2026-10-04T00:00:00Z" });
    const engine = make();
    await engine.ingest();
    expect(all(engine).map(c => c.sessionId).sort()).toEqual(["auto", "del", "keep"]);
    av.db.run("update sessions set deleted_at = '2026-10-05' where id = 'codex:del'");
    av.db.run("update sessions set is_automated = 1 where id = 'codex:auto'");
    await engine.reconcileAgentsview();
    expect(all(engine).map(c => c.sessionId)).toEqual(["open", "keep"]);
    expect(all(engine)[0]?.lastActivityAt).toBe(Date.parse("2026-10-04T00:00:00Z"));
  });

  test("hermes rows in AgentsView are excluded (listed natively); owner filter applies", async () => {
    const { av, make } = setup();
    av.session({ id: "hermes:h1", agent: "hermes" });
    av.session({ id: "probe", agent: "claude", entrypoint: "sdk-cli" });
    av.session({ id: "oneshot", agent: "codex", message_count: 2, user_message_count: 1 });
    av.session({ id: "sub", agent: "claude", parent_session_id: "x" });
    av.session({ id: "ok", agent: "claude" });
    const engine = make();
    await engine.ingest();
    await engine.reconcileAgentsview();
    expect(all(engine).map(c => `${c.kind}:${c.sessionId}`)).toEqual(["claude:ok"]);
  });

  test("machine -> hostId mapping and chatable flags", async () => {
    const { av, make } = setup();
    av.session({ id: "codex:mine", agent: "codex", machine: "groot", ended_at: "2026-10-01T05:00:00Z" });
    av.session({ id: "codex:local", agent: "codex", machine: "local", ended_at: "2026-10-01T04:00:00Z" });
    av.session({ id: "codex:far", agent: "codex", machine: "b163c2db159f66e6567dc1fe9acb4706", ended_at: "2026-10-01T03:00:00Z" });
    av.session({ id: "oc1", agent: "opencode", machine: "groot", ended_at: "2026-10-01T02:00:00Z" });
    const engine = make();
    await engine.ingest();
    const rows = all(engine);
    const by = (id: string) => rows.find(r => r.sessionId === id);
    expect(by("mine")).toMatchObject({ hostId: "0", hostName: "groot", key: "0:codex:mine", chatable: true, origin: "agentsview", agentId: "av:codex:mine" });
    expect(by("local")).toMatchObject({ hostId: "0", chatable: true });
    expect(by("far")).toMatchObject({ hostId: "machine:b163c2db159f66e6567dc1fe9acb4706", hostName: "Other machine (b163c2)", chatable: false });
    expect(by("far")?.key).toBe("machine:b163c2db159f66e6567dc1fe9acb4706:codex:far");
    expect(by("oc1")).toMatchObject({ kind: "opencode", hostId: "0", chatable: false });
  });

  test("titles are one line, cut to 200 chars from a huge first_message, and redacted", async () => {
    const { av, make } = setup();
    const huge = `deploy with token=sk-abcdefghijklmnopqrstuvwxyz123456 ${"x".repeat(190_000)}\nsecond line`;
    av.session({ id: "codex:big", agent: "codex", first_message: `\n\n  ${huge}` });
    const engine = make();
    await engine.ingest();
    const title = all(engine)[0]?.title ?? "";
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(title).not.toContain("\n");
    expect(title.startsWith("deploy with")).toBe(true);
  });

  test("hermes sessions are ingested natively per profile; hidden/delegated rows are not", async () => {
    const { dir, make } = setup();
    const hz = new HermesFixture(join(dir, "hermes"));
    hz.session({ id: "s1", title: "Plan the week", started_at: 1_790_000_000, last_activity_at: 1_790_000_500 });
    hz.session({ id: "s2", title: "Hidden", hidden: 1 });
    hz.session({ id: "s3", title: "Kitchen", source: "cron" });
    hz.session({ id: "s4", title: "Delegate", model_config: JSON.stringify({ _delegate_from: "s1" }) });
    const engine = make();
    await engine.ingest();
    expect(all(engine).map(c => c.key)).toEqual(["0:hermes:s1:default"]);
    expect(all(engine)[0]).toMatchObject({ origin: "hermes", profileId: "default", chatable: true, lastActivityAt: 1_790_000_500_000, agentId: "hermes:session:default:s1" });
    hz.db.run("update sessions set archived = 1 where id = 's1'");
    await engine.reconcileHermes();
    expect(all(engine)).toEqual([]);
  });

  test("DASH_AGENTSVIEW=0 (no archive path) hides archive rows and the roster head", async () => {
    const { dir, av, make } = setup();
    av.session({ id: "codex:c1", agent: "codex" });
    const engine = make();
    await engine.ingest();
    expect(engine.snapshot().head.map(a => a.id)).toEqual(["av:codex:c1"]);
    engine.stop();
    const off = new ChatIndexEngine(engineConfig(dir, { agentsviewPath: undefined }));
    engines.push(off);
    expect(all(off)).toEqual([]);
    expect(off.snapshot().head).toEqual([]);
  });
});
