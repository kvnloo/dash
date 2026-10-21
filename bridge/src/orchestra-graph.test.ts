import { expect, test } from "bun:test";
import fixture from "./fixtures/orchestra-sanitised.json";
import { buildOrchestra, toolPaths, type GraphSession } from "./orchestra-graph";
import { parseOrchestra } from "../../shared/orchestra";
import { createOrchestraHttpHandler } from "./orchestra-http";
const now = 1792600000000;
const hosts = [{ id: "groot", name: "groot", hostname: "groot", self: true, online: true, agents: [] }];
function sessions(): GraphSession[] { return fixture.sessions.map(row => ({ id: row.id, title: row.title, parent: row.source === "subagent" ? row.parent_session_id ?? undefined : undefined, delegated: row.source === "subagent", hostId: "groot", state: "live", reason: "Observed live phase", repo: "/work/dash", touched: row.source === "subagent" ? ["/work/dash"] : [], updatedAt: now, provenance: ["sanitised real state.db sample"] })); }
test("real sanitised parent_session_id sample produces gold delegation, hosted and both repo relations", () => {
  const graph = buildOrchestra({ hosts, sessions: sessions(), now });
  expect(graph.edges.find(e => e.relation === "delegated")).toMatchObject({ from: "parent", to: "worker", active: true });
  expect(graph.nodes.find(n => n.id === "worker")?.kind).toBe("subagent");
  expect(graph.edges.filter(e => e.relation === "hosted").every(e => e.active)).toBe(true);
  expect(graph.edges.filter(e => e.relation === "workspace").every(e => e.active)).toBe(true);
  expect(new Set(graph.edges.map(e => e.relation))).toEqual(new Set(["hosted", "delegated", "workspace", "touched"]));
  expect(parseOrchestra(graph)?.nodes.length).toBe(graph.nodes.length);
});
test("tool calls yield paths, never contents; malformed/irrelevant calls yield no evidence", () => {
  expect(toolPaths(fixture.tool_calls)).toEqual(["/work/dash/src/example.ts"]);
  expect(toolPaths(JSON.stringify(fixture.tool_calls))).toEqual(["/work/dash/src/example.ts"]);
  expect(toolPaths("broken")).toEqual([]);
  expect(toolPaths([{ function: { name: "terminal", arguments: { workdir: "/work/dash", command: "git status --short; bun test" } } }])).toEqual([]);
  expect(toolPaths([{ function: { name: "read_file", arguments: { path: "/secret" } } }])).toEqual([]);
  expect(toolPaths([{ function: { name: "patch", arguments: { path: "src/a.ts" } } }], "/work/dash")).toEqual(["/work/dash/src/a.ts"]);
  expect(toolPaths([{ function: { name: "terminal", arguments: { workdir: "/work/dash", command: "git apply change.patch" } } }])).toEqual(["/work/dash"]);
});
test("W1 counts unique live owners per worktree, not duplicate relations or common repository", () => {
  const graph = buildOrchestra({ hosts, sessions: sessions(), now, repos: [{ path: "/work/dash", branch: "feature", dirty: 3 }] });
  expect(graph.nodes.find(n => n.kind === "repo")).toMatchObject({ collision: true, state: "failing", branch: "feature", dirty: 3, reason: "W1 collision · 2 live owners on one worktree" });
  const one = sessions(); one[0]!.state = "done";
  expect(buildOrchestra({ hosts, sessions: one, now }).nodes.find(n => n.kind === "repo")?.collision).toBeUndefined();
  const isolated = sessions(); isolated[0]!.repo = "/work/other-worktree";
  expect(buildOrchestra({ hosts, sessions: isolated, now }).nodes.filter(n => n.collision)).toHaveLength(0);
});
test("24h window, deduplicated edges, parent retention, cap and dangling edge safety", () => {
  const rows = sessions(); rows[0]!.updatedAt = now - 2 * 86400000;
  const graph = buildOrchestra({ hosts, sessions: rows, now });
  expect(graph.nodes.some(n => n.id === "parent")).toBe(true);
  const many = Array.from({ length: 200 }, (_, i) => ({ ...rows[1]!, id: `worker-${i}` }));
  const capped = buildOrchestra({ hosts, sessions: many, now });
  expect(capped.nodes).toHaveLength(150);
  expect(capped.nodes.find(n => n.grouped)?.label).toMatch(/^\+\d+ more$/);
  expect(capped.edges.every(e => capped.nodes.some(n => n.id === e.from) && capped.nodes.some(n => n.id === e.to))).toBe(true);
  expect(new Set(graph.edges.map(e => e.id)).size).toBe(graph.edges.length);
});
test("needs-Kevin reason and recommended action survive projection; offline hosts remain", () => {
  const graph = buildOrchestra({ hosts: [{ ...hosts[0]!, online: false }], sessions: [], now, needs: [{ id: "decision", worker: "lost-worker", goal: "Recover work", why: "No worktree", recommended_action: "abandon", options: ["abandon"], phase: "Overdue", evidence_path: "/evidence" }] });
  expect(graph.nodes.find(n => n.kind === "host")?.online).toBe(false);
  expect(graph.nodes.find(n => n.state === "needs-you")).toMatchObject({ reason: "No worktree", action: "abandon" });
});
test("graph endpoint authenticates before reading; GET only and unrelated paths fall through", async () => {
  const denied = createOrchestraHttpHandler({ authorize: async () => false, roster: async () => { throw Error("must not read"); } });
  expect((await denied(new Request("http://local/orchestra/graph")))?.status).toBe(401);
  expect(await denied(new Request("http://local/other"))).toBeNull();
  const allowed = createOrchestraHttpHandler({ authorize: async () => true, roster: async () => hosts });
  expect((await allowed(new Request("http://local/orchestra/graph", { method: "POST" })))?.status).toBe(405);
});
test("wire parser rejects unknown types, duplicate IDs and dangling edges", () => {
  const graph = buildOrchestra({ hosts, sessions: sessions(), now });
  expect(parseOrchestra({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] })).toBeNull();
  expect(parseOrchestra({ ...graph, nodes: [{ ...graph.nodes[0], kind: "fake" }] })).toBeNull();
  expect(parseOrchestra({ ...graph, edges: [{ id: "bad", from: "missing", to: "missing", relation: "delegated", active: true }] })).toBeNull();
});
