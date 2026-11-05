import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chooseHermesRoute, liveText, planContinuation } from "./hermes-continue";
import { connectedVia, ownerHosting, parseProcTcp, readGatewayPids, type GatewayHostProbe } from "./hermes-gateway-host";
import type { LiveOwner } from "./hermes-owner";
import { HermesSessions } from "./hermes-sessions";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function scratchRoot(): string {
  const scratch = process.env.TMPDIR ?? join(homedir(), ".cache", "dash-tests");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "dash-gateway-host-")); roots.push(root);
  return root;
}

const cli: LiveOwner = { surface: "cli", pid: 500, sessionId: "20261019_192603_93cd94", startedAt: 1000 };
const probe = (gateways: number[], links: [number, number][] = []): GatewayHostProbe => ({
  gatewayPids: () => gateways,
  connectedTo: (owner, gateway) => links.some(([o, g]) => o === owner && g === gateway),
});

test("a CLI connected to the profile's gateway is a gateway viewer; the gateway's own lease is too", () => {
  expect(ownerHosting(cli, "clean", "/h", probe([351541], [[500, 351541]]))).toBe("gateway");
  expect(ownerHosting({ ...cli, pid: 351541, surface: "gateway:local" }, "clean", "/h", probe([351541]))).toBe("gateway");
});

test("no serving gateway, or no link to it, keeps the owner standalone (ordered handoff)", () => {
  expect(ownerHosting(cli, "clean", "/h", probe([]))).toBe("standalone");
  expect(ownerHosting(cli, "clean", "/h", probe([], []), true)).toBe("standalone");
  expect(ownerHosting(cli, "clean", "/h", probe([351541], [[501, 351541]]))).toBe("standalone");
  const broken: GatewayHostProbe = { gatewayPids: () => { throw new Error("no /proc"); }, connectedTo: () => true };
  expect(ownerHosting(cli, "clean", "/h", broken)).toBe("standalone");
});

test("a native session-authority chat (source local) is gateway-hosted while its gateway runs, even with an idle viewer", () => {
  expect(ownerHosting(cli, "clean", "/h", probe([351541]), true)).toBe("gateway");
});

test("routing decision: gateway owner or gateway session sends live, standalone owner waits, else free", () => {
  expect(planContinuation(undefined, () => "gateway", false)).toEqual({ kind: "free" });
  expect(planContinuation(undefined, () => "standalone", true)).toEqual({ kind: "live" }); // TUI/Desktop: no lease
  expect(planContinuation(cli, () => "gateway", true)).toEqual({ kind: "live", owner: cli });
  expect(planContinuation(cli, () => "gateway", false)).toEqual({ kind: "live", owner: cli });
  expect(planContinuation(cli, () => "standalone", false)).toEqual({ kind: "handoff", owner: cli });
  expect(planContinuation(cli, () => "standalone", true)).toEqual({ kind: "handoff", owner: cli });
  expect(liveText("cli", "groot")).toBe("Open in CLI on groot · sending into the live session");
});

test("a live send uses Hermes's thin gateway client, never the API or ACP projection; no hermes is reported", () => {
  const api = { url: "http://127.0.0.1:8642", key: "k" };
  const argv = ["/bin/hermes", "chat", "--resume", "local-x", "--query-file", "-", "--format", "stream-json"];
  expect(chooseHermesRoute({ api, home: "/h", acpCommand: ["/bin/hermes", "acp"], liveArgv: argv })).toEqual({ kind: "live", argv, home: "/h" });
  expect(chooseHermesRoute({ api, home: "/h", acpCommand: ["/bin/hermes", "acp"], liveArgv: null }).kind).toBe("unavailable");
  expect(chooseHermesRoute({ api, home: "/h", acpCommand: ["/bin/hermes", "acp"] })).toEqual({ kind: "api", api });
});

test("gateway pids come from running gateway_state.json files that serve the profile", () => {
  const root = scratchRoot();
  const profile = join(root, "profiles", "clean");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(root, "gateway_state.json"), JSON.stringify({ pid: 11, kind: "hermes-gateway", gateway_state: "running", hermes_home: root, served_profiles: ["default", "clean"] }));
  writeFileSync(join(profile, "gateway_state.json"), JSON.stringify({ pid: 12, kind: "hermes-gateway", gateway_state: "starting", hermes_home: profile, served_profiles: [] }));
  expect(readGatewayPids([profile, root], "clean", profile, () => true)).toEqual([11]);
  expect(readGatewayPids([profile, root], "other", join(root, "profiles", "other"), () => true)).toEqual([]);
  expect(readGatewayPids([profile, root], "clean", profile, pid => pid !== 11)).toEqual([]);
  writeFileSync(join(profile, "gateway_state.json"), JSON.stringify({ pid: 12, kind: "hermes-gateway", gateway_state: "running", hermes_home: profile }));
  expect(readGatewayPids([profile, root], "clean", profile, () => true)).toEqual([12, 11]);
});

test("/proc/net/tcp: an established loopback connection to a port the gateway listens on links them", () => {
  const table = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 0100007F:FB3B 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 900 1 0000000000000000 100 0 0 10 0",
    "   1: 0100007F:8BDC 0100007F:FB3B 01 00000000:00000000 00:00000000 00000000  1000        0 700 1 0000000000000000 20 4 30 10 -1",
    "   2: 0100007F:21C2 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 901 1 0000000000000000 100 0 0 10 0",
  ].join("\n");
  const rows = parseProcTcp(table);
  expect(rows.map(r => [r.localPort, r.remotePort, r.state])).toEqual([[64315, 0, "0A"], [35804, 64315, "01"], [8642, 0, "0A"]]);
  expect(connectedVia(rows, new Set(["700"]), new Set(["900", "901"]))).toBe(true);
  expect(connectedVia(rows, new Set(["700"]), new Set(["901"]))).toBe(false); // listens elsewhere
  expect(connectedVia(rows, new Set(["999"]), new Set(["900"]))).toBe(false); // not the owner's socket
});

test("HermesSessions.ownerHosting reads the target's source through its compression lineage", () => {
  const root = scratchRoot();
  const home = join(root, "profiles", "clean");
  mkdirSync(home, { recursive: true });
  const db = new Database(join(home, "state.db"));
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, title TEXT, started_at REAL, last_activity_at REAL, message_count INTEGER, cwd TEXT, archived INTEGER, hidden INTEGER, parent_session_id TEXT, end_reason TEXT, model_config TEXT)");
  db.query("INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)").run("local-abc", "local", 1000);
  db.query("INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)").run("20261019_cli", "cli", 1000);
  db.close();
  const sessions = new HermesSessions({ root, env: {}, processes: { alive: () => true, startTime: () => undefined }, gateways: probe([42]) });
  expect(sessions.ownerHosting("clean", "local-abc", cli)).toBe("gateway");
  expect(sessions.ownerHosting("clean", "20261019_cli", cli)).toBe("standalone");
  expect(sessions.gatewayHosted("clean", "local-abc")).toBe(true);
  expect(sessions.gatewayHosted("clean", "20261019_cli")).toBe(false);
  const noGateway = new HermesSessions({ root, env: {}, processes: { alive: () => true, startTime: () => undefined }, gateways: probe([]) });
  expect(noGateway.ownerHosting("clean", "local-abc", cli)).toBe("standalone");
  expect(noGateway.gatewayHosted("clean", "local-abc")).toBe(false);
});
