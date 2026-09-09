import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleRoster, dnsLabel, isPhoneOs, liveOmpFromDaemonRoot, parseTailscaleStatus } from "./roster";

const status = {
  Self: {
    HostName: "mbp",
    DNSName: "mbp.taila30dc.ts.net.",
    Online: true,
    OS: "linux",
    TailscaleIPs: ["100.78.215.21"],
  },
  Peer: {
    a: {
      HostName: "groot",
      DNSName: "0.taila30dc.ts.net.",
      Online: true,
      OS: "linux",
      TailscaleIPs: ["100.113.138.100"],
    },
    b: {
      HostName: "Kevin's S25 Ultra",
      DNSName: "kevins-s25-ultra.taila30dc.ts.net.",
      Online: true,
      OS: "android",
      TailscaleIPs: ["100.117.226.39"],
    },
    c: {
      HostName: "cursor",
      DNSName: "cursor.taila30dc.ts.net.",
      Online: true,
      OS: "linux",
      TailscaleIPs: ["100.118.33.15"],
    },
  },
};

describe("roster", () => {
  test("dns label prefers MagicDNS 0 over hostname groot", () => {
    expect(dnsLabel("0.taila30dc.ts.net.", "groot")).toBe("0");
    expect(isPhoneOs("android")).toBe(true);
    expect(isPhoneOs("linux")).toBe(false);
  });

  test("lists mbp, 0, cursor and skips the phone", () => {
    const nodes = parseTailscaleStatus(status);
    const hosts = assembleRoster({
      nodes,
      ompTabs: [
        { id: "aaa", cwd: "/home/kvn/workspace/dash" },
        { id: "bbb", cwd: "/home/kvn/workspace/keyconf.gen" },
      ],
      harnesses: [
        { id: "omp", name: "OMP", available: true },
        { id: "codex", name: "Codex", available: true },
        { id: "claude", name: "Claude Code", available: false },
      ],
      selfFallback: { hostname: "mbp", address: "100.78.215.21" },
    });
    expect(hosts.map((h) => h.id)).toEqual(["mbp", "0", "cursor"]);
    expect(hosts.find((h) => h.id === "0")?.hostname).toBe("groot");
    expect(hosts.find((h) => h.id === "0")?.online).toBe(true);
    expect(hosts.find((h) => h.id === "0")?.agents.map((a) => a.name)).toEqual(["Hermes"]);
    const mbp = hosts[0]!;
    expect(mbp.self).toBe(true);
    expect(mbp.agents.filter((a) => a.kind === "omp").map((a) => a.detail)).toEqual([
      "/home/kvn/workspace/dash",
      "/home/kvn/workspace/keyconf.gen",
    ]);
    expect(mbp.agents.some((a) => a.id === "harness:omp")).toBe(false);
    expect(mbp.agents.find((a) => a.kind === "codex")?.status).toBe("available");
    expect(mbp.agents.find((a) => a.kind === "claude")?.status).toBe("offline");
  });

  test("falls back to installed OMP when no tabs are live", () => {
    const hosts = assembleRoster({
      nodes: parseTailscaleStatus({ Self: status.Self, Peer: {} }),
      ompTabs: [],
      harnesses: [{ id: "omp", name: "OMP", available: true }],
      selfFallback: { hostname: "mbp" },
    });
    expect(hosts[0]!.agents).toEqual([
      { id: "harness:omp", name: "OMP", kind: "omp", status: "available", detail: "Installed" },
    ]);
  });
});
