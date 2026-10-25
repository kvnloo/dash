import { describe, expect, test } from "bun:test";
import { parseHosts, type AgentInfo, type HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { matchesFilter, orchestraMap, projectMap, type MapNode, type OrchestraMap } from "./orchestra-map";

function agent(id: string, sessionId?: string, fields: Partial<AgentInfo> = {}): AgentInfo {
  return { id, name: id, kind: "hermes", status: "available", ...(sessionId === undefined ? {} : { sessionId }), ...fields };
}

function host(id: string, self: boolean, agents: AgentInfo[]): HostInfo {
  return { id, name: id, hostname: "machine-" + id, online: true, self, agents };
}

function conversation(
  id: string,
  sessionId: string,
  targetHostId: string | undefined,
  harness: string,
  state: "streaming" | "error",
  status?: string,
): Conversation {
  return {
    id, title: id, harness, sessionId, ...(targetHostId === undefined ? {} : { targetHostId }),
    createdAt: 1, updatedAt: 2,
    messages: [{ id: "reply:" + id, role: "assistant", text: "", at: 2, state, status, turnId: "turn:" + id, seq: 0 }],
  };
}

function node(id: string, kind: MapNode["kind"], hostId: string): MapNode {
  return { id, kind, hostId, label: id, state: "idle", thinking: { phase: "idle" } };
}

function evidenceGraph() {
  const hostNode = node("host:h%2F1", "host", "host:h%2F1");
  const chat = {
    ...node("chat:opaque:%2F", "chat", hostNode.id),
    sessionId: "session:literal/%2F", profileId: "profile:%25", harness: "hermes",
  };
  const child = {
    ...node("subagent:opaque:%2F", "subagent", hostNode.id),
    sessionId: "child-session:#184", parentId: chat.id, optionId: "option:/%25",
  };
  const repo = { ...node("repo:opaque:%2F", "repo", hostNode.id), path: "/work/dash?query=1" };
  const orphan = node("chat:opaque:%2F-extra", "chat", hostNode.id);
  const hosted = { id: "edge:hosted/%2F", from: hostNode.id, to: chat.id, relation: "hosted", active: false } satisfies OrchestraMap["edges"][number];
  const delegated = { id: "edge:delegated/%2F", from: chat.id, to: child.id, relation: "delegated", active: true, provenance: ["exact:manifest#184"] } satisfies OrchestraMap["edges"][number];
  const touched = { id: "edge:touched/%2F", from: chat.id, to: repo.id, relation: "touched", active: false } satisfies OrchestraMap["edges"][number];
  const graph: OrchestraMap = {
    nodes: [hostNode, chat, child, repo, orphan],
    edges: [hosted, delegated, touched],
  };
  return { graph, hostNode, chat, child, repo, orphan, hosted, delegated, touched };
}

describe("Orchestra projection identity boundaries", () => {
  test("identical opaque session ids cannot borrow state across target hosts or harnesses", () => {
    const sessionId = "session:opaque/%2F#184";
    const local = host("local:#184", true, [agent("twin:/%", sessionId)]);
    const remote = host("remote:%2F", false, [agent("twin:/%", sessionId)]);
    const conversations = [
      conversation("wrong-harness", sessionId, remote.id, "codex", "error"),
      conversation("wrong-host", sessionId, "absent:#184", "hermes", "error"),
      conversation("remote-waiting", sessionId, remote.id, "hermes", "streaming", "Waiting for approval"),
    ];
    const graph = orchestraMap([local, remote], conversations);
    expect(graph.nodes.find(n => n.id === "chat:local:#184:twin:/%")).toMatchObject({ state: "idle", hostId: "host:local:#184" });
    expect(graph.nodes.find(n => n.id === "chat:remote:%2F:twin:/%")).toMatchObject({
      state: "needs-you", hostId: "host:remote:%2F", thinking: { phase: "waiting-approval" },
    });
    expect(local.agents[0]?.sessionId).toBe(sessionId);
    expect(remote.agents[0]?.sessionId).toBe(sessionId);
    expect(conversations[2]?.targetHostId).toBe(remote.id);
  });

  test("missing targetHostId only correlates an unscoped session with the self host", () => {
    const id = "SID:unscoped/#184";
    const local = host("self:#184", true, [agent("one", id)]);
    const remote = host("remote:#184", false, [agent("two", id)]);
    const graph = orchestraMap([local, remote], [conversation("unscoped", id, undefined, "hermes", "error")]);
    expect(graph.nodes.find(n => n.id === "chat:self:#184:one")?.state).toBe("failing");
    expect(graph.nodes.find(n => n.id === "chat:remote:#184:two")?.state).toBe("idle");
  });

  test("only real session roster entries generate chats, and cwd never authorizes delegation", () => {
    const path = "/work/%2F/../Dash ";
    const first = host("h:/1", true, [
      agent("first:#", "session:one", { cwd: path }),
      agent("second:#", "session:two", { cwd: path }),
      agent("launcher"),
      agent("empty-session", ""),
    ]);
    const second = host("h:/2", false, [agent("first:#", "session:three", { cwd: path })]);
    const before = JSON.stringify([first, second]);
    const graph = orchestraMap([first, second], []);
    expect(graph.nodes.map(n => n.id)).toEqual([
      "host:h:/1", "chat:h:/1:first:#", "repo:h:/1:" + path,
      "chat:h:/1:second:#", "host:h:/2", "chat:h:/2:first:#", "repo:h:/2:" + path,
    ]);
    expect(graph.edges.map(e => e.relation)).toEqual([
      "hosted", "workspace", "hosted", "workspace", "hosted", "workspace",
    ]);
    expect(graph.edges.every(e => !e.active)).toBe(true);
    expect(graph.nodes.some(n => n.kind === "subagent")).toBe(false);
    expect(graph.edges.every(e => graph.nodes.some(n => n.id === e.from) && graph.nodes.some(n => n.id === e.to))).toBe(true);
    expect(JSON.stringify([first, second])).toBe(before);
  });

  test("delegation filter carries exact chat/subagent metadata, options and edge references", () => {
    const { graph, chat, child, delegated } = evidenceGraph();
    const projection = projectMap(graph, { kind: "delegated", only: true }, null, false);
    expect(projection.nodes).toEqual([chat, child]);
    expect(projection.edges).toEqual([delegated]);
    expect(projection.nodes[0]).toBe(chat);
    expect(projection.nodes[1]).toBe(child);
    expect(projection.edges[0]).toBe(delegated);
    expect(chat.sessionId).toBe("session:literal/%2F");
    expect(chat.profileId).toBe("profile:%25");
    expect(child.sessionId).toBe("child-session:#184");
    expect(child.parentId).toBe(chat.id);
    expect(child.optionId).toBe("option:/%25");
    expect(delegated.provenance).toEqual(["exact:manifest#184"]);
  });

  test("kind and relation matches use exact kinds and actual endpoints, not prefixes or paths", () => {
    const { graph, hostNode, chat, child, repo, orphan, delegated } = evidenceGraph();
    expect(matchesFilter(child, graph, { kind: "subagent", only: true })).toBe(true);
    expect(matchesFilter(chat, graph, { kind: "host", only: true })).toBe(false);
    expect(matchesFilter(chat, graph, { kind: "delegated", only: true })).toBe(true);
    expect(matchesFilter(repo, graph, { kind: "touched", only: true })).toBe(true);
    expect(matchesFilter(orphan, graph, { kind: "delegated", only: true })).toBe(false);
    expect(matchesFilter(hostNode, graph, { kind: "delegated", only: true })).toBe(false);
    expect(projectMap(graph, { kind: "subagent", only: true }, null, false)).toEqual({ nodes: [child], edges: [] });
    expect(projectMap(graph, { kind: "delegated", only: true }, null, false).edges).toEqual([delegated]);
    expect(projectMap(graph, { kind: "host", only: true }, null, false)).toEqual({ nodes: [hostNode], edges: [] });
    expect(projectMap(graph, { kind: "delegated", only: false }, null, false)).toEqual(graph);
    expect(projectMap(graph, null, null, false)).toEqual(graph);
  });

  test("focus is strictly one hop by exact id; filters intersect instead of restoring excluded nodes", () => {
    const { graph, chat, child, repo, delegated } = evidenceGraph();
    expect(projectMap(graph, null, child.id, true)).toEqual({ nodes: [chat, child], edges: [delegated] });
    expect(projectMap(graph, null, child.id + "-missing", true)).toEqual({ nodes: [], edges: [] });
    expect(projectMap(graph, { kind: "repo", only: true }, chat.id, true)).toEqual({ nodes: [repo], edges: [] });
    expect(projectMap(graph, { kind: "repo", only: true }, child.id, true)).toEqual({ nodes: [], edges: [] });
    expect(projectMap(graph, null, "", true)).toEqual(graph);
    expect(projectMap(graph, null, null, true)).toEqual(graph);
  });

  test("untrusted host payloads must pass the protocol gate before reaching a map", () => {
    const goodAgent = agent("a", "session");
    const goodHost = host("h:#184", true, [goodAgent]);
    const malformed: unknown[] = [
      null, {}, [null],
      [{ ...goodHost, agents: null }],
      [{ ...goodHost, agents: [null] }],
      [{ ...goodHost, agents: [ { ...goodAgent, sessionId: null } ] }],
      [{ ...goodHost, agents: [ { ...goodAgent, sessionId: [] } ] }],
      [{ ...goodHost, agents: [ { ...goodAgent, sessionId: 42 } ] }],
      [{ ...goodHost, agents: [ { ...goodAgent, kind: ["hermes"] } ] }],
      [{ ...goodHost, online: "true" }],
    ];
    for (const raw of malformed) {
      const parsed = parseHosts(raw);
      expect(parsed).toBeUndefined();
      expect(orchestraMap(parsed ?? [], [])).toEqual({ nodes: [], edges: [] });
    }
    expect(orchestraMap(parseHosts([]) ?? [], [])).toEqual({ nodes: [], edges: [] });
    const trusted = parseHosts([goodHost]);
    expect(orchestraMap(trusted ?? [], []).nodes.map(n => n.id)).toEqual(["host:h:#184", "chat:h:#184:a"]);
  });

  test("invalid filter kinds never fabricate nodes or edges, and absent filters leave the map intact", () => {
    const { graph, chat } = evidenceGraph();
    const invalidKinds: unknown[] = [null, 1, ["delegated"], { value: "delegated" }, "not-a-map-relation"];
    for (const kind of invalidKinds) {
      const invalidFilter = { kind, only: true };
      const matches: unknown = Reflect.apply(matchesFilter, undefined, [chat, graph, invalidFilter]);
      const projection: unknown = Reflect.apply(projectMap, undefined, [graph, invalidFilter, null, false]);
      expect(matches).toBe(false);
      expect(projection).toEqual({ nodes: [], edges: [] });
    }
    const arrayFilter: unknown = [];
    const arrayMatch: unknown = Reflect.apply(matchesFilter, undefined, [chat, graph, arrayFilter]);
    const arrayProjection: unknown = Reflect.apply(projectMap, undefined, [graph, arrayFilter, null, false]);
    const missingFilter: unknown = Reflect.apply(projectMap, undefined, [graph, undefined, null, false]);
    expect(arrayMatch).toBe(false);
    expect(arrayProjection).toEqual(graph);
    expect(missingFilter).toEqual(graph);
  });

  test("wrong-type focus ids cannot coincide with exact string ids", () => {
    const { graph, chat } = evidenceGraph();
    const invalidFocusIds: unknown[] = [[], [chat.id], { id: chat.id }, 17];
    for (const focusId of invalidFocusIds) {
      const projection: unknown = Reflect.apply(projectMap, undefined, [graph, null, focusId, true]);
      expect(projection).toEqual({ nodes: [], edges: [] });
    }
  });

  test("repeated projections preserve source objects without mutations or shared mocks", () => {
    const { graph, chat, child, delegated } = evidenceGraph();
    const before = JSON.stringify(graph);
    Object.freeze(graph.nodes);
    Object.freeze(graph.edges);
    const a = projectMap(graph, { kind: "delegated", only: true }, chat.id, true);
    const b = projectMap(graph, { kind: "delegated", only: true }, chat.id, true);
    expect(a).toEqual(b);
    expect(a.nodes).toEqual([chat, child]);
    expect(a.edges).toEqual([delegated]);
    expect(JSON.stringify(graph)).toBe(before);
    expect(projectMap({ nodes: [], edges: [] }, { kind: "touched", only: true }, "unknown", true))
      .toEqual({ nodes: [], edges: [] });
  });
});
