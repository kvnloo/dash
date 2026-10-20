import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GateStore, derivePolicy } from "./store";

export const proposal = () => ({
  kind: "issue_comment" as const, target: { repo: "example/project", number: 12 }, body: "Verified evidence.",
  evidence: [{ label: "receipt", url_or_path: "https://github.com/example/project/issues/12" }],
  origin: { agent: "hermes", session: "test", created_at: new Date().toISOString() },
});
export const rules = [{ path: "CONTRIBUTING.md", text: "Tests and clear reproduction are required." }];

test("outbox proposals cannot approve via CLI; Dash approval is body-bound and durable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-test-"));
  try {
    const store = new GateStore(dir);
    const item = await store.propose(proposal(), rules);
    expect(item.state).toBe("pending");
    await expect(store.decide({ action: "approve", ids: [item.id] }, "agent")).rejects.toThrow("Dash");
    await store.decide({ action: "approve", ids: [item.id] }, "dash-owner");
    expect((await store.show(item.id)).state).toBe("approved");
    await store.decide({ action: "edit", id: item.id, body: "Owner changed this" }, "dash-owner");
    expect((await store.show(item.id)).state).toBe("edited");
    expect(new GateStore(dir).list().length).toBe(1);
    expect(readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").length).toBe(3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("human-text rules clear generated body, disallow bulk, and require owner edit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-test-"));
  try {
    const store = new GateStore(dir);
    const item = await store.propose(proposal(), [{ path: "AGENTS.md", text: "No AI-generated comments. A human must write responses." }]);
    expect(item.policy.requires_human_text).toBe(true);
    expect(item.policy.bulk_ok).toBe(false);
    expect(item.body).toBe("");
    await expect(store.decide({ action: "approve", ids: [item.id] }, "dash-owner")).rejects.toThrow("write");
    await store.decide({ action: "edit", id: item.id, body: "I checked the issue." }, "dash-owner");
    await store.decide({ action: "approve", ids: [item.id] }, "dash-owner");
    expect((await store.show(item.id)).state).toBe("approved");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unknown contribution policy and CLA/DCO are never bulk-safe", () => {
  expect(derivePolicy([]).bulk_ok).toBe(false);
  expect(derivePolicy([{ path: "CONTRIBUTING.md", text: "Sign the CLA and DCO." }]).bulk_ok).toBe(false);
});

test("malformed paths, empty rejection, duplicate batch and partial bulk fail closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-test-"));
  try {
    const store = new GateStore(dir);
    const a = await store.propose(proposal(), rules);
    const b = await store.propose({ ...proposal(), body: "Other" }, []);
    await expect(store.show("../escape")).rejects.toThrow();
    await expect(store.decide({ action: "reject", id: a.id, reason: "" }, "dash-owner")).rejects.toThrow();
    await expect(store.decide({ action: "approve", ids: [a.id, a.id] }, "dash-owner")).rejects.toThrow();
    await expect(store.decide({ action: "approve", ids: [a.id, b.id] }, "dash-owner")).rejects.toThrow();
    expect((await store.show(a.id)).state).toBe("pending");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
