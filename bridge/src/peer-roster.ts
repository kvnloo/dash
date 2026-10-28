import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isTailnetIPv4 } from "./bridge-security";
import { collectRemoteAgents, type RemoteRosterCache } from "./remote-roster";
import { dnsLabel, isPhoneOs, parseTailscaleStatus, readTailscaleStatus } from "./roster";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Explicitly paired peer credentials only; never forward this bridge's local token. */
function credentials(): Record<string, unknown> {
  try {
    const path = join(process.env.DASH_CREDENTIAL_DIR ?? join(homedir(), ".dash"), "peer-roster-tokens.json");
    const info = statSync(path);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) return {};
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    return record(raw) ? raw : {};
  } catch { return {}; }
}

export function peerRosterCollector() {
  let cache: RemoteRosterCache = {};
  let pending: ReturnType<typeof collectRemoteAgents> | undefined;
  return async () => {
    if (pending) return pending;
    const tokens = credentials();
    const nodes = parseTailscaleStatus(readTailscaleStatus()).filter(node => !node.self && !isPhoneOs(node.os));
    const peers = nodes.flatMap(node => {
      const hostId = dnsLabel(node.dnsName, node.hostName);
      // Ambiguous discovery identities cannot be entrusted with a credential.
      if (nodes.filter(other => dnsLabel(other.dnsName, other.hostName) === hostId).length !== 1) return [];
      const raw: unknown = Object.getOwnPropertyDescriptor(tokens, hostId)?.value;
      const token = typeof raw === "string" ? raw : record(raw) ? raw.token : undefined;
      const port = record(raw) && raw.port !== undefined ? raw.port : 4747;
      const address = node.ips.find(ip => isTailnetIPv4(ip) || (process.env.DASH_ALLOW_LOOPBACK === "1" && ip === "127.0.0.1"));
      if (!address || typeof token !== "string" || token.length < 16 || typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return [];
      return [{ hostId, address, token, port, online: node.online }];
    });
    pending = collectRemoteAgents({
      peers, previous: cache, now: Date.now,
      fetchPeer: async peer => {
        const authorized = peers.find(candidate => candidate.hostId === peer.hostId);
        if (!authorized?.online) throw new Error("Peer offline");
        const response = await fetch(`http://${peer.address}:${authorized.port}/roster?local=1`, {
          headers: { Authorization: `Bearer ${authorized.token}` },
          redirect: "error",
          signal: AbortSignal.timeout(2500),
        });
        if (!response.ok) throw new Error(`Peer roster HTTP ${response.status}`);
        return response.json();
      },
    });
    try {
      const result = await pending;
      cache = result.cache;
      return result;
    } finally { pending = undefined; }
  };
}
