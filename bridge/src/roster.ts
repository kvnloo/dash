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

const PHONE_OS = new Set(["android", "ios", "ipados", "tvos"]);

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

export function assembleRoster(input: {
  nodes: TailscaleNode[];
  ompTabs: OmpTab[];
  harnesses: HarnessInfo[];
  selfFallback: { hostname: string; address?: string };
}): HostInfo[] {
  const computers = input.nodes.filter((n) => !isPhoneOs(n.os));
  const hosts: HostInfo[] = computers.map((node) => nodeToHost(node, input));
  if (!hosts.some((h) => h.self)) {
    hosts.unshift(selfHost(input.selfFallback.hostname, input.selfFallback.address, input.ompTabs, input.harnesses));
  }
  hosts.sort((a, b) => Number(b.self) - Number(a.self) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return hosts;
}

function nodeToHost(node: TailscaleNode, input: Parameters<typeof assembleRoster>[0]): HostInfo {
  const name = dnsLabel(node.dnsName, node.hostName);
  const v4 = node.ips.find((ip) => ip.includes(".")) ?? node.ips[0];
  const agents = node.self
    ? selfAgents(input.ompTabs, input.harnesses)
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

function peerAgents(id: string, hostname: string): AgentInfo[] {
  if (id === "0" || hostname.toLowerCase() === "groot") {
    return [{ id: "hermes", name: "Hermes", kind: "hermes", status: "running", detail: "Mesh node" }];
  }
  return [];
}

function selfHost(hostname: string, address: string | undefined, tabs: OmpTab[], harnesses: HarnessInfo[]): HostInfo {
  return {
    id: hostname,
    name: hostname,
    hostname,
    online: true,
    self: true,
    address,
    agents: selfAgents(tabs, harnesses),
  };
}

function selfAgents(tabs: OmpTab[], harnesses: HarnessInfo[]): AgentInfo[] {
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
  for (const h of harnesses) {
    if (h.id === "omp") continue;
    agents.push({
      id: `harness:${h.id}`,
      name: h.name,
      kind: h.id,
      status: h.available ? "available" : "offline",
      detail: h.available ? "Installed" : "Not installed",
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

export function readTailscaleStatus(): unknown {
  try {
    const result = Bun.spawnSync(["tailscale", "status", "--json"], { stdout: "pipe", stderr: "ignore" });
    if (result.exitCode !== 0) return null;
    return JSON.parse(result.stdout.toString()) as unknown;
  } catch {
    return null;
  }
}

export function collectRoster(harnesses: HarnessInfo[], self: { hostname: string; address?: string }): HostInfo[] {
  const nodes = parseTailscaleStatus(readTailscaleStatus());
  const ompTabs = liveOmpFromDaemonRoot(join(homedir(), ".omp", "run", "daemons"), pidAlive);
  return assembleRoster({ nodes, ompTabs, harnesses, selfFallback: self });
}
