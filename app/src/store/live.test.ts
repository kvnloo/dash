import { expect, test } from "bun:test";
import { applyLiveMessage, beginIntent, beginLiveTurn, beginOpen, liveOf } from "./live";

const artifact = (version: number) => ({ kind: "html" as const, version, bytes: 10, sha256: `s${version}`, html: `<!doctype html>v${version}`, createdAt: version });

test("a live turn streams text, versions fx0 html, records receipts and times first char and first html", () => {
  const conv = "c1";
  const open = beginOpen(conv);
  expect(liveOf(conv).status).toBe("opening");
  applyLiveMessage({ type: "live_opened", id: open, workerId: "w1", profileId: "clean", parentSessionId: "local-1", artifacts: [] });
  expect(liveOf(conv)).toMatchObject({ status: "ready", workerId: "w1", parentSessionId: "local-1", open: true });
  const turn = beginLiveTurn(conv, "a compact control", false);
  expect(liveOf(conv).busy).toBe(true);
  applyLiveMessage({ type: "live_event", id: turn, seq: 1, workerId: "w1", event: { type: "delta", text: "Building" } });
  applyLiveMessage({ type: "live_event", id: turn, seq: 2, workerId: "w1", event: { type: "artifact", artifact: artifact(1) } });
  applyLiveMessage({ type: "live_event", id: turn, seq: 3, workerId: "w1", event: { type: "tool", id: "t1", name: "publish_design", status: "completed" } });
  applyLiveMessage({ type: "live_event", id: turn, seq: 4, workerId: "w1", event: { type: "delta", text: "Ready." } });
  applyLiveMessage({ type: "live_event", id: turn, seq: 5, workerId: "w1", event: { type: "artifact", artifact: artifact(2) } });
  applyLiveMessage({ type: "live_event", id: turn, seq: 6, workerId: "w1", event: { type: "receipt", receipt: { kind: "turn", summary: "built", decisions: [], artifacts: [{ version: 2, sha256: "s2", bytes: 10 }], at: 1 } } });
  applyLiveMessage({ type: "live_event", id: turn, seq: 7, workerId: "w1", event: { type: "done", stopReason: "end_turn" } });
  const state = liveOf(conv);
  expect(state.lines.map(l => [l.role, l.text])).toEqual([["owner", "a compact control"], ["worker", "Building\n\nReady."]]);
  expect(state.artifacts.map(a => a.version)).toEqual([1, 2]);
  expect(state.shownVersion).toBe(2);
  expect(state.receipts).toHaveLength(1);
  expect(state.busy).toBe(false);
  expect(state.timing?.firstCharAt).toBeGreaterThanOrEqual(state.timing?.sentAt ?? Infinity);
  expect(state.timing?.firstHtmlAt).toBeGreaterThanOrEqual(state.timing?.firstCharAt ?? Infinity);
});

test("a tap shows what was picked, Hermes' answer lands as its own line, and errors never fake success", () => {
  const conv = "c2";
  applyLiveMessage({ type: "live_opened", id: beginOpen(conv), workerId: "w2", profileId: "clean", parentSessionId: "local-2", artifacts: [artifact(1)] });
  const tap = beginIntent(conv, { controlId: "header", value: "split", label: "Split", artifactVersion: 1 });
  applyLiveMessage({ type: "live_event", id: tap, seq: 1, workerId: "w2", event: { type: "receipt", receipt: { kind: "intent", summary: "picked", decisions: ["header = Split (html v1)"], artifacts: [], at: 2 } } });
  applyLiveMessage({ type: "live_event", id: tap, seq: 2, workerId: "w2", event: { type: "hermes", phase: "answered", text: "app/src/components/WorkspaceHeader.tsx" } });
  applyLiveMessage({ type: "live_event", id: tap, seq: 3, workerId: "w2", event: { type: "done", stopReason: "end_turn" } });
  expect(liveOf(conv).lines.map(l => l.role)).toEqual(["owner", "hermes"]);
  expect(liveOf(conv).lines[0]?.text).toBe("Picked Split");
  expect(liveOf(conv).receipts[0]?.decisions).toEqual(["header = Split (html v1)"]);
  const failed = beginLiveTurn(conv, "hi", false);
  applyLiveMessage({ type: "live_error", id: failed, message: "Live surface needs z0bridge running with --fx on this host." });
  expect(liveOf(conv).lines.at(-1)).toMatchObject({ state: "error", text: "Live surface needs z0bridge running with --fx on this host." });
  expect(liveOf(conv).busy).toBe(false);
  // Unknown request ids are ignored.
  applyLiveMessage({ type: "live_event", id: "nope", seq: 1, workerId: "w2", event: { type: "delta", text: "x" } });
  expect(liveOf(conv).lines.some(l => l.text === "x")).toBe(false);
});
