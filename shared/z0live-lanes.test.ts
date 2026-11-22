import { describe, expect, test } from "bun:test";
import { applyZ0LaneEvent, parseZ0LaneEvent, parseZ0LiveLanes, parseZ0LiveLanesState, Z0LANES_MAX, Z0LANES_STALE_SECONDS, Z0LANE_STEP_MAX } from "./z0live-lanes";

const T = 1_800_000_000;
const row = (type: string, ts: number, data: Record<string, unknown>) => JSON.stringify({ type, ts, data });
const jsonl = (...rows: string[]) => rows.join("\n") + "\n";

describe("z0live lane events", () => {
  test("parses each lane record and ignores call events and junk", () => {
    expect(parseZ0LaneEvent({ type: "lane_attached", ts: T, data: { lane: "fast", name: "Fast", model: "gpt-5-mini" } })).toEqual({ type: "lane_attached", ts: T, lane: "fast", name: "Fast", model: "gpt-5-mini" });
    expect(parseZ0LaneEvent({ type: "lane_step", ts: "2027-01-15T08:00:00Z", data: { lane: "fast", step: "  Reading\nthe diff " } })).toEqual({ type: "lane_step", ts: Date.parse("2027-01-15T08:00:00Z") / 1000, lane: "fast", step: "Reading the diff" });
    expect(parseZ0LaneEvent({ type: "lane_handoff", ts: T, data: { lane: "fast", result: "Line one\nLine two" } })).toEqual({ type: "lane_handoff", ts: T, lane: "fast", summary: "Line one Line two", result: "Line one\nLine two" });
    expect(parseZ0LaneEvent({ type: "lane_error", ts: T, data: { lane: "large" } })).toEqual({ type: "lane_error", ts: T, lane: "large", message: "Lane failed" });
    expect(parseZ0LaneEvent({ type: "lane_detached", ts: T, data: { lane: "council" } })).toEqual({ type: "lane_detached", ts: T, lane: "council" });
    expect(parseZ0LaneEvent({ type: "floor", ts: T, data: { lane: "fast" } })).toBeUndefined();
    expect(parseZ0LaneEvent({ type: "lane_step", ts: T, data: { lane: "../etc", step: "x" } })).toBeUndefined();
    expect(parseZ0LaneEvent({ type: "lane_step", ts: T, data: { lane: "fast", step: "   " } })).toBeUndefined();
    expect(parseZ0LaneEvent({ type: "lane_step", ts: "never", data: { lane: "fast", step: "x" } })).toBeUndefined();
    expect(parseZ0LaneEvent({ type: "lane_handoff", ts: T, data: { lane: "fast" } })).toBeUndefined();
    expect(parseZ0LaneEvent({ type: "lane_bogus", ts: T, data: { lane: "fast" } })).toBeUndefined();
    expect(parseZ0LaneEvent("lane_step")).toBeUndefined();
  });

  test("a step keeps its start time while repeated, a new step restarts it, handoff clears it", () => {
    let lanes = applyZ0LaneEvent([], { type: "lane_attached", ts: T, lane: "fast", name: "Fast" });
    expect(lanes).toEqual([{ id: "fast", name: "Fast", status: "idle", since: T }]);
    lanes = applyZ0LaneEvent(lanes, { type: "lane_step", ts: T + 1, lane: "fast", step: "Reading" });
    lanes = applyZ0LaneEvent(lanes, { type: "lane_step", ts: T + 5, lane: "fast", step: "Reading" });
    expect(lanes[0]).toMatchObject({ status: "working", step: "Reading", since: T + 1 });
    lanes = applyZ0LaneEvent(lanes, { type: "lane_step", ts: T + 9, lane: "fast", step: "Writing" });
    expect(lanes[0]).toMatchObject({ status: "working", step: "Writing", since: T + 9 });
    lanes = applyZ0LaneEvent(lanes, { type: "lane_handoff", ts: T + 20, lane: "fast", summary: "Done", result: "Done in full" });
    expect(lanes[0]).toEqual({ id: "fast", name: "Fast", status: "idle", since: T + 20, handoff: { summary: "Done", result: "Done in full", at: T + 20 } });
    lanes = applyZ0LaneEvent(lanes, { type: "lane_error", ts: T + 30, lane: "fast", message: "Rate limited" });
    expect(lanes[0]).toMatchObject({ status: "error", step: "Rate limited", handoff: { summary: "Done" } });
  });

  test("unattached lanes attach on first step, detach removes them, the list is capped", () => {
    let lanes = applyZ0LaneEvent([], { type: "lane_step", ts: T, lane: "small", step: "Thinking" });
    expect(lanes).toEqual([{ id: "small", name: "small", status: "working", step: "Thinking", since: T }]);
    lanes = applyZ0LaneEvent(lanes, { type: "lane_detached", ts: T + 1, lane: "small" });
    expect(lanes).toEqual([]);
    for (let i = 0; i < Z0LANES_MAX + 3; i++) lanes = applyZ0LaneEvent(lanes, { type: "lane_attached", ts: T, lane: `l${i}` });
    expect(lanes).toHaveLength(Z0LANES_MAX);
  });
});

describe("z0live lanes from a session JSONL", () => {
  const session = jsonl(
    row("app_state", T, { source: "connected" }),
    row("lane_attached", T, { lane: "fast", name: "Fast", model: "gpt-5-mini" }),
    row("lane_attached", T, { lane: "large", name: "Large", model: "claude-opus" }),
    row("lane_step", T + 2, { lane: "fast", step: "Checking the PR" }),
    row("lane_step", T + 3, { lane: "large", step: "Planning" }),
    "{not json",
    row("lane_handoff", T + 8, { lane: "fast", summary: "PR 701 merged", result: "PR 701 merged into staging.\nChecks green." }),
    row("app_state", T + 20, { source: "active_session_heartbeat" }),
  );

  test("folds lanes in attachment order with the newest record time", () => {
    const state = parseZ0LiveLanes("sess_1", session, T + 25);
    expect(state.sessionId).toBe("sess_1");
    expect(state.updated).toBe(T + 20);
    expect(state.now).toBe(T + 25);
    expect(state.lanes.map(lane => [lane.id, lane.status, lane.step ?? null])).toEqual([["fast", "idle", null], ["large", "working", "Planning"]]);
    expect(state.lanes[0]?.handoff).toEqual({ summary: "PR 701 merged", result: "PR 701 merged into staging.\nChecks green.", at: T + 8 });
  });

  test("ended, stale, future and invalid sessions carry no lanes", () => {
    expect(parseZ0LiveLanes("sess_1", session + row("app_state", T + 21, { source: "session_end" }), T + 25).lanes).toEqual([]);
    expect(parseZ0LiveLanes("sess_1", session, T + 20 + Z0LANES_STALE_SECONDS + 1).lanes).toEqual([]);
    expect(parseZ0LiveLanes("sess_1", session, T + 20 + Z0LANES_STALE_SECONDS - 1).lanes).toHaveLength(2);
    expect(parseZ0LiveLanes("sess_1", session, T - Z0LANES_STALE_SECONDS - 1).lanes).toEqual([]);
    expect(parseZ0LiveLanes("../x", session, T + 25)).toEqual({ sessionId: "", lanes: [], updated: 0, now: T + 25 });
    expect(parseZ0LiveLanes("sess_1", "", T).lanes).toEqual([]);
  });
});

describe("app-side validation of the bridge payload", () => {
  test("round-trips a folded state and drops off-shape lanes", () => {
    const folded = parseZ0LiveLanes("sess_1", jsonl(row("lane_step", T, { lane: "fast", step: "Go" })), T + 1);
    expect(parseZ0LiveLanesState(JSON.parse(JSON.stringify(folded)))).toEqual(folded);
    const parsed = parseZ0LiveLanesState({ sessionId: "s", updated: T, now: T, lanes: [
      { id: "fast", status: "working", since: T, step: "x".repeat(500), name: "Fast" },
      { id: "fast", status: "idle", since: T },
      { id: "bad id", status: "idle", since: T },
      { id: "small", status: "sleeping", since: T },
      { id: "large", status: "idle", since: T, step: "stale step", handoff: { summary: "ok", at: T } },
    ] });
    expect(parsed.lanes.map(lane => lane.id)).toEqual(["fast", "large"]);
    expect(parsed.lanes[0]?.step).toHaveLength(Z0LANE_STEP_MAX);
    expect(parsed.lanes[0]?.name).toBe("Fast");
    expect(parsed.lanes[1]).toEqual({ id: "large", name: "large", status: "idle", since: T, handoff: { summary: "ok", result: "ok", at: T } });
  });

  test("anything not shaped like lanes is no lanes", () => {
    for (const bad of [null, "x", [], { lanes: [] }, { sessionId: "s", lanes: {}, updated: 0, now: 0 }, { sessionId: "../x", lanes: [], updated: 0, now: 0 }]) {
      expect(parseZ0LiveLanesState(bad)).toEqual({ sessionId: "", lanes: [], updated: 0, now: 0 });
    }
  });
});
