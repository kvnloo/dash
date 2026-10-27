import { expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage } from "./protocol";
const id = "00000000-0000-0000-0000-000000000000";
test("approval protocol validates bounded decisions without changing legacy messages", () => {
  expect(parseClientMessage({ type: "gate_list" })).toEqual({ type: "gate_list" });
  expect(parseClientMessage({ type: "gate_decide", decision: { action: "approve", ids: [id] } })).not.toBeNull();
  expect(parseClientMessage({ type: "gate_decide", decision: { action: "approve", ids: [] } })).toBeNull();
  expect(parseClientMessage({ type: "gate_decide", decision: { action: "reject", id, reason: "" } })).toBeNull();
  expect(parseClientMessage({ type: "gate_post", id: "../escape" })).toBeNull();
  expect(parseServerMessage({ type: "gate_snapshot", items: [], dry_run: true })).not.toBeNull();
  expect(parseServerMessage({ type: "gate_snapshot", items: [{}], dry_run: true })).toBeNull();
  expect(parseServerMessage({ type: "gate_status", id, message: "Posting…" })).not.toBeNull();
  expect(parseServerMessage({ type: "gate_error", message: "Denied" })).not.toBeNull();
  expect(parseClientMessage({ type: "cancel", id: "old" })).toEqual({ type: "cancel", id: "old" });
});
