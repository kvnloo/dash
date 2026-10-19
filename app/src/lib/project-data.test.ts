import { describe, expect, test } from "bun:test";
import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import type { Conversation } from "../model";
import { projectsFromHosts } from "./project-data";

const now = 1_700_000_000_000;

function host(id: string, agents: AgentInfo[], self = true, online = true): HostInfo {
  return { id, name: id, hostname: id, agents, self, online };
}

function chat(id: string, cwd: string, targetHostId?: string): Conversation {
  return { id, harness: "codex", title: id, cwd, targetHostId, createdAt: now - 100, updatedAt: now - 10, messages: [] };
}

const codex: AgentInfo = {
  id: "codex:one", kind: "codex", name: "Codex", status: "running", cwd: "/work/weather", sessionId: "one",
};

describe("projects from actual bridge data", () => {
  test("no evidence produces no projects", () => {
    expect(projectsFromHosts({ hosts: [], conversations: [], now })).toEqual([]);
  });

  test("groups agents by normalized full directory rather than harness or directory basename", () => {
    const projects = projectsFromHosts({
      hosts: [host("laptop", [codex, { ...codex, id: "codex:two", cwd: "/work/weather/", sessionId: "two" }, { ...codex, id: "codex:three", cwd: "/other/weather", sessionId: "three" }])],
      conversations: [], now,
    });
    expect(projects).toHaveLength(2);
    const weather = projects.find((p) => p.cwd === "/work/weather");
    expect(weather?.agentRows.map((row) => row.id)).toEqual(["laptop:codex:one", "laptop:codex:two"]);
    expect(weather?.agents).toEqual(["codex"]);
    expect(weather?.status).toBe("active");
  });

  test("identical directories on different hosts remain separate", () => {
    const projects = projectsFromHosts({ hosts: [host("laptop", [codex]), host("remote", [codex], false)], conversations: [], now });
    expect(projects).toHaveLength(2);
    expect(new Set(projects.map((p) => p.id)).size).toBe(2);
    expect(projects.map((p) => p.hostId).sort()).toEqual(["laptop", "remote"]);
  });

  test("same-harness chats from another directory never become linked", () => {
    const projects = projectsFromHosts({ hosts: [host("laptop", [codex])], conversations: [chat("right", "/work/weather"), chat("wrong", "/work/other")], now });
    expect(projects.find((p) => p.cwd === "/work/weather")?.chatIds).toEqual(["right"]);
  });

  test("chat host identity wins over matching directory", () => {
    const projects = projectsFromHosts({ hosts: [host("laptop", [codex]), host("remote", [codex], false)], conversations: [chat("local", "/work/weather"), chat("remote-chat", "/work/weather", "remote")], now });
    expect(projects.find((p) => p.hostId === "laptop")?.chatIds).toEqual(["local"]);
    expect(projects.find((p) => p.hostId === "remote")?.chatIds).toEqual(["remote-chat"]);
  });

  test("offline hosts do not report running projects", () => {
    const project = projectsFromHosts({ hosts: [host("laptop", [codex], true, false)], conversations: [], now })[0];
    expect(project?.status).toBe("idle");
    expect(project?.agentRows[0]?.online).toBe(false);
  });

  test("does not invent a project for an agent without a directory", () => {
    expect(projectsFromHosts({ hosts: [host("laptop", [{ id: "codex", kind: "codex", name: "Codex", status: "available" }])], conversations: [], now })).toEqual([]);
  });

  test("the bridge directory gives installed agents an explicit start directory", () => {
    const project = projectsFromHosts({ hosts: [host("laptop", [{ id: "codex", kind: "codex", name: "Codex", status: "available" }])], conversations: [], cwd: "/work/bridge", now })[0];
    expect(project?.cwd).toBe("/work/bridge");
    expect(project?.agentRows[0]?.cwd).toBe("/work/bridge");
    expect(project?.status).toBe("idle");
  });

  test("saved chats keep real projects visible without a current roster", () => {
    const project = projectsFromHosts({ hosts: [], conversations: [chat("saved", "/work/weather")], now })[0];
    expect(project?.name).toBe("weather");
    expect(project?.chatIds).toEqual(["saved"]);
    expect(project?.agentRows).toEqual([]);
    expect(project?.status).toBe("idle");
    expect(project?.updatedAt).toBe(now - 10);
  });

  test("live profile rows preserve session and host identities", () => {
    const project = projectsFromHosts({ hosts: [host("laptop", [codex])], conversations: [], now })[0];
    expect(project?.agentRows[0]).toMatchObject({ id: "laptop:codex:one", harness: "codex", cwd: "/work/weather", sessionId: "one", targetHostId: "laptop" });
  });
});
