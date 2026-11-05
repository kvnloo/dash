import { readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { LiveOwner } from "./hermes-owner";

/**
 * Whether a live session lease belongs to a Hermes gateway (one agent, many viewers) or to a
 * standalone process that runs its own agent.
 *
 * Current Hermes runs every classic CLI and TUI turn inside the profile's gateway: the CLI is a
 * thin viewer (`hermes_cli/gateway_agent.py`) that writes a `cli` lease under its own pid and
 * holds a loopback WebSocket to the gateway. Desktop, TUI, ACP and other viewers submit into the
 * same gateway FIFO (`prompt.submit`), so a second client must send there, not wait.
 *
 * Evidence, read-only, from `/proc` and Hermes's own `gateway_state.json`:
 *   - the lease pid IS a running gateway that serves this profile, or
 *   - the lease pid holds an ESTABLISHED loopback TCP connection to a port that gateway listens on.
 * Anything else (no gateway, no connection, unreadable `/proc`) is `standalone`: Dash keeps the
 * ordered handoff for a process that may write the session itself.
 */
export type OwnerHosting = "gateway" | "standalone";

export type GatewayHostProbe = {
  /** Running Hermes gateway pids that serve `profileId` (whose home is `profileHome`). */
  gatewayPids(profileId: string, profileHome: string): number[];
  /** True when `ownerPid` holds an established loopback connection to a port `gatewayPid` listens on. */
  connectedTo(ownerPid: number, gatewayPid: number): boolean;
};

/**
 * `authoritySession`: the target is a native session-authority chat (SessionDB `source = 'local'`,
 * id `local-…`). Only the gateway writes those; a CLI viewer whose WebSocket is idle or dropped
 * still has no agent of its own, so with a serving gateway running the session is gateway-hosted.
 */
export function ownerHosting(owner: LiveOwner, profileId: string, profileHome: string, probe: GatewayHostProbe, authoritySession = false): OwnerHosting {
  let gateways: number[];
  try { gateways = probe.gatewayPids(profileId, profileHome); } catch { return "standalone"; }
  if (gateways.length === 0) return "standalone";
  for (const pid of gateways) {
    if (owner.pid === pid) return "gateway";
    try { if (probe.connectedTo(owner.pid, pid)) return "gateway"; } catch { /* no evidence */ }
  }
  return authoritySession ? "gateway" : "standalone";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function real(path: string): string | undefined {
  try { return realpathSync(path); } catch { return undefined; }
}

/**
 * Gateway pids from `<home>/gateway_state.json` for each candidate home (the profile's own and the
 * root multiplexer's). A gateway serves the profile when its `hermes_home` is the profile home or
 * it lists the profile in `served_profiles`.
 */
export function readGatewayPids(homes: string[], profileId: string, profileHome: string, alive: (pid: number) => boolean): number[] {
  const want = real(profileHome);
  const pids: number[] = [];
  for (const home of homes) {
    let state: unknown;
    try { state = JSON.parse(readFileSync(join(home, "gateway_state.json"), "utf8")); } catch { continue; }
    if (!record(state) || state.kind !== "hermes-gateway" || state.gateway_state !== "running") continue;
    const pid = typeof state.pid === "number" && Number.isInteger(state.pid) && state.pid > 0 ? state.pid : undefined;
    if (pid === undefined || pids.includes(pid) || !alive(pid)) continue;
    const served = Array.isArray(state.served_profiles) && state.served_profiles.includes(profileId);
    const ownHome = typeof state.hermes_home === "string" && want !== undefined && real(state.hermes_home) === want;
    if (served || ownHome) pids.push(pid);
  }
  return pids;
}

export type TcpRow = { localPort: number; remoteLoopback: boolean; remotePort: number; state: string; inode: string };

const LOOPBACK = new Set(["0100007F", "00000000000000000000000001000000", "0000000000000000FFFF00000100007F"]);

/** Rows of `/proc/<pid>/net/tcp{,6}`. Addresses are hex `ADDR:PORT`; state 0A = LISTEN, 01 = ESTABLISHED. */
export function parseProcTcp(text: string): TcpRow[] {
  const rows: TcpRow[] = [];
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    const [, local, remote, state, , , , , , inode] = f;
    const [, lport] = (local ?? "").split(":");
    const [raddr, rport] = (remote ?? "").split(":");
    const localPort = parseInt(lport ?? "", 16);
    const remotePort = parseInt(rport ?? "", 16);
    if (!Number.isFinite(localPort) || !Number.isFinite(remotePort) || !state || !inode) continue;
    rows.push({ localPort, remoteLoopback: LOOPBACK.has((raddr ?? "").toUpperCase()), remotePort, state, inode });
  }
  return rows;
}

function socketInodes(pid: number): Set<string> {
  const inodes = new Set<string>();
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try { const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${pid}/fd/${fd}`)); if (m?.[1]) inodes.add(m[1]); } catch { /* fd closed */ }
  }
  return inodes;
}

function tcpRows(pid: number): TcpRow[] {
  const rows: TcpRow[] = [];
  for (const name of ["tcp", "tcp6"]) { try { rows.push(...parseProcTcp(readFileSync(`/proc/${pid}/net/${name}`, "utf8"))); } catch { /* no table */ } }
  return rows;
}

/** Pure core of `connectedTo`: the owner's established loopback sockets against the gateway's listeners. */
export function connectedVia(rows: TcpRow[], ownerInodes: Set<string>, gatewayInodes: Set<string>): boolean {
  const listening = new Set(rows.filter(r => r.state === "0A" && gatewayInodes.has(r.inode)).map(r => r.localPort));
  if (listening.size === 0) return false;
  return rows.some(r => r.state === "01" && ownerInodes.has(r.inode) && r.remoteLoopback && listening.has(r.remotePort));
}

export function hostGatewayProbe(rootHome: string, alive: (pid: number) => boolean): GatewayHostProbe {
  return {
    gatewayPids: (profileId, profileHome) => readGatewayPids([profileHome, rootHome], profileId, profileHome, alive),
    connectedTo: (ownerPid, gatewayPid) => {
      const owner = socketInodes(ownerPid);
      if (owner.size === 0) return false;
      // Same network namespace: the owner's table lists both ends of its loopback connection.
      return connectedVia(tcpRows(ownerPid), owner, socketInodes(gatewayPid));
    },
  };
}
