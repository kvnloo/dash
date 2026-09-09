import { describe, expect, test } from "bun:test";
import { profileFromAgent, profilesFromHosts } from "./roster";
import type { HostInfo } from "../../../shared/protocol";

const mbp: HostInfo = {
  id: "mbp",
  name: "mbp",
  hostname: "mbp",
  online: true,
  self: true,
  address: "100.78.215.21",
  agents: [
    {
      id: "omp:dash",
      name: "OMP 1",
      kind: "omp",
      status: "running",
      detail: "/home/kvn/workspace/dash",
      cwd: "/home/kvn/workspace/dash",
    },
    {
      id: "omp:keyconf",
      name: "OMP 2",
      kind: "omp",
      status: "running",
      detail: "/home/kvn/workspace/keyconf.gen",
      cwd: "/home/kvn/workspace/keyconf.gen",
    },
  ],
};

const groot: HostInfo = {
  id: "0",
  name: "0",
  hostname: "groot",
  online: true,
  self: false,
  address: "100.113.138.100",
  agents: [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running", detail: "Mesh node" }],
};

describe("profilesFromHosts", () => {
  test("keeps both live OMP tabs and the MagicDNS 0 host", () => {
    const profiles = profilesFromHosts([mbp, groot]);
    expect(profiles.map((p) => p.id)).toEqual(["mbp:omp:dash", "mbp:omp:keyconf", "0:hermes"]);
    expect(profiles[0]?.cwd).toBe("/home/kvn/workspace/dash");
    expect(profiles[1]?.cwd).toBe("/home/kvn/workspace/keyconf.gen");
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
      cwd: "/home/kvn/workspace/dash",
    });
  });
});
