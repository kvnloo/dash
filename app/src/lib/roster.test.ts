import { describe, expect, test } from "bun:test";
import { canChatWithAgent, chatKind, emptyHostProfile, profileFromAgent, profilesFromHosts } from "./roster";
import type { HostInfo } from "../../../shared/protocol";

const mbp: HostInfo = {
  id: "mbp",
  name: "mbp",
  hostname: "mbp",
  online: true,
  self: true,
  address: "100.64.0.1",
  agents: [
    {
      id: "omp:dash",
      name: "OMP 1",
      kind: "omp",
      status: "running",
      detail: "/home/you/workspace/dash",
      cwd: "/home/you/workspace/dash",
    },
    {
      id: "omp:keyconf",
      name: "OMP 2",
      kind: "omp",
      status: "running",
      detail: "/home/you/workspace/keyconf.gen",
      cwd: "/home/you/workspace/keyconf.gen",
    },
  ],
};

const groot: HostInfo = {
  id: "0",
  name: "0",
  hostname: "groot",
  online: true,
  self: false,
  address: "100.64.0.2",
  agents: [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running", detail: "Mesh node" }],
};

const cursor: HostInfo = {
  id: "cursor",
  name: "cursor",
  hostname: "cursor",
  online: true,
  self: false,
  address: "100.64.0.4",
  agents: [],
};

describe("profilesFromHosts", () => {
  test("keeps both live OMP tabs and the MagicDNS 0 host", () => {
    const profiles = profilesFromHosts([mbp, groot]);
    expect(profiles.map((p) => p.id)).toEqual(["mbp:omp:dash", "mbp:omp:keyconf", "0:hermes"]);
    expect(profiles[0]?.cwd).toBe("/home/you/workspace/dash");
    expect(profiles[1]?.cwd).toBe("/home/you/workspace/keyconf.gen");
    expect(profiles[2]?.name).toBe("Hermes");
    expect(profiles[2]?.role).toBe("0 · groot");
  });

  test("profileFromAgent labels the host and copies cwd", () => {
    const profile = profileFromAgent(mbp, mbp.agents[0]!);
    expect(profile).toMatchObject({
      id: "mbp:omp:dash",
      harness: "omp",
      name: "OMP 1",
      role: "mbp",
      online: true,
      cwd: "/home/you/workspace/dash",
    });
  });

  test("empty cursor host is a host row, not a fake omp or hermes bot", () => {
    const profiles = profilesFromHosts([cursor]);
    expect(profiles).toEqual([
      {
        id: "host:cursor",
        harness: "host",
        name: "Online",
        role: "No Dash agents listed",
        description: "On the tailnet",
        online: true,
      },
    ]);
    expect(emptyHostProfile(cursor).harness).toBe("host");
  });

  test("maps A2A rows onto hermes or grok for chat", () => {
    expect(chatKind({ id: "a2a:hermes", kind: "a2a" })).toBe("hermes");
    expect(chatKind({ id: "a2a:connect-all", kind: "a2a" })).toBe("hermes");
    expect(chatKind({ id: "a2a:grok-bot", kind: "a2a" })).toBe("grok");
    expect(chatKind({ id: "hermes:default", kind: "hermes" })).toBe("hermes");
    expect(chatKind({ id: "grok-bot", kind: "grok" })).toBe("grok");
    const kinds = new Set(["hermes", "grok", "omp"]);
    expect(canChatWithAgent({ id: "a2a:hermes", kind: "a2a" }, { self: true, availableKinds: kinds })).toBe(true);
    expect(canChatWithAgent({ id: "a2a:grok-bot", kind: "a2a" }, { self: true, availableKinds: kinds })).toBe(true);
    expect(canChatWithAgent({ id: "hermes:default", kind: "hermes" }, { self: true, availableKinds: kinds })).toBe(true);
    expect(canChatWithAgent({ id: "a2a:hermes", kind: "a2a" }, { self: false, availableKinds: kinds })).toBe(false);
    expect(canChatWithAgent({ id: "a2a:hermes", kind: "a2a" }, { self: true, availableKinds: new Set(["omp"]) })).toBe(false);
  });

  test("profileFromAgent uses the chat harness, not a2a", () => {
    const profile = profileFromAgent(mbp, {
      id: "a2a:hermes",
      name: "Hermes",
      kind: "a2a",
      status: "running",
      detail: "A2A",
    });
    expect(profile.harness).toBe("hermes");
  });
});
