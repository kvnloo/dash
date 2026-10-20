import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GateStore } from "./store";
import { GateExecutor, type GateRemote } from "./executor";
import { proposal, rules } from "./store.test";

const setup = async (drift = "") => {
  const dir = mkdtempSync(join(tmpdir(), "gate-exec-"));
  const store = new GateStore(dir);
  const i = await store.propose(proposal(), rules);
  let writes = 0;
  const remote: GateRemote = { rules: async () => rules, check: async () => drift, authorized: async () => true, post: async () => { writes++; return "https://github.com/example/project/issues/12#issuecomment-1"; }, verify: async () => true };
  return { dir, store, i, remote, writes: () => writes, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
};
test("executor rejects unapproved and dry-run never writes or pretends posted", async () => {
  const s = await setup();
  try {
    const ex = new GateExecutor(s.store, s.remote);
    await expect(ex.post(s.i.id, true)).rejects.toThrow("approved");
    await s.store.decide({ action: "approve", ids: [s.i.id] }, "dash-owner");
    const result = await ex.post(s.i.id, true);
    expect(result.state).toBe("approved"); expect(result.receipt?.dry_run).toBe(true); expect(result.receipt?.url).toBeUndefined(); expect(s.writes()).toBe(0);
  } finally { s.cleanup(); }
});
test("executor marks live drift stale without writing", async () => {
  const s = await setup("Issue closed or head changed");
  try {
    await s.store.decide({ action: "approve", ids: [s.i.id] }, "dash-owner");
    expect((await new GateExecutor(s.store, s.remote).post(s.i.id, true)).state).toBe("stale"); expect(s.writes()).toBe(0);
  } finally { s.cleanup(); }
});
test("policy drift invalidates previous approval", async () => {
  const s = await setup();
  try {
    await s.store.decide({ action: "approve", ids: [s.i.id] }, "dash-owner");
    s.remote.rules = async () => [{ path: "AGENTS.md", text: "No AI-generated comments" }];
    expect((await new GateExecutor(s.store, s.remote).post(s.i.id, true)).state).toBe("stale"); expect(s.writes()).toBe(0);
  } finally { s.cleanup(); }
});
test("one-at-a-time execution; exact receipt verified; failed verification cannot repost", async () => {
  const s = await setup();
  try {
    await s.store.decide({ action: "approve", ids: [s.i.id] }, "dash-owner");
    const { hash } = await import("./store");
    await s.store.decide({ action: "approve", ids: [s.i.id] }, "dash-owner", { [s.i.id]: { url: "https://github.com/example/coord/issues/1#issuecomment-1", approved_by: "synthetic test owner", expires_at: new Date(Date.now() + 60000).toISOString(), body_sha256: hash(s.i.body), scope: "Synthetic remote only" } });
    s.remote.verify = async () => false;
    const ex = new GateExecutor(s.store, s.remote);
    const result = await ex.post(s.i.id, false);
    expect(result.state).toBe("failed"); expect(s.writes()).toBe(1);
    await expect(ex.post(s.i.id, false)).rejects.toThrow("approved");
  } finally { s.cleanup(); }
});
