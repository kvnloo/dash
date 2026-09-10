import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentInfo, HarnessInfo, HostInfo } from "../../shared/protocol";

export type TailscaleNode = {
  hostName: string;
  dnsName: string;
  online: boolean;
  os: string;
  ips: string[];
  self: boolean;
};

export type OmpTab = {
  id: string;
  cwd: string;
};

export type HermesProfileInfo = {
  id: string;
  gateway: "running" | "stopped";
};

export type RosterSignals = {
  hermesProfiles?: HermesProfileInfo[];
  hermesA2A?: { ok: boolean; url: string };
  grokBot?: boolean;
};

const PHONE_OS = new Set(["android", "ios", "ipados", "tvos"]);
const A2A_PORT = 9900;

export function dnsLabel(dnsName: string, fallback: string): string {
  const label = dnsName.replace(/\.$/, "").split(".")[0]?.trim();
  return label && label.length > 0 ? label : fallback;
}

export function isPhoneOs(os: string): boolean {
  return PHONE_OS.has(os.trim().toLowerCase());
}

export function parseTailscaleStatus(raw: unknown): TailscaleNode[] {
  if (typeof raw !== "object" || raw === null) return [];
  const rec = raw as Record<string, unknown>;
  const out: TailscaleNode[] = [];
  const self = parseNode(rec.Self, true);
  if (self) out.push(self);
  const peers = rec.Peer;
  if (typeof peers === "object" && peers !== null) {
    for (const value of Object.values(peers as Record<string, unknown>)) {
      const node = parseNode(value, false);
      if (node) out.push(node);
    }
  }
  return out;
}

function parseNode(raw: unknown, self: boolean): TailscaleNode | null {
  if (typeof raw !== "object" || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.HostName !== "string") return null;
  const ips = Array.isArray(rec.TailscaleIPs)
    ? rec.TailscaleIPs.filter((ip): ip is string => typeof ip === "string")
    : [];
  return {
    hostName: rec.HostName,
    dnsName: typeof rec.DNSName === "string" ? rec.DNSName : "",
    online: rec.Online === true || self,
    os: typeof rec.OS === "string" ? rec.OS : "",
    ips,
    self,
  };
}

export function liveOmpFromDaemonRoot(root: string, alive: (pid: number) => boolean): OmpTab[] {
  if (!existsSync(root)) return [];
  const tabs: OmpTab[] = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    const sock = join(dir, "broker.sock");
    const pidPath = join(dir, "broker.pid");
    if (!existsSync(sock) || !existsSync(pidPath)) continue;
    let pid = 0;
    let cwd = "";
    try {
      const pidRaw: unknown = JSON.parse(readFileSync(pidPath, "utf8"));
      if (typeof pidRaw === "object" && pidRaw !== null && typeof (pidRaw as { pid?: unknown }).pid === "number") {
        pid = (pidRaw as { pid: number }).pid;
      }
    } catch {
      continue;
    }
    if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) continue;
    try {
      const scopeRaw: unknown = JSON.parse(readFileSync(join(dir, "scope.json"), "utf8"));
      if (typeof scopeRaw === "object" && scopeRaw !== null && typeof (scopeRaw as { projectDir?: unknown }).projectDir === "string") {
        cwd = (scopeRaw as { projectDir: string }).projectDir;
      }
    } catch {
      cwd = "";
    }
    tabs.push({ id: name, cwd });
  }
  return tabs.sort((a, b) => a.cwd.localeCompare(b.cwd) || a.id.localeCompare(b.id));
}

export function parseHermesGatewayList(text: string): HermesProfileInfo[] {
  const out: HermesProfileInfo[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*([✓✗])\s+(\S+)/u.exec(line);
    if (!m?.[1] || !m[2]) continue;
    out.push({
      id: m[2],
      gateway: m[1] === "✓" ? "running" : "stopped",
    });
  }
  return out;
}

export function hermesA2AUrl(env: Record<string, string | undefined>, selfAddress?: string): string {
  const fromEnv = env.DASH_HERMES_A2A_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (selfAddress && selfAddress.length > 0) return `http://${selfAddress}:${A2A_PORT}`;
  return `http://127.0.0.1:${A2A_PORT}`;
}

function firstV4(ips: string[]): string | undefined {
  return ips.find((ip) => ip.includes(".")) ?? ips[0];
}

export function assembleRoster(input: {
  nodes: TailscaleNode[];
  ompTabs: OmpTab[];
  harnesses: HarnessInfo[];
  selfFallback: { hostname: string; address?: string };
  signals?: RosterSignals;
}): HostInfo[] {
  const computers = input.nodes.filter((n) => !isPhoneOs(n.os));
  const hosts: HostInfo[] = computers.map((node) => nodeToHost(node, input));
  if (!hosts.some((h) => h.self)) {
    hosts.unshift(
      selfHost(input.selfFallback.hostname, input.selfFallback.address, input.ompTabs, input.harnesses, input.signals),
    );
  }
  hosts.sort((a, b) => Number(b.self) - Number(a.self) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return hosts;
}

function nodeToHost(node: TailscaleNode, input: Parameters<typeof assembleRoster>[0]): HostInfo {
  const name = dnsLabel(node.dnsName, node.hostName);
  const v4 = firstV4(node.ips);
  const agents = node.self
    ? selfAgents(input.ompTabs, input.harnesses, input.signals)
    : peerAgents(name, node.hostName);
  return {
    id: name,
    name,
    hostname: node.hostName,
    online: node.online,
    self: node.self,
    address: v4,
    agents,
  };
}

function isGroot(id: string, hostname: string): boolean {
  return id === "0" || hostname.toLowerCase() === "groot";
}

function peerAgents(id: string, hostname: string): AgentInfo[] {
  if (isGroot(id, hostname)) {
    return [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running", detail: "Mesh node" }];
  }
  return [];
}

function selfHost(
  hostname: string,
  address: string | undefined,
  tabs: OmpTab[],
  harnesses: HarnessInfo[],
  signals?: RosterSignals,
): HostInfo {
  return {
    id: hostname,
    name: hostname,
    hostname,
    online: true,
    self: true,
    address,
    agents: selfAgents(tabs, harnesses, signals),
  };
}

function hermesProfileAgent(profile: HermesProfileInfo, a2a?: { ok: boolean; url: string }): AgentInfo {
  const overlay = profile.id === "default" ? a2a : undefined;
  let status: AgentInfo["status"] = profile.gateway === "running" ? "running" : "offline";
  let detail = profile.gateway === "running" ? "Gateway" : "Gateway stopped";
  if (overlay) {
    status = overlay.ok ? "running" : "offline";
    detail = overlay.url;
  }
  return {
    id: `hermes:${profile.id}`,
    name: profile.id === "default" ? "Hermes" : profile.id,
    kind: "hermes",
    status,
    detail,
  };
}

function selfAgents(tabs: OmpTab[], harnesses: HarnessInfo[], signals?: RosterSignals): AgentInfo[] {
  const agents: AgentInfo[] = tabs.map((tab, index) => ({
    id: `omp:${tab.id}`,
    name: tabs.length > 1 ? `OMP ${index + 1}` : "OMP",
    kind: "omp",
    status: "running",
    detail: tab.cwd || "OMP tab",
    cwd: tab.cwd || undefined,
  }));
  const listed = new Set(agents.map((a) => a.kind));
  if (!listed.has("omp")) {
    const omp = harnesses.find((h) => h.id === "omp");
    if (omp) {
      agents.push({
        id: "harness:omp",
        name: omp.name,
        kind: omp.id,
        status: omp.available ? "available" : "offline",
        detail: omp.available ? "Installed" : "Not installed",
      });
    }
  }
  const profiles = signals?.hermesProfiles ?? [];
  const skipHermesHarness = profiles.length > 0 || signals?.hermesA2A !== undefined;
  const grokReachable = signals?.grokBot === true;
  for (const h of harnesses) {
    if (h.id === "omp") continue;
    if (h.id === "hermes" && skipHermesHarness) continue;
    if (h.id === "grok" && grokReachable) continue;
    agents.push({
      id: `harness:${h.id}`,
      name: h.name,
      kind: h.id,
      status: h.available ? "available" : "offline",
      detail: h.available ? "Installed" : "Not installed",
    });
  }
  for (const profile of profiles) {
    agents.push(hermesProfileAgent(profile, signals?.hermesA2A));
  }
  if (signals?.hermesA2A && !profiles.some((p) => p.id === "default")) {
    agents.push({
      id: "a2a:hermes",
      name: "Hermes",
      kind: "hermes",
      status: signals.hermesA2A.ok ? "running" : "offline",
      detail: signals.hermesA2A.url,
    });
  }
  if (grokReachable) {
    agents.push({
      id: "grok-bot",
      name: "grok-bot",
      kind: "grok",
      status: "running",
      detail: "Desktop app",
    });
  }
  return agents;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function timedArgv(argv: readonly string[], seconds = 1): string[] {
  return ["timeout", "--signal=KILL", String(seconds), ...argv];
}

function spawnText(argv: string[], seconds = 1): string {
  try {
    const result = Bun.spawnSync(timedArgv(argv, seconds), { stdout: "pipe", stderr: "ignore" });
    if (result.exitCode !== 0) return "";
    return result.stdout.toString();
  } catch {
    return "";
  }
}

let hermesListCache = "";
function refreshHermesList(): void {
  const proc = Bun.spawn(["hermes", "gateway", "list"], { stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), 2500);
  void proc.exited.then(async () => {
    clearTimeout(timer);
    if (proc.exitCode !== 0) return;
    const text = await new Response(proc.stdout).text();
    if (text.trim()) hermesListCache = text;
  }).catch(() => {
    clearTimeout(timer);
  });
}

let rosterCache: { at: number; key: string; hosts: HostInfo[] } | null = null;
const ROSTER_TTL_MS = 4000;

export function readTailscaleStatus(): unknown {
  try {
    const result = Bun.spawnSync(["tailscale", "status", "--json"], { stdout: "pipe", stderr: "ignore" });
    if (result.exitCode !== 0) return null;
    return JSON.parse(result.stdout.toString()) as unknown;
  } catch {
    return null;
  }
}

function probeAgentCard(baseUrl: string): boolean {
  const url = `${baseUrl.replace(/\/$/, "")}/.well-known/agent.json`;
  try {
    const result = Bun.spawnSync(
      ["curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "1", "-H", "Accept: application/json", url],
      { stdout: "pipe", stderr: "ignore" },
    );
    return result.exitCode === 0 && result.stdout.toString().trim() === "200";
  } catch {
    return false;
  }
}

function grokBotAlive(): boolean {
  return spawnText(["pgrep", "-x", "grok-bot"]).trim().length > 0;
}

function listedHermesProfiles(profiles: HermesProfileInfo[]): HermesProfileInfo[] {
  return profiles.filter((p) => p.gateway === "running" || p.id === "default" || p.id === "connect-all");
}

refreshHermesList();

export function collectRoster(harnesses: HarnessInfo[], self: { hostname: string; address?: string }): HostInfo[] {
  const key = `${self.hostname}:${self.address ?? ""}:${harnesses.map((h) => `${h.id}:${h.available}`).join(",")}`;
  const now = Date.now();
  if (rosterCache && rosterCache.key === key && now - rosterCache.at < ROSTER_TTL_MS) return rosterCache.hosts;
  refreshHermesList();
  const nodes = parseTailscaleStatus(readTailscaleStatus());
  const ompTabs = liveOmpFromDaemonRoot(join(homedir(), ".omp", "run", "daemons"), pidAlive);
  const selfNode = nodes.find((n) => n.self);
  const selfAddress = self.address ?? firstV4(selfNode?.ips ?? []);
  const hermesProfiles = listedHermesProfiles(parseHermesGatewayList(hermesListCache));
  const a2aUrl = hermesA2AUrl(process.env, selfAddress);
  const hosts = assembleRoster({
    nodes,
    ompTabs,
    harnesses,
    selfFallback: { hostname: self.hostname, address: selfAddress },
    signals: {
      hermesProfiles,
      hermesA2A: { ok: probeAgentCard(a2aUrl), url: a2aUrl },
      grokBot: grokBotAlive(),
    },
  });
  rosterCache = { at: now, key, hosts };
  return hosts;
}
