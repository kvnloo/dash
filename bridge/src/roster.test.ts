import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleRoster,
  dnsLabel,
  hermesA2AUrl,
  isPhoneOs,
  parseHermesGatewayList,
  parseTailscaleStatus,
} from "./roster";

const status = {
  Self: {
    HostName: "mbp",
    DNSName: "mbp.example.ts.net.",
    Online: true,
    OS: "linux",
    TailscaleIPs: ["100.64.0.1"],
  },
  Peer: {
    a: {
      HostName: "groot",
      DNSName: "0.example.ts.net.",
      Online: true,
      OS: "linux",
      TailscaleIPs: ["100.64.0.2"],
    },
    b: {
      HostName: "Pixel",
      DNSName: "phone.example.ts.net.",
      Online: true,
      OS: "android",
      TailscaleIPs: ["100.64.0.3"],
    },
    c: {
      HostName: "cursor",
      DNSName: "cursor.example.ts.net.",
      Online: true,
      OS: "linux",
      TailscaleIPs: ["100.64.0.4"],
    },
  },
};

describe("roster", () => {
  test("dns label prefers MagicDNS 0 over hostname groot", () => {
    expect(dnsLabel("0.example.ts.net.", "groot")).toBe("0");
    expect(isPhoneOs("android")).toBe(true);
    expect(isPhoneOs("linux")).toBe(false);
  });

  test("lists mbp, 0, cursor and skips the phone", () => {
    const nodes = parseTailscaleStatus(status);
    const hosts = assembleRoster({
      nodes,
      ompTabs: [
        { id: "aaa", cwd: "/home/you/workspace/dash" },
        { id: "bbb", cwd: "/home/you/workspace/keyconf.gen" },
      ],
      harnesses: [
        { id: "omp", name: "OMP", available: true },
        { id: "codex", name: "Codex", available: true },
        { id: "claude", name: "Claude Code", available: false },
      ],
      selfFallback: { hostname: "mbp", address: "100.64.0.1" },
    });
    expect(hosts.map((h) => h.id)).toEqual(["mbp", "0", "cursor"]);
    expect(hosts.find((h) => h.id === "0")?.hostname).toBe("groot");
    expect(hosts.find((h) => h.id === "0")?.online).toBe(true);
    expect(hosts.find((h) => h.id === "0")?.agents.map((a) => a.name)).toEqual(["Hermes"]);
    expect(hosts.find((h) => h.id === "cursor")?.agents).toEqual([]);
    const mbp = hosts[0]!;
    expect(mbp.self).toBe(true);
    expect(mbp.agents.filter((a) => a.kind === "omp").map((a) => a.detail)).toEqual([
      "/home/you/workspace/dash",
      "/home/you/workspace/keyconf.gen",
    ]);
    expect(mbp.agents.some((a) => a.id === "harness:omp")).toBe(false);
    expect(mbp.agents.find((a) => a.kind === "codex")?.status).toBe("available");
    expect(mbp.agents.find((a) => a.kind === "claude")?.status).toBe("offline");
    expect(mbp.agents.filter((a) => a.id.startsWith("a2a:") || a.id === "grok-bot")).toEqual([]);
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

  test("lists Hermes profiles from gateway state", () => {
    const hosts = assembleRoster({
      nodes: parseTailscaleStatus({ Self: status.Self, Peer: {} }),
      ompTabs: [],
      harnesses: [{ id: "hermes", name: "Hermes", available: true }],
      selfFallback: { hostname: "mbp", address: "100.64.0.1" },
      signals: {
        hermesProfiles: [
          { id: "default", gateway: "running" },
          { id: "connect-all", gateway: "stopped" },
        ],
      },
    });
    const agents = hosts[0]!.agents;
    expect(agents.find((a) => a.id === "harness:hermes")).toBeUndefined();
    expect(agents.find((a) => a.id === "hermes:default")).toEqual({
      id: "hermes:default",
      name: "Hermes",
      kind: "hermes",
      status: "running",
      detail: "Gateway",
    });
    expect(agents.find((a) => a.id === "hermes:connect-all")).toEqual({
      id: "hermes:connect-all",
      name: "connect-all",
      kind: "hermes",
      status: "available",
      detail: "Profile",
    });
  });

  test("Hermes A2A health running vs offline overlays the default profile", () => {
    const base = {
      nodes: parseTailscaleStatus({ Self: status.Self, Peer: {} }),
      ompTabs: [] as const,
      harnesses: [] as { id: string; name: string; available: boolean }[],
      selfFallback: { hostname: "mbp", address: "100.64.0.1" },
      signals: {
        hermesProfiles: [{ id: "default", gateway: "running" as const }],
      },
    };
    const running = assembleRoster({
      ...base,
      signals: { ...base.signals, hermesA2A: { ok: true, url: "http://100.64.0.1:9900" } },
    });
    const offline = assembleRoster({
      ...base,
      signals: { ...base.signals, hermesA2A: { ok: false, url: "http://100.64.0.1:9900" } },
    });
    expect(running[0]!.agents.find((a) => a.kind === "hermes")?.status).toBe("running");
    expect(offline[0]!.agents.find((a) => a.kind === "hermes")?.status).toBe("offline");
    expect(running[0]!.agents.find((a) => a.kind === "hermes")?.detail).toBe("http://100.64.0.1:9900");
  });

  test("lists grok-bot only when a live process signal exists", () => {
    const without = assembleRoster({
      nodes: parseTailscaleStatus({ Self: status.Self, Peer: {} }),
      ompTabs: [],
      harnesses: [{ id: "grok", name: "Grok", available: true }],
      selfFallback: { hostname: "mbp" },
    });
    const withBot = assembleRoster({
      nodes: parseTailscaleStatus({ Self: status.Self, Peer: {} }),
      ompTabs: [],
      harnesses: [{ id: "grok", name: "Grok", available: true }],
      selfFallback: { hostname: "mbp" },
      signals: { grokBot: true },
    });
    expect(without[0]!.agents.some((a) => a.id === "grok-bot" || a.id === "a2a:grok-bot")).toBe(false);
    expect(without[0]!.agents.find((a) => a.id === "harness:grok")?.status).toBe("available");
    expect(withBot[0]!.agents.find((a) => a.id === "grok-bot")).toEqual({
      id: "grok-bot",
      name: "grok-bot",
      kind: "grok",
      status: "running",
      detail: "Desktop app",
    });
    expect(withBot[0]!.agents.find((a) => a.id === "harness:grok")).toBeUndefined();
  });

  test("cursor stays empty unless a peer A2A probe succeeds", () => {
    const nodes = parseTailscaleStatus(status);
    const dark = assembleRoster({
      nodes,
      ompTabs: [],
      harnesses: [],
      selfFallback: { hostname: "mbp" },
    });
    const lit = assembleRoster({
      nodes,
      ompTabs: [],
      harnesses: [],
      selfFallback: { hostname: "mbp" },
      signals: { peerA2A: { cursor: { ok: true, name: "cos" } } },
    });
    expect(dark.find((h) => h.id === "cursor")?.agents).toEqual([]);
    expect(lit.find((h) => h.id === "cursor")?.agents).toEqual([
      { id: "hermes", name: "Hermes", kind: "hermes", status: "running", detail: "A2A" },
    ]);
  });

  test("parses hermes gateway list running vs stopped", () => {
    const parsed = parseHermesGatewayList(`Gateways:
  ✓ default (current)        — PID 3135810
  ✗ connect-all              — not running
  ✗ cairn-verify             — not running
`);
    expect(parsed).toEqual([
      { id: "default", gateway: "running" },
      { id: "connect-all", gateway: "stopped" },
      { id: "cairn-verify", gateway: "stopped" },
    ]);
  });

  test("builds A2A URL from env or self address, never a baked 100.x", () => {
    expect(hermesA2AUrl({ DASH_HERMES_A2A_URL: "http://example.internal:9900" }, "100.64.0.1")).toBe(
      "http://example.internal:9900",
    );
    expect(hermesA2AUrl({}, "100.64.0.1")).toBe("http://100.64.0.1:9900");
    expect(hermesA2AUrl({}, undefined)).toBe("http://127.0.0.1:9900");
    const src = readFileSync(join(import.meta.dir, "roster.ts"), "utf8");
    expect(src).not.toMatch(/100\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
  });
});
