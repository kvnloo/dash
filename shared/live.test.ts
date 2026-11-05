import { expect, test } from "bun:test";
import { parseClientMessage, parseServerMessage } from "./protocol";

test("live client messages parse through the one protocol entry and fail closed", () => {
  expect(parseClientMessage({ type: "live_open", id: "r1", profileId: "clean", sessionId: "local-abc" })).toEqual({ type: "live_open", id: "r1", profileId: "clean", sessionId: "local-abc" });
  expect(parseClientMessage({ type: "live_turn", id: "r2", workerId: "wrun_1", profileId: "clean", text: "hi", askHermes: true })).toMatchObject({ askHermes: true });
  expect(parseClientMessage({ type: "live_turn", id: "r2", workerId: "wrun_1", profileId: "clean", text: "  " })).toBeNull();
  expect(parseClientMessage({ type: "live_turn", id: "r2", workerId: "../x", profileId: "clean", text: "hi" })).toBeNull();
  expect(parseClientMessage({ type: "live_intent", id: "r3", workerId: "w", profileId: "clean", intent: { controlId: "header", value: "split", label: "Split", artifactVersion: 2 }, continue: true }))
    .toEqual({ type: "live_intent", id: "r3", workerId: "w", profileId: "clean", intent: { controlId: "header", value: "split", label: "Split", artifactVersion: 2 }, continue: true });
  expect(parseClientMessage({ type: "live_intent", id: "r3", workerId: "w", profileId: "clean", intent: { controlId: "<x>", value: "a" } })).toBeNull();
  expect(parseClientMessage({ type: "live_intent", id: "r3", workerId: "w", profileId: "clean", intent: { controlId: "h", value: { evil: 1 } } })).toBeNull();
});

test("live server messages carry artifacts, events and Hermes receipts", () => {
  const artifact = { kind: "html", version: 1, bytes: 10, sha256: "ab", html: "<!doctype html>", createdAt: 1 };
  expect(parseServerMessage({ type: "live_opened", id: "r1", workerId: "w", profileId: "clean", parentSessionId: "local-1", artifacts: [artifact] })).toMatchObject({ workerId: "w" });
  expect(parseServerMessage({ type: "live_event", id: "r2", seq: 1, workerId: "w", event: { type: "artifact", artifact } })).toMatchObject({ seq: 1 });
  expect(parseServerMessage({ type: "live_event", id: "r2", seq: 1, workerId: "w", event: { type: "hermes", phase: "answered", text: "app/src/components/WorkspaceHeader.tsx" } })).toBeTruthy();
  expect(parseServerMessage({ type: "live_event", id: "r2", seq: 1, workerId: "w", event: { type: "artifact", artifact: { ...artifact, kind: "svg" } } })).toBeNull();
  expect(parseServerMessage({ type: "live_receipts", id: "r3", workerId: "w", receipts: [{ kind: "intent", summary: "picked", decisions: ["header = Split"], artifacts: [], at: 1, hermes: { child: "fxw_w", messageId: 7 } }] })).toBeTruthy();
  expect(parseServerMessage({ type: "live_error", id: "r4", message: "no z0bridge" })).toEqual({ type: "live_error", id: "r4", message: "no z0bridge" });
});
