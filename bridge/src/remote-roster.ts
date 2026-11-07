import type { AgentInfo } from "../../shared/protocol";

export interface RemoteRosterPeer {
  hostId: string;
  address: string;
}

/** Last validated, successful reply per peer. Failure fallbacks never refresh this timestamp. */
export interface RemoteRosterCacheEntry {
  readonly agents: readonly AgentInfo[];
  readonly lastGoodAt: number;
}

export type RemoteRosterCache = Readonly<Record<string, RemoteRosterCacheEntry>>;
export type RemoteRosterError = {
  hostId: string;
  reason: "timeout" | "invalid" | "unreachable";
};

export interface CollectRemoteAgentsInput {
  peers: readonly RemoteRosterPeer[];
  fetchPeer: (peer: RemoteRosterPeer) => Promise<unknown>;
  now: () => number;
  timeoutMs?: number;
  previous?: RemoteRosterCache;
}

export interface CollectRemoteAgentsResult {
  remoteAgents: Record<string, AgentInfo[]>;
  cache: RemoteRosterCache;
  errors: RemoteRosterError[];
}

const DEFAULT_TIMEOUT_MS = 2_500;
const FRESH_FOR_MS = 60_000;
const FORGET_AFTER_MS = 10 * 60_000;
const MAX_AGENTS_PER_PEER = 2_000;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function agentStatus(value: unknown): value is AgentInfo["status"] {
  return value === "running" || value === "available" || value === "offline";
}

function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

/** Do not spread a peer-provided object into trusted protocol state. */
function parseAgent(raw: unknown, hostId: string): AgentInfo | undefined {
  if (!record(raw) || !nonempty(raw.id) || !nonempty(raw.kind) || !agentStatus(raw.status)) return undefined;
  if (raw.name !== undefined && !nonempty(raw.name)) return undefined;
  if (
    !optionalText(raw.detail) ||
    !optionalText(raw.cwd) ||
    !optionalText(raw.sessionId) ||
    !optionalText(raw.profileId) ||
    !optionalText(raw.source) ||
    !optionalText(raw.openIn) ||
    !optionalNumber(raw.lastActivityAt) ||
    !optionalNumber(raw.messageCount)
  ) return undefined;

  const agent: AgentInfo = {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.id,
    kind: raw.kind,
    status: raw.status,
    hostId,
  };
  if (typeof raw.detail === "string") agent.detail = raw.detail;
  if (typeof raw.cwd === "string") agent.cwd = raw.cwd;
  if (typeof raw.sessionId === "string") agent.sessionId = raw.sessionId;
  if (typeof raw.profileId === "string") agent.profileId = raw.profileId;
  if (typeof raw.source === "string") agent.source = raw.source;
  if (typeof raw.openIn === "string") agent.openIn = raw.openIn;
  if (typeof raw.lastActivityAt === "number") agent.lastActivityAt = raw.lastActivityAt;
  if (typeof raw.messageCount === "number") agent.messageCount = raw.messageCount;
  return agent;
}

/** A peer's /roster envelope includes every host; only its own host is authoritative. */
function peerRows(reply: unknown): unknown[] | undefined {
  if (!record(reply)) return undefined;
  if ("hosts" in reply) {
    if (!Array.isArray(reply.hosts)) return undefined;
    const own = reply.hosts.find((host: unknown) => record(host) && host.self === true);
    return record(own) && Array.isArray(own.agents) ? own.agents : undefined;
  }
  return Array.isArray(reply.agents) ? reply.agents : undefined;
}

function newer(next: AgentInfo, current: AgentInfo): boolean {
  return (next.lastActivityAt ?? -Infinity) > (current.lastActivityAt ?? -Infinity);
}

function retainNewest(map: Map<string, AgentInfo>, key: string, agent: AgentInfo): void {
  const previous = map.get(key);
  if (!previous || newer(agent, previous)) map.set(key, agent);
}

/**
 * First collapse matching harness-native sessions, then collapse matching agent ids.
 * Preserve first-seen order on timestamp ties and bound the final output, not raw input.
 */
function dedupeRows(rows: unknown[], hostId: string): { agents: AgentInfo[]; invalid: boolean } {
  const bySession = new Map<string, AgentInfo>();
  const withoutSession = new Map<string, AgentInfo>();
  let invalid = false;
  for (const raw of rows) {
    const agent = parseAgent(raw, hostId);
    if (!agent) {
      invalid = true;
      continue;
    }
    if (agent.sessionId) {
      retainNewest(bySession, JSON.stringify([agent.kind, agent.sessionId]), agent);
    } else {
      retainNewest(withoutSession, agent.id, agent);
    }
  }

  const byId = new Map<string, AgentInfo>();
  for (const agent of [...bySession.values(), ...withoutSession.values()]) {
    retainNewest(byId, agent.id, agent);
  }
  if (byId.size > MAX_AGENTS_PER_PEER) invalid = true;
  return { agents: [...byId.values()].slice(0, MAX_AGENTS_PER_PEER), invalid };
}

type FetchOutcome =
  | { kind: "ok"; reply: unknown }
  | { kind: "timeout" }
  | { kind: "unreachable" };

/** Both real elapsed time and an injected clock deadline constrain each request. */
async function boundedFetch(
  peer: RemoteRosterPeer,
  fetchPeer: CollectRemoteAgentsInput["fetchPeer"],
  now: () => number,
  timeoutMs: number,
): Promise<FetchOutcome> {
  if (timeoutMs === 0) return { kind: "timeout" };
  const deadline = now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fetchResult: Promise<FetchOutcome> = Promise.resolve()
    .then(() => fetchPeer(peer))
    .then<FetchOutcome, FetchOutcome>(
      reply => ({ kind: "ok", reply }),
      () => ({ kind: "unreachable" }),
    );
  const timeoutResult = new Promise<FetchOutcome>(resolve => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  try {
    const outcome = await Promise.race([fetchResult, timeoutResult]);
    return outcome.kind !== "timeout" && now() > deadline ? { kind: "timeout" } : outcome;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Collect peer bridge snapshots without mutating input, previous cache or local roster.
 * A syntactically valid empty list replaces old sessions; malformed replies do not.
 */
export async function collectRemoteAgents(input: CollectRemoteAgentsInput): Promise<CollectRemoteAgentsResult> {
  const timeoutMs = input.timeoutMs === undefined || !Number.isFinite(input.timeoutMs)
    ? DEFAULT_TIMEOUT_MS
    : Math.max(0, input.timeoutMs);

  // A host must not be fetched twice or mixed with a different address in one cycle.
  const uniquePeers = new Map<string, RemoteRosterPeer>();
  for (const peer of input.peers) {
    if (nonempty(peer.hostId) && nonempty(peer.address) && !uniquePeers.has(peer.hostId)) {
      uniquePeers.set(peer.hostId, peer);
    }
  }
  const oldCache = new Map<string, RemoteRosterCacheEntry>(Object.entries(input.previous ?? {}));
  const results = await Promise.all([...uniquePeers.values()].map(async peer => ({
    peer,
    outcome: await boundedFetch(peer, input.fetchPeer, input.now, timeoutMs),
    at: input.now(),
  })));

  const agentsByHost = new Map<string, AgentInfo[]>();
  const cacheByHost = new Map<string, RemoteRosterCacheEntry>();
  const errors: RemoteRosterError[] = [];

  for (const { peer, outcome, at } of results) {
    const hostId = peer.hostId;
    if (outcome.kind === "ok") {
      const rows = peerRows(outcome.reply);
      if (rows !== undefined) {
        const parsed = dedupeRows(rows, hostId);
        if (parsed.invalid) errors.push({ hostId, reason: "invalid" });
        if (parsed.agents.length > 0 || !parsed.invalid) {
          agentsByHost.set(hostId, parsed.agents);
          cacheByHost.set(hostId, { agents: parsed.agents, lastGoodAt: at });
          continue;
        }
      } else {
        errors.push({ hostId, reason: "invalid" });
      }
    } else {
      errors.push({ hostId, reason: outcome.kind });
    }

    // A broken reply cannot silently erase a recently verified session roster.
    const previous = oldCache.get(hostId);
    if (!previous) continue;
    const age = Math.max(0, at - previous.lastGoodAt);
    if (age >= FORGET_AFTER_MS) continue;
    cacheByHost.set(hostId, previous);
    agentsByHost.set(hostId, previous.agents.slice(0, MAX_AGENTS_PER_PEER).map(agent => ({
      ...agent,
      hostId,
      status: age > FRESH_FOR_MS ? "offline" : agent.status,
    })));
  }

  return {
    remoteAgents: Object.fromEntries(agentsByHost),
    cache: Object.fromEntries(cacheByHost),
    errors,
  };
}
