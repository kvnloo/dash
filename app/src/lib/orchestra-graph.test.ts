import { describe, expect, test } from "bun:test";
import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import { graphHosts } from "./orchestra-graph";

const agent = (id: string, at: number, sessionId?: string): AgentInfo => ({ id, name: id, kind: "hermes", status: "available", lastActivityAt: at, ...(sessionId ? { sessionId } : {}) });
const host = (id: string, online: boolean, agents: AgentInfo[]): HostInfo => ({ id, name: id, hostname: id, online, self: id === "0", agents });

describe("graphHosts", () => {
  test("keeps online hosts with real sessions, newest first, capped", () => {
    const hosts = [host("0", true, [agent("harness:omp", 9), agent("a", 1, "a"), agent("b", 3, "b"), agent("c", 2, "c")]), host("cos", false, [agent("x", 5, "x")]), host("mbp", true, [])];
    const out = graphHosts(hosts, 2);
    expect(out.map(h => h.id)).toEqual(["0"]);
    expect(out[0]!.agents.map(a => a.id)).toEqual(["b", "c"]);
  });
  test("does not mutate the roster it was given", () => {
    const hosts = [host("0", true, [agent("a", 1, "a"), agent("b", 2, "b")])];
    graphHosts(hosts, 1);
    expect(hosts[0]!.agents.map(a => a.id)).toEqual(["a", "b"]);
  });
});
