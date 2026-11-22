import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isTailnetIPv4 } from "./bridge-security";
import { configuredPeerIdentity, type PeerIdentity } from "./peer-identity";
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

/**
 * Peers come from Tailscale discovery. Each one is reached with its explicit entry in
 * peer-roster-tokens.json or, failing that, a z0bridge `dash:chat` access token
 * (DASH_PEER_IDENTITY_FILE, see peer-identity.ts) that any bridge trusting the same
 * z0bridge accepts: a new host needs no second pairing.
 */
export function peerRosterCollector(identity: PeerIdentity | undefined = configuredPeerIdentity()) {
  let cache: RemoteRosterCache = {};
  let pending: ReturnType<typeof collectRemoteAgents> | undefined;
  return async () => {
    if (pending) return pending;
    const tokens = credentials();
    const nodes = parseTailscaleStatus(readTailscaleStatus()).filter(node => !node.self && !isPhoneOs(node.os));
    let minted: string | undefined;
    if (identity && nodes.some(node => Object.getOwnPropertyDescriptor(tokens, dnsLabel(node.dnsName, node.hostName)) === undefined)) {
      // A refused or unreachable z0bridge leaves those peers undiscovered, as a missing token does.
      try { minted = await identity.token(); } catch { minted = undefined; }
    }
    const peers = nodes.flatMap(node => {
      const hostId = dnsLabel(node.dnsName, node.hostName);
      // Ambiguous discovery identities cannot be entrusted with a credential.
      if (nodes.filter(other => dnsLabel(other.dnsName, other.hostName) === hostId).length !== 1) return [];
      const explicit = Object.getOwnPropertyDescriptor(tokens, hostId);
      const raw: unknown = explicit ? explicit.value : minted;
      const token = typeof raw === "string" ? raw : record(raw) ? raw.token : undefined;
      const port = record(raw) && raw.port !== undefined ? raw.port : explicit || !identity ? 4747 : identity.port;
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
