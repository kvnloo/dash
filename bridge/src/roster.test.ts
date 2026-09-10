import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assembleRoster,
  attachOmpSessions,
  dnsLabel,
  hermesA2AUrl,
  isPhoneOs,
  liveOmpFromDaemonRoot,
  ompSessionDirName,
  parseHermesGatewayList,
  parseTailscaleStatus,
  timedArgv,
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
    expect(mbp.agents.filter((a) => a.kind === "omp").map((a) => a.sessionId)).toEqual(["aaa", "bbb"]);
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
      status: "offline",
      detail: "Gateway stopped",
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

  test("lists grok-bot when the desktop app is alive, even if connect-all is stopped", () => {
    const alive = assembleRoster({
      nodes: parseTailscaleStatus({ Self: status.Self, Peer: {} }),
      ompTabs: [],
      harnesses: [{ id: "grok", name: "Grok", available: true }],
      selfFallback: { hostname: "mbp" },
      signals: {
        grokBot: true,
        hermesProfiles: [{ id: "connect-all", gateway: "stopped" }],
      },
    });
    const dead = assembleRoster({
      nodes: parseTailscaleStatus({ Self: status.Self, Peer: {} }),
      ompTabs: [],
      harnesses: [{ id: "grok", name: "Grok", available: true }],
      selfFallback: { hostname: "mbp" },
      signals: {
        grokBot: false,
        hermesProfiles: [{ id: "connect-all", gateway: "running" }],
      },
    });
    expect(alive[0]!.agents.find((a) => a.id === "grok-bot")).toEqual({
      id: "grok-bot",
      name: "grok-bot",
      kind: "grok",
      status: "running",
      detail: "Desktop app",
    });
    expect(alive[0]!.agents.find((a) => a.id === "harness:grok")).toBeUndefined();
    expect(alive[0]!.agents.find((a) => a.id === "hermes:connect-all")?.status).toBe("offline");
    expect(dead[0]!.agents.some((a) => a.id === "grok-bot")).toBe(false);
    expect(dead[0]!.agents.find((a) => a.id === "harness:grok")?.status).toBe("available");
  });

  test("cursor stays empty; Cursor agents do not join via Hermes", () => {
    const nodes = parseTailscaleStatus(status);
    const hosts = assembleRoster({
      nodes,
      ompTabs: [],
      harnesses: [],
      selfFallback: { hostname: "mbp" },
    });
    expect(hosts.find((h) => h.id === "cursor")?.agents).toEqual([]);
    expect(hosts.find((h) => h.id === "0")?.agents).toEqual([
      { id: "hermes", name: "Hermes", kind: "hermes", status: "running", detail: "Mesh node" },
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

describe("timed probes", () => {
  test("timedArgv wraps probes so /roster cannot hang on hermes gateway list", () => {
    expect(timedArgv(["hermes", "gateway", "list"])).toEqual([
      "timeout",
      "--signal=KILL",
      "1",
      "hermes",
      "gateway",
      "list",
    ]);
    const src = readFileSync(join(import.meta.dir, "roster.ts"), "utf8");
    expect(src).toContain("refreshHermesList");
    expect(src).toContain("ROSTER_TTL_MS");
    expect(src).toContain("attachOmpSessions");
    expect(src).not.toContain('spawnText(["hermes", "gateway", "list"])');
  });

  test("bridge listens on all interfaces so LAN pair works", () => {
    const src = readFileSync(join(import.meta.dir, "../index.ts"), "utf8");
    expect(src).toContain('const HOST = process.env.DASH_HOST ?? "0.0.0.0";');
    expect(src).not.toContain("process.env.DASH_HOST ?? tailscaleIp");
  });
});

describe("live OMP sessions", () => {
  test("prefers an explicit tab sessionId over the daemon id", () => {
    const hosts = assembleRoster({
      nodes: parseTailscaleStatus({ Self: status.Self, Peer: {} }),
      ompTabs: [{ id: "aaa", cwd: "/home/you/workspace/dash", sessionId: "01liveomp", title: "dash" }],
      harnesses: [{ id: "omp", name: "OMP", available: true }],
      selfFallback: { hostname: "mbp" },
    });
    const omp = hosts[0]!.agents.find((a) => a.kind === "omp");
    expect(omp?.sessionId).toBe("01liveomp");
    expect(omp?.kind).toBe("omp");
  });

  test("encodes cwd the way OMP session folders do", () => {
    expect(ompSessionDirName("/home/you/workspace/dash", "/home/you")).toBe("-workspace-dash");
    expect(ompSessionDirName("/home/you/.treehouse/dash-fecad0/2/dash", "/home/you")).toBe(
      "-.treehouse-dash-fecad0-2-dash",
    );
  });

  test("attaches the latest OMP session id for a live tab cwd", () => {
    const root = mkdtempSync(join(tmpdir(), "dash-omp-"));
    const home = join(root, "home");
    const cwd = join(home, "workspace", "dash");
    const sessionDir = join(root, "sessions", ompSessionDirName(cwd, home));
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "2026-09-10T20-00-00-000Z_01oldsession.jsonl"),
      `${JSON.stringify({ type: "session", version: 3, id: "01oldsession" })}\n`,
    );
    writeFileSync(
      join(sessionDir, "2026-09-10T23-30-36-633Z_01liveomp.jsonl"),
      `${JSON.stringify({ type: "title", v: 1, title: "Ship chats" })}\n${JSON.stringify({ type: "session", version: 3, id: "01liveomp" })}\n`,
    );
    const attached = attachOmpSessions([{ id: "aaa", cwd }], join(root, "sessions"), home);
    expect(attached).toEqual([{ id: "aaa", cwd, sessionId: "01liveomp", title: "Ship chats" }]);
  });

  test("keeps a live tab when the session store has no transcript yet", () => {
    const root = mkdtempSync(join(tmpdir(), "dash-omp-"));
    const attached = attachOmpSessions(
      [{ id: "aaa", cwd: join(root, "project") }],
      join(root, "sessions"),
      root,
    );
    expect(attached).toEqual([{ id: "aaa", cwd: join(root, "project"), sessionId: "aaa" }]);
  });

  test("discovers a live daemon tab from broker pid and sock", () => {
    const root = mkdtempSync(join(tmpdir(), "dash-omp-"));
    const tab = join(root, "38a3f3a952f042e1");
    mkdirSync(tab, { recursive: true });
    writeFileSync(join(tab, "broker.sock"), "");
    writeFileSync(join(tab, "broker.pid"), JSON.stringify({ pid: 4242 }));
    writeFileSync(join(tab, "scope.json"), JSON.stringify({ projectDir: "/home/you/workspace/dash" }));
    expect(liveOmpFromDaemonRoot(root, (pid) => pid === 4242)).toEqual([
      { id: "38a3f3a952f042e1", cwd: "/home/you/workspace/dash" },
    ]);
  });
});
