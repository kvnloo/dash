import { describe, expect, test } from "bun:test";
import type { HostInfo } from "../../shared/protocol";
import { assembleRoster, selfHostFrom, type TailscaleNode } from "./roster";
import { GatewayListSnapshot, isLocalRoute, localRoutingIds } from "./roster-reliability";

const localNode: TailscaleNode = {
  hostName: "groot", dnsName: "0.tail.ts.net.", online: true, os: "linux",
  ips: ["100.64.0.10"], self: true,
};
const collidingRemoteNode: TailscaleNode = {
  hostName: "workstation", dnsName: "groot.tail.ts.net.", online: true, os: "linux",
  ips: ["100.64.0.20"], self: false,
};

function roster(nodes: TailscaleNode[]): HostInfo[] {
  return assembleRoster({
    nodes, ompTabs: [], harnesses: [],
    selfFallback: { hostname: "groot", address: "100.64.0.10" },
  });
}

describe("issue #8: remote IDs cannot alias the paired bridge", () => {
  test("uses observed MagicDNS identity even when a remote ID equals the local OS hostname", () => {
    const hosts = roster([localNode, collidingRemoteNode]);
    expect(hosts.map((host) => host.id)).toEqual(["0", "groot"]);
    const local = selfHostFrom(hosts, "groot");

    expect(local.id()).toBe("0");
    expect(local.matches("0")).toBe(true);
    expect(local.matches("groot")).toBe(false);
    expect(local.matches("100.64.0.20")).toBe(false);
    expect(local.matches("")).toBe(false);
    // The old unscoped client contract still means the authenticated paired bridge.
    expect(local.matches(undefined)).toBe(true);
  });

  test("keeps unique legacy OS host aliases without accepting display labels from other hosts", () => {
    const nodes = [localNode, { ...collidingRemoteNode, dnsName: "cursor.tail.ts.net." }];
    const local = selfHostFrom(roster(nodes), "groot");
    expect(local.id()).toBe("0");
    expect(local.matches("groot")).toBe(true);
    expect(local.matches("0")).toBe(true);
    expect(local.matches("cursor")).toBe(false);
    expect(local.matches("Groot")).toBe(false);
    expect(local.matches(" groot ")).toBe(false);
  });

  test("recomputes aliases when reconnect changes the topology, not only at construction", () => {
    const local = selfHostFrom(roster([localNode]), "groot");
    expect(local.matches("groot")).toBe(true);

    local.remember(roster([localNode, collidingRemoteNode]));
    expect(local.matches("groot")).toBe(false);
    expect(local.matches("0")).toBe(true);

    local.remember(roster([localNode]));
    expect(local.matches("groot")).toBe(true);
  });

  test("fails closed for duplicate canonical routing IDs instead of choosing a host", () => {
    const hosts = roster([localNode, { ...collidingRemoteNode, dnsName: "0.tail.ts.net." }]);
    const aliases = localRoutingIds(hosts, "groot");
    expect(isLocalRoute("0", aliases)).toBe(false);
    expect(isLocalRoute(undefined, aliases)).toBe(true);
    expect(isLocalRoute("", aliases)).toBe(false);
    expect(isLocalRoute("0 ", aliases)).toBe(false);
  });
});

describe("issue #8: Hermes gateway status is measured, not an immortal cached success", () => {
  test("clears a previously healthy list after a missing executable or failed probe", () => {
    const snapshot = new GatewayListSnapshot();
    snapshot.refresh((settle) => settle("✓ default"));
    expect(snapshot.read()).toBe("✓ default");

    // Bun.which(hermes) unavailable, nonzero exit and timeout all settle null.
    snapshot.refresh((settle) => settle(null));
    expect(snapshot.read()).toBe("");

    snapshot.refresh((settle) => settle("✓ default"));
    snapshot.refresh((settle) => settle(""));
    expect(snapshot.read()).toBe("");
  });

  test("keeps last measurement only while the replacement bounded probe is in flight", () => {
    const snapshot = new GatewayListSnapshot();
    snapshot.refresh((settle) => settle("✓ default"));
    const pending: Array<(value: string | null) => void> = [];
    snapshot.refresh((settle) => pending.push(settle));
    expect(snapshot.read()).toBe("✓ default");
    pending[0]?.(null);
    expect(snapshot.read()).toBe("");
  });

  test("ignores out-of-order old success after a newer offline transition", () => {
    const snapshot = new GatewayListSnapshot();
    const pending: Array<(value: string | null) => void> = [];
    snapshot.refresh((settle) => pending.push(settle));
    snapshot.refresh((settle) => pending.push(settle));
    pending[1]?.(null);
    pending[0]?.("✓ default");
    expect(snapshot.read()).toBe("");

    snapshot.refresh((settle) => pending.push(settle));
    pending[2]?.("✗ default");
    pending[1]?.("✓ default");
    expect(snapshot.read()).toBe("✗ default");
  });

  test("synchronous launch failures clear stale status without throwing at import time", () => {
    const snapshot = new GatewayListSnapshot();
    snapshot.refresh((settle) => settle("✓ default"));
    expect(() => snapshot.refresh(() => { throw new Error("spawn unavailable"); })).not.toThrow();
    expect(snapshot.read()).toBe("");
  });
});
