import { expect, test } from "bun:test";
import type { HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { orchestraMotionFixture } from "../debug/orchestra-fixture";
import { matchesFilter, orchestraMap, projectMap } from "./orchestra-map";

const hosts: HostInfo[] = [{ id: "0", name: "0", hostname: "groot", online: true, self: true, agents: [
  { id: "a", name: "Design", kind: "hermes", status: "running", sessionId: "s", cwd: "/work/dash" },
  { id: "b", name: "Saved", kind: "hermes", status: "available", sessionId: "saved", cwd: "/work/dash" },
  { id: "launcher", name: "Installed", kind: "codex", status: "available" },
] }];
function chat(state: "streaming" | "error" | "interrupted", status?: string): Conversation {
  return { id: "c", harness: "hermes", title: "Design", createdAt: 0, updatedAt: 0, targetHostId: "0", sessionId: "s", messages: [{ id: "m", role: "assistant", text: "", at: 0, state, status, turnId: "t", seq: 0 }] };
}

test("roster maps kinds independently of unknown providers and does not invent relationships", () => {
  const graph = orchestraMap(hosts, []);
  expect(graph.nodes.map(n => n.kind)).toEqual(["host", "chat", "repo", "chat"]);
  expect(graph.nodes[0]?.label).toBe("groot");
  expect(graph.nodes.filter(n => n.kind === "repo")).toHaveLength(1);
  expect(graph.nodes.find(n => n.label === "Installed")).toBeUndefined();
  expect(new Set(graph.edges.map(e => e.relation))).toEqual(new Set(["hosted", "workspace"]));
  expect(graph.edges.every(e => !e.active)).toBe(true);
  expect(orchestraMap([{ ...hosts[0]!, online: false }], []).nodes.find(n => n.kind === "host")?.online).toBe(false);
});

test("thinking, needs-you and failure states come from reported turn state", () => {
  expect(orchestraMap(hosts, [chat("streaming", "Thinking")]).nodes.find(n => n.label === "Design")).toMatchObject({ state: "live", thinking: { phase: "thinking" } });
  expect(orchestraMap(hosts, [chat("streaming", "Waiting for approval")]).nodes.find(n => n.label === "Design")?.state).toBe("needs-you");
  expect(orchestraMap(hosts, [chat("error")]).nodes.find(n => n.label === "Design")?.state).toBe("failing");
  expect(orchestraMap(hosts, [chat("interrupted")]).nodes.find(n => n.label === "Design")?.state).toBe("failing");
});

test("legend tap highlights without removing; hold filters; relation filters include endpoints", () => {
  const graph = orchestraMotionFixture();
  expect(graph.nodes).toHaveLength(13);
  expect(projectMap(graph, { kind: "chat", only: false }, null, false).nodes).toHaveLength(13);
  expect(graph.nodes.filter(n => matchesFilter(n, graph, { kind: "chat", only: false }))).toHaveLength(9);
  expect(projectMap(graph, { kind: "subagent", only: true }, null, false).nodes).toHaveLength(2);
  const delegated = projectMap(graph, { kind: "delegated", only: true }, null, false);
  expect(delegated.nodes).toHaveLength(3);
  expect(delegated.edges.map(e => e.relation)).toEqual(["delegated", "delegated"]);
  expect(projectMap(graph, null, null, false)).toEqual(graph);
  expect(projectMap(graph, null, "fixture:repo", true).nodes).toHaveLength(2);
  const filtered = projectMap(graph, { kind: "host", only: true }, null, false);
  expect(filtered.nodes).toHaveLength(1);
  expect(filtered.edges).toHaveLength(0);
});
