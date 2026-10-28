import { describe, expect, test } from "bun:test";
import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import { adoptableSessions } from "./remote-host-sessions";

function agent(
  id: string,
  kind: string,
  sessionId?: string,
  overrides: Partial<AgentInfo> = {},
): AgentInfo {
  return {
    id,
    name: id,
    kind,
    status: "running",
    ...(sessionId === undefined ? {} : { sessionId }),
    ...overrides,
  };
}

function host(
  id: string,
  self: boolean,
  agents: AgentInfo[],
  overrides: Partial<HostInfo> = {},
): HostInfo {
  return {
    id,
    name: id,
    hostname: id,
    online: true,
    self,
    agents,
    ...overrides,
  };
}

describe("adoptableSessions", () => {
  test("includeRemote=false preserves exactly the legacy self-host eligibility", () => {
    const local = host("local", true, [
      agent("running", "omp", "running-id"),
      agent("installed", "codex", "saved-id", { status: "available" }),
      agent("offline", "claude", "offline-id", { status: "offline" }),
      agent("unknown-kind", "cursor-cloud", "unknown-id"),
      agent("no-session", "grok"),
      agent("empty-session", "hermes", ""),
      // The old self-host rule does not filter hostId; retain that parity.
      agent("self-mismatched", "hermes", "local-id", { hostId: "different-host" }),
    ]);
    const remote = host("remote", false, [agent("remote-row", "omp", "remote-id")]);
    const rows = adoptableSessions([remote, local], { includeRemote: false });

    expect(rows.map(({ key }) => key)).toEqual([
      "live:codex:saved-id",
      "live:hermes:local-id",
      "live:omp:running-id",
    ]);
    expect(rows.every(({ host: selected }) => selected === local)).toBe(true);
    expect(adoptableSessions([remote], { includeRemote: false })).toEqual([]);
    expect(adoptableSessions([remote, { ...local, online: false }], { includeRemote: false })).toEqual([]);
  });

  test("identical harness and session IDs on three hosts never collide", () => {
    const local = host("paired", true, [agent("local-omp", "omp", "same-session")], { name: "Zulu" });
    const east = host("east", false, [agent("east-omp", "omp", "same-session", { hostId: "east" })], { name: "Alpha" });
    const west = host("west", false, [agent("west-omp", "omp", "same-session")], { name: "Beta" });

    const rows = adoptableSessions([west, east, local], { includeRemote: true });
    expect(rows.map(({ key }) => key)).toEqual([
      "live:omp:same-session",
      "live:east:omp:same-session",
      "live:west:omp:same-session",
    ]);
    expect(new Set(rows.map(({ key }) => key)).size).toBe(3);
    expect(rows.map(({ host: selected }) => selected.id)).toEqual(["paired", "east", "west"]);
  });

  const excluded: { reason: string; hosts: HostInfo[] }[] = [
    {
      reason: "offline self host",
      hosts: [host("local", true, [agent("a", "omp", "s")], { online: false })],
    },
    {
      reason: "offline remote host",
      hosts: [host("far", false, [agent("a", "omp", "s")], { online: false })],
    },
    {
      reason: "offline local agent",
      hosts: [host("local", true, [agent("a", "omp", "s", { status: "offline" })])],
    },
    {
      reason: "offline remote agent",
      hosts: [host("far", false, [agent("a", "omp", "s", { status: "offline" })])],
    },
    {
      reason: "non-catalog local harness",
      hosts: [host("local", true, [agent("a", "cursor-cloud", "s")])],
    },
    {
      reason: "non-catalog remote harness",
      hosts: [host("far", false, [agent("a", "custom-harness", "s")])],
    },
    {
      reason: "absent sessionId",
      hosts: [host("far", false, [agent("a", "omp")])],
    },
    {
      reason: "empty sessionId",
      hosts: [host("far", false, [agent("a", "omp", "")])],
    },
    {
      reason: "remote agent with spoofed hostId",
      hosts: [host("far", false, [agent("a", "omp", "s", { hostId: "other" })])],
    },
  ];

  for (const { reason, hosts } of excluded) {
    test(`excludes ${reason}`, () => {
      expect(adoptableSessions(hosts, { includeRemote: true })).toEqual([]);
    });
  }

  test("remote host identity accepts matching and omitted IDs for old bridges", () => {
    const remote = host("far", false, [
      agent("legacy", "hermes", "legacy-sess"),
      agent("matched", "omp", "matched-sess", { hostId: "far" }),
      agent("spoofed", "omp", "spoofed-sess", { hostId: "near" }),
    ]);

    expect(adoptableSessions([remote], { includeRemote: true }).map(({ key }) => key)).toEqual([
      "live:far:hermes:legacy-sess",
      "live:far:omp:matched-sess",
    ]);
  });

  test("self hosts sort first, then host name, newest activity, and deterministic tie breakers", () => {
    const local = host("local", true, [
      agent("old", "omp", "old", { lastActivityAt: 10 }),
      agent("new", "omp", "new", { lastActivityAt: 50 }),
    ], { name: "Zulu" });
    const alpha2 = host("alpha-2", false, [
      agent("no-time", "codex", "missing-time"),
      agent("same-time-2", "omp", "tie-2", { lastActivityAt: 30 }),
    ], { name: "Alpha" });
    const alpha1 = host("alpha-1", false, [
      agent("older", "hermes", "second", { lastActivityAt: 20 }),
      agent("same-time-1", "omp", "tie-1", { lastActivityAt: 30 }),
    ], { name: "Alpha" });
    const beta = host("beta", false, [
      agent("newest-global", "grok", "far-future", { lastActivityAt: 200 }),
    ], { name: "Beta" });
    const hosts: HostInfo[] = [alpha2, local, beta, alpha1];
    const expected = [
      "live:omp:new",
      "live:omp:old",
      "live:alpha-1:omp:tie-1",
      "live:alpha-2:omp:tie-2",
      "live:alpha-1:hermes:second",
      "live:alpha-2:codex:missing-time",
      "live:beta:grok:far-future",
    ];
    const selected = adoptableSessions(hosts, { includeRemote: true });
    expect(selected.map(({ key }) => key)).toEqual(expected);

    const shuffled = [...hosts].reverse().map((item) => ({
      ...item,
      agents: [...item.agents].reverse(),
    }));
    expect(adoptableSessions(shuffled, { includeRemote: true }).map(({ key }) => key)).toEqual(expected);
    expect(adoptableSessions(hosts, { includeRemote: true }).map(({ key }) => key)).toEqual(expected);
  });

  test("known activity at zero sorts ahead of missing activity", () => {
    const remote = host("far", false, [
      agent("unknown", "omp", "unknown"),
      agent("epoch", "omp", "epoch", { lastActivityAt: 0 }),
    ]);
    expect(adoptableSessions([remote], { includeRemote: true }).map(({ key }) => key)).toEqual([
      "live:far:omp:epoch",
      "live:far:omp:unknown",
    ]);
  });

  test("does not mutate caller host arrays or agent arrays", () => {
    const local = host("local", true, [
      agent("z", "omp", "z"),
      agent("a", "codex", "a"),
    ]);
    const hosts: HostInfo[] = [local];
    const originalAgents = [...local.agents];
    const rows = adoptableSessions(hosts, { includeRemote: true });

    expect(hosts).toEqual([local]);
    expect(local.agents).toEqual(originalAgents);
    expect(rows[0]?.host).toBe(local);
    expect(rows.every(({ agent: selected }) => originalAgents.includes(selected))).toBe(true);
  });
});
