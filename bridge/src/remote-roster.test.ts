import { describe, expect, test } from "bun:test";
import type { AgentInfo } from "../../shared/protocol";
import { assembleRoster } from "./roster";
import {
  collectRemoteAgents,
  type RemoteRosterPeer,
  type RemoteRosterCache,
} from "./remote-roster";

const alpha: RemoteRosterPeer = { hostId: "alpha", address: "100.64.0.21" };
const beta: RemoteRosterPeer = { hostId: "beta", address: "100.64.0.22" };

function agent(id: string, extras: Partial<AgentInfo> = {}): AgentInfo {
  return { id, name: id, kind: "omp", status: "running", ...extras };
}

function roster(agents: unknown[]): unknown {
  return { agents };
}

describe("collectRemoteAgents: peer origin and protocol validation", () => {
  test("two independent peer formats keep only each peer's own agents and override untrusted hostId", async () => {
    const result = await collectRemoteAgents({
      peers: [alpha, beta],
      now: () => 1_000,
      fetchPeer: async peer => peer.hostId === "alpha"
        ? { hosts: [
          { self: false, agents: [agent("other-host")] },
          { self: true, agents: [
            agent("remote-omp", { sessionId: "s-1", hostId: "forged", detail: "project" }),
          ] },
        ] }
        : roster([agent("remote-hermes", { kind: "hermes", sessionId: "s-2", hostId: "alpha" })]),
    });

    expect(result.errors).toEqual([]);
    expect(Object.keys(result.remoteAgents)).toEqual(["alpha", "beta"]);
    expect(result.remoteAgents.alpha).toEqual([
      agent("remote-omp", { sessionId: "s-1", hostId: "alpha", detail: "project" }),
    ]);
    expect(result.remoteAgents.beta).toEqual([
      agent("remote-hermes", { kind: "hermes", sessionId: "s-2", hostId: "beta" }),
    ]);
    expect(result.cache.alpha?.lastGoodAt).toBe(1_000);
    expect(result.cache.beta?.lastGoodAt).toBe(1_000);

    // The collector's result is already the shape consumed by the existing
    // RosterSignals.remoteAgents reader, without editing Hermes-owned roster.ts.
    const hosts = assembleRoster({
      nodes: [
        { hostName: "local", dnsName: "local.tail.ts.net.", online: true, self: true, os: "linux", ips: ["100.64.0.1"] },
        { hostName: "a", dnsName: "alpha.tail.ts.net.", online: true, self: false, os: "linux", ips: [alpha.address] },
        { hostName: "b", dnsName: "beta.tail.ts.net.", online: true, self: false, os: "linux", ips: [beta.address] },
      ],
      ompTabs: [],
      harnesses: [],
      selfFallback: { hostname: "local" },
      signals: { remoteAgents: result.remoteAgents },
    });
    expect(hosts.find(host => host.id === "alpha")?.agents[0]?.sessionId).toBe("s-1");
    expect(hosts.find(host => host.id === "beta")?.agents[0]?.hostId).toBe("beta");
  });

  test("invalid envelopes and empty self-host selection fail closed", async () => {
    const replies = new Map<string, unknown>([
      ["null", null],
      ["string", "not a roster"],
      ["missing", { hosts: [{ self: false, agents: [agent("not-mine")] }] }],
      ["wrong-type", { agents: "not an array" }],
      ["bad-host", { hosts: [{ self: true, agents: "not an array" }] }],
    ]);
    const peers = [...replies.keys()].map(hostId => ({ hostId, address: "100.64.0.31" }));
    const result = await collectRemoteAgents({
      peers,
      now: () => 1,
      fetchPeer: async peer => replies.get(peer.hostId),
    });
    expect(result.remoteAgents).toEqual({});
    expect(result.errors).toEqual(peers.map(peer => ({ hostId: peer.hostId, reason: "invalid" })));
    expect(result.cache).toEqual({});
  });

  test("bad id, kind, status, name and optional fields are dropped without throwing", async () => {
    const result = await collectRemoteAgents({
      peers: [alpha],
      now: () => 42,
      fetchPeer: async () => roster([
        null,
        "string",
        { name: "no id", kind: "omp", status: "running" },
        { id: "no kind", name: "x", status: "running" },
        { id: "bad status", name: "x", kind: "omp", status: "busy" },
        { id: "bad name", name: 19, kind: "omp", status: "running" },
        { id: "bad count", name: "x", kind: "omp", status: "running", messageCount: "12" },
        { id: "bad activity", name: "x", kind: "omp", status: "running", lastActivityAt: Infinity },
        { id: "bad cwd", name: "x", kind: "omp", status: "running", cwd: {} },
        { id: "good", kind: "omp", status: "available", hostId: 123, messageCount: 3, lastActivityAt: 5 },
      ]),
    });
    expect(result.remoteAgents.alpha).toEqual([
      agent("good", { status: "available", hostId: "alpha", messageCount: 3, lastActivityAt: 5 }),
    ]);
    expect(result.errors).toEqual([{ hostId: "alpha", reason: "invalid" }]);
  });

  test("all-invalid rows preserve previous good data; a valid empty roster intentionally clears it", async () => {
    const initial = await collectRemoteAgents({
      peers: [alpha],
      now: () => 100,
      fetchPeer: async () => roster([agent("remembered")]),
    });
    const failed = await collectRemoteAgents({
      peers: [alpha],
      previous: initial.cache,
      now: () => 120,
      fetchPeer: async () => roster([{ id: "oops", kind: "omp", status: "unknown" }]),
    });
    expect(failed.errors).toEqual([{ hostId: "alpha", reason: "invalid" }]);
    expect(failed.remoteAgents.alpha).toEqual([agent("remembered", { hostId: "alpha" })]);
    expect(failed.cache.alpha?.lastGoodAt).toBe(100);

    const cleared = await collectRemoteAgents({
      peers: [alpha],
      previous: failed.cache,
      now: () => 150,
      fetchPeer: async () => roster([]),
    });
    expect(cleared.errors).toEqual([]);
    expect(cleared.remoteAgents.alpha).toEqual([]);
    expect(cleared.cache.alpha?.agents).toEqual([]);
    expect(cleared.cache.alpha?.lastGoodAt).toBe(150);
  });
});

describe("collectRemoteAgents: concurrent deadlines and caching", () => {
  test("one timed-out peer cannot prevent an independent fast peer's roster", async () => {
    const called: string[] = [];
    const never = new Promise<unknown>(() => {});
    let wall = 10_000;
    const result = await collectRemoteAgents({
      peers: [alpha, beta],
      now: () => wall,
      timeoutMs: 5,
      fetchPeer: async peer => {
        called.push(peer.hostId);
        return peer.hostId === "alpha" ? never : roster([agent("fast")]);
      },
    });
    expect(called).toEqual(["alpha", "beta"]);
    expect(result.remoteAgents.alpha).toBeUndefined();
    expect(result.remoteAgents.beta).toEqual([agent("fast", { hostId: "beta" })]);
    expect(result.errors).toEqual([{ hostId: "alpha", reason: "timeout" }]);
    wall += 1;
  });

  test("injected logical deadline rejects a late response even if the promise resolves immediately", async () => {
    let clock = 500;
    const result = await collectRemoteAgents({
      peers: [alpha],
      now: () => clock,
      timeoutMs: 10,
      fetchPeer: async () => {
        clock = 511;
        return roster([agent("too-late")]);
      },
    });
    expect(result.errors).toEqual([{ hostId: "alpha", reason: "timeout" }]);
    expect(result.remoteAgents.alpha).toBeUndefined();
  });

  test("sync throws and rejected peer requests classify as unreachable", async () => {
    const result = await collectRemoteAgents({
      peers: [alpha, beta],
      now: () => 100,
      fetchPeer: peer => {
        if (peer.hostId === "alpha") throw new Error("connection refused");
        return Promise.reject(new Error("socket closed"));
      },
    });
    expect(result.errors).toEqual([
      { hostId: "alpha", reason: "unreachable" },
      { hostId: "beta", reason: "unreachable" },
    ]);
  });

  test("last good entries stay live through 60s, become offline after it, expire at 10min", async () => {
    let clock = 5_000;
    const seeded = await collectRemoteAgents({
      peers: [alpha],
      now: () => clock,
      fetchPeer: async () => roster([agent("cached", { status: "running", sessionId: "keep" })]),
    });
    const seedCache = seeded.cache;
    let previous: RemoteRosterCache = seedCache;
    const failing = async () => {
      const result = await collectRemoteAgents({
        peers: [alpha],
        now: () => clock,
        previous,
        fetchPeer: async () => { throw new Error("offline"); },
      });
      previous = result.cache;
      return result;
    };

    clock = 5_000 + 59_999;
    const fresh = await failing();
    expect(fresh.remoteAgents.alpha?.[0]?.status).toBe("running");
    expect(fresh.cache.alpha?.lastGoodAt).toBe(5_000);

    clock = 5_000 + 60_000;
    expect((await failing()).remoteAgents.alpha?.[0]?.status).toBe("running");

    clock = 5_000 + 60_001;
    const stale = await failing();
    expect(stale.remoteAgents.alpha?.[0]?.status).toBe("offline");
    expect(stale.cache.alpha?.agents[0]?.status).toBe("running");
    expect(seedCache.alpha?.agents[0]?.status).toBe("running");

    clock = 5_000 + 599_999;
    expect((await failing()).remoteAgents.alpha?.[0]?.status).toBe("offline");

    clock = 5_000 + 600_000;
    const expired = await failing();
    expect(expired.remoteAgents.alpha).toBeUndefined();
    expect(expired.cache.alpha).toBeUndefined();
    expect(expired.errors).toEqual([{ hostId: "alpha", reason: "unreachable" }]);
  });

  test("a recovered peer refreshes the last-good clock and restores original statuses", async () => {
    let clock = 0;
    const seed = await collectRemoteAgents({
      peers: [alpha], now: () => clock, fetchPeer: async () => roster([agent("old")]),
    });
    clock = 80_000;
    const stale = await collectRemoteAgents({
      peers: [alpha], previous: seed.cache, now: () => clock,
      fetchPeer: async () => { throw new Error("offline"); },
    });
    expect(stale.remoteAgents.alpha?.[0]?.status).toBe("offline");
    const recovered = await collectRemoteAgents({
      peers: [alpha], previous: stale.cache, now: () => clock,
      fetchPeer: async () => roster([agent("new", { status: "available" })]),
    });
    expect(recovered.remoteAgents.alpha?.[0]?.status).toBe("available");
    expect(recovered.remoteAgents.alpha?.map(a => a.id)).toEqual(["new"]);
    expect(recovered.cache.alpha?.lastGoodAt).toBe(80_000);
  });

  test("host IDs are unique, missing hosts do not leak cached state, and special keys remain own properties", async () => {
    const collision: RemoteRosterPeer = { hostId: "__proto__", address: "100.64.0.41" };
    const input = await collectRemoteAgents({
      peers: [alpha, alpha, collision],
      now: () => 1,
      fetchPeer: async peer => roster([agent(peer.hostId)]),
    });
    expect(Object.keys(input.remoteAgents)).toEqual(["alpha", "__proto__"]);
    expect(Object.hasOwn(input.remoteAgents, "__proto__")).toBe(true);

    const next = await collectRemoteAgents({
      peers: [beta],
      previous: input.cache,
      now: () => 2,
      fetchPeer: async () => roster([]),
    });
    expect(Object.keys(next.remoteAgents)).toEqual(["beta"]);
    expect(next.cache.alpha).toBeUndefined();
  });
});

describe("collectRemoteAgents: deduplication and hard per-peer cap", () => {
  test("same kind+sessionId and then id keep the newest activity without merging unrelated kinds", async () => {
    const result = await collectRemoteAgents({
      peers: [alpha],
      now: () => 10,
      fetchPeer: async () => roster([
        agent("old", { kind: "omp", sessionId: "s", lastActivityAt: 1 }),
        agent("new", { kind: "omp", sessionId: "s", lastActivityAt: 40 }),
        agent("new", { kind: "omp", sessionId: "other", lastActivityAt: 30 }),
        agent("same-session-different-kind", { kind: "hermes", sessionId: "s", lastActivityAt: 5 }),
        agent("id-only", { lastActivityAt: 10 }),
        agent("id-only", { lastActivityAt: 20, detail: "most recent" }),
        agent("tie", { lastActivityAt: 20, detail: "first" }),
        agent("tie", { lastActivityAt: 20, detail: "second" }),
      ]),
    });
    expect(result.errors).toEqual([]);
    expect(result.remoteAgents.alpha?.map(a => a.id)).toEqual([
      "new", "same-session-different-kind", "id-only", "tie",
    ]);
    expect(result.remoteAgents.alpha?.find(a => a.id === "new")?.sessionId).toBe("s");
    expect(result.remoteAgents.alpha?.find(a => a.id === "id-only")?.detail).toBe("most recent");
    expect(result.remoteAgents.alpha?.find(a => a.id === "tie")?.detail).toBe("first");
  });

  test("2001 distinct agents are capped to 2000 with an invalid error but a reusable good cache", async () => {
    const tooMany: AgentInfo[] = Array.from({ length: 2_001 }, (_, i): AgentInfo => agent("agent-" + i));
    const result = await collectRemoteAgents({
      peers: [alpha],
      now: () => 100,
      fetchPeer: async () => roster(tooMany),
    });
    expect(result.remoteAgents.alpha).toHaveLength(2_000);
    expect(result.remoteAgents.alpha?.[0]?.id).toBe("agent-0");
    expect(result.remoteAgents.alpha?.[1_999]?.id).toBe("agent-1999");
    expect(result.remoteAgents.alpha?.some(a => a.id === "agent-2000")).toBe(false);
    expect(result.errors).toEqual([{ hostId: "alpha", reason: "invalid" }]);
    expect(result.cache.alpha?.agents).toHaveLength(2_000);
  });
});
