import { test, expect } from "bun:test";
import { actionable, bulkEligible, approvals, applyGateMessage } from "./approvals";
import type { GateItem } from "../../../shared/gate";
const item: GateItem = { id: "00000000-0000-0000-0000-000000000000", kind: "issue_comment", target: { repo: "example/rehearsal", number: 1 }, body: "Body", evidence: [{ label: "receipt", url_or_path: "local:test" }], origin: { agent: "fixture", session: "fixture", created_at: "2026-10-19T00:00:00Z" }, policy: { bulk_ok: true, requires_human_text: false, reason: "Fixture only", rules: [] }, state: "pending", trail: [] };
test("selection eligibility excludes human text, stale, rejected and approved items", () => {
  expect(bulkEligible(item)).toBe(true);
  expect(bulkEligible({ ...item, policy: { ...item.policy, requires_human_text: true } })).toBe(false);
  for (const state of ["stale", "failed", "posted", "rejected", "approved"] as const) expect(bulkEligible({ ...item, state })).toBe(false);
  expect(actionable({ ...item, state: "edited" })).toBe(true);
});
test("live snapshots remain authoritative; a status is not a fake posted receipt", () => {
  applyGateMessage({ type: "gate_snapshot", items: [item], dry_run: true });
  applyGateMessage({ type: "gate_status", id: item.id, message: "Posting…" });
  expect(approvals.get().items[0]?.state).toBe("pending");
  expect(approvals.get().status[item.id]).toBe("Posting…");
  applyGateMessage({ type: "gate_error", message: "Head changed" }); expect(approvals.get().error).toBe("Head changed");
  applyGateMessage({ type: "gate_snapshot", items: [{ ...item, state: "stale", reason: "Head changed" }], dry_run: true });
  expect(approvals.get().items[0]?.state).toBe("stale"); expect(approvals.get().status).toEqual({});
});
