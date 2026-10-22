import { expect, test } from "bun:test";
import { defaultView, ORCHESTRA_VIEWS, TRIAGE_LANES, viewGraph } from "./orchestra-views";
import { orchestraMotionFixture } from "../debug/orchestra-fixture";
test("each question selects different evidence, not a geometric re-layout", () => {
  const graph = orchestraMotionFixture();
  expect(ORCHESTRA_VIEWS.map(v => v.title)).toEqual(["Fleet", "Lineage", "Work", "Triage"]);
  expect(viewGraph(graph, "fleet").nodes.some(n => n.kind === "host")).toBe(true);
  expect(viewGraph(graph, "fleet").edges.every(e => e.relation === "hosted")).toBe(true);
  expect(viewGraph(graph, "lineage").edges.map(e => e.relation)).toEqual(["delegated", "delegated"]);
  expect(viewGraph(graph, "work").edges.every(e => e.relation === "touched" || e.relation === "workspace")).toBe(true);
  expect(viewGraph(graph, "triage").edges).toEqual([]);
  expect(viewGraph(graph, "triage").nodes.every(n => n.kind === "chat" || n.kind === "subagent")).toBe(true);
});
test("default follows needs-you and triage priority is intentional", () => {
  expect(defaultView(orchestraMotionFixture().nodes)).toBe("triage");
  expect(defaultView([])).toBe("fleet");
  expect(TRIAGE_LANES.map(l => l.state)).toEqual(["needs-you", "failing", "live", "done", "idle"]);
});
