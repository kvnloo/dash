import { expect, test } from "bun:test";
import { createOrchestraController, orchestraControlRows, ORCHESTRA_LEGEND } from "./orchestra-controls";
import { matchesFilter, projectMap, type OrchestraMap } from "./orchestra-map";
import { viewGraph } from "./orchestra-views";

const graph: OrchestraMap = {
  nodes: [
    { id: "host", label: "Groot", kind: "host", state: "idle", thinking: { phase: "idle" } },
    { id: "chat", label: "Hermes", kind: "chat", state: "live", thinking: { phase: "thinking" } },
    { id: "child", label: "Worker", kind: "subagent", state: "idle", thinking: { phase: "idle" } },
    { id: "repo", label: "Dash", kind: "repo", state: "idle", thinking: { phase: "idle" } },
  ],
  edges: [
    { id: "hosted", from: "host", to: "chat", relation: "hosted", active: false },
    { id: "delegated", from: "chat", to: "child", relation: "delegated", active: true },
    { id: "touched", from: "chat", to: "repo", relation: "touched", active: true },
  ],
};

test("same controller preserves selection, highlight toggle, only, scope and details close", () => {
  const c = createOrchestraController(graph.nodes);
  c.focus("chat"); c.scope(true); c.highlight("repo");
  expect(c.state.get()).toMatchObject({ focusId: "chat", focusOnly: true, filter: { kind: "repo", only: false } });
  expect(matchesFilter(graph.nodes[1]!, graph, c.state.get().filter)).toBe(false);
  c.highlight("repo"); expect(c.state.get().filter).toBeNull();
  c.only("delegated");
  expect(c.state.get()).toMatchObject({ focusId: "chat", focusOnly: false, filter: { kind: "delegated", only: true } });
  expect(projectMap(graph, c.state.get().filter, "chat", false).nodes.map(n => n.id)).toEqual(["chat", "child"]);
  c.focus(null); // closing details does not clear the active filter
  expect(c.state.get().filter?.only).toBe(true);
  c.focusHost("host");
  expect(c.state.get()).toMatchObject({ focusId: "host", focusOnly: true });
  c.setFilter(null);
  expect(projectMap(viewGraph(graph, "fleet"), null, "host", true).nodes.map(n => n.id)).toEqual(["host", "chat"]);
});

test("each real view switch, including reselect, resets focus/filter/scope and preserves explicit choice", () => {
  const c = createOrchestraController(graph.nodes);
  for (const view of ["fleet", "lineage", "work", "triage", "triage"] as const) {
    c.focus("chat"); c.only("repo"); c.scope(true); c.switchView(view);
    expect(c.state.get()).toMatchObject({ view, chosen: true, filter: null, focusId: null, focusOnly: false });
  }
  expect(c.state.get().viewRevision).toBe(5);
  c.syncNodes([]);
  expect(c.state.get().view).toBe("triage");
});

test("unchosen default follows evidence; reset retains view and explicit choice", () => {
  const c = createOrchestraController(graph.nodes);
  expect(c.state.get().view).toBe("fleet");
  c.syncNodes([{ ...graph.nodes[1]!, state: "needs-you" }]);
  expect(c.state.get().view).toBe("triage");
  c.syncNodes(graph.nodes); expect(c.state.get().view).toBe("fleet");
  c.switchView("lineage"); c.focus("child"); c.only("subagent"); c.scope(true); c.reset();
  expect(c.state.get()).toMatchObject({ view: "lineage", chosen: true, focusId: null, filter: null, focusOnly: false });
  c.syncNodes([]); expect(c.state.get().view).toBe("lineage");
});

test("registered rows invoke the actual controller and switchView reset semantics", () => {
  const c = createOrchestraController(graph.nodes);
  function row(id: string) {
    const found = orchestraControlRows(c, graph).find(r => r.id === id);
    if (!found) throw new Error(`Missing ${id}`);
    return found;
  }
  row("orchestra-selection").select(2);
  row("orchestra-focus").select(1);
  row("orchestra-filter").select(ORCHESTRA_LEGEND.indexOf("repo") + 1);
  expect(c.state.get()).toMatchObject({ focusId: "chat", focusOnly: true, filter: { kind: "repo", only: false } });
  row("orchestra-filter-scope").select(1);
  expect(c.state.get()).toMatchObject({ focusId: "chat", focusOnly: false, filter: { kind: "repo", only: true } });
  row("orchestra-filter-scope").select(0);
  expect(c.state.get().filter).toEqual({ kind: "repo", only: false });
  row("orchestra-view").select(2);
  expect(c.state.get()).toMatchObject({ view: "work", chosen: true, focusId: null, focusOnly: false, filter: null });
  expect(orchestraControlRows(c, graph).some(r => r.id === "orchestra-filter-scope")).toBe(false);
  row("orchestra-view").select(99);
  expect(c.state.get().view).toBe("work");
  row("orchestra-selection").select(3); row("orchestra-filter").select(1); row("orchestra-focus").select(1);
  row("orchestra-reset").run?.();
  expect(c.state.get()).toMatchObject({ view: "work", chosen: true, filter: null, focusId: null, focusOnly: false });
  expect(orchestraControlRows(c, graph).map(r => [r.id, r.index])).toEqual([["orchestra-view", 2], ["orchestra-focus", 0], ["orchestra-filter", 0], ["orchestra-selection", 0], ["orchestra-reset", 0]]);
});
