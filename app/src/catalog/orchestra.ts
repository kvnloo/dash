/**
 * Pinned from kvnloo/aodl@8e41ef024262339d28a968d71113fc52819d4bd4
 * harnesses/catalog.json blob daecbb11a30af9ca4975912455576bcb10a7952c
 * Do not fetch at runtime. Unknown ids fail closed.
 */
import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import pinnedCatalog from "./aodl-catalog.json";

export const AODL_NETWORK_IDS = [
  "aodl",
  "dash",
  "frontier-kb",
  "hermes-keel",
  "hermes-agent",
  "blueprint",
  "evolve",
] as const;

export type AodlNetworkId = (typeof AODL_NETWORK_IDS)[number];

const FORBIDDEN_GRAPH_IDS = new Set(["o8", "firstmate"]);

/** Catalog commit timestamp — orchestra rows are the product graph, not live jobs. */
const CATALOG_UPDATED_AT = Date.parse("2026-09-10T21:02:33Z");

export interface OrchestraProject {
  id: string;
  name: string;
  subtitle: string;
  agents: string[];
  chatIds: string[];
  status: "active" | "idle" | "paused";
  updatedAt: number;
  topologyId: string;
  providerId: string;
}

export interface AodlHarness {
  id: string;
  name: string;
  kind: "executor" | "control-room";
}

export interface AodlNetworkNode {
  id: AodlNetworkId;
  repo: string;
  owns: string;
}

export interface AodlCatalog {
  schemaVersion: number;
  harnesses: Map<string, AodlHarness>;
  network: Map<AodlNetworkId, AodlNetworkNode>;
}

class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

function fail(message: string): never {
  throw new CatalogError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNetworkId(id: string): id is AodlNetworkId {
  for (const known of AODL_NETWORK_IDS) {
    if (known === id) return true;
  }
  return false;
}
function readString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(`Unknown or invalid field ${label}.${key}`);
  }
  return value;
}

function parseHarnessKind(value: unknown, id: string): "executor" | "control-room" {
  if (value === "executor" || value === "control-room") return value;
  fail(`Unknown harness kind for ${id}`);
}

function parseHarnesses(raw: unknown): Map<string, AodlHarness> {
  if (!isRecord(raw)) fail("Unknown catalog.harnesses");
  const out = new Map<string, AodlHarness>();
  for (const id of Object.keys(raw)) {
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown harness ${id}`);
    out.set(id, {
      id,
      name: readString(row, "name", `harnesses.${id}`),
      kind: parseHarnessKind(row.kind, id),
    });
  }
  return out;
}

function parseNetwork(raw: unknown): Map<AodlNetworkId, AodlNetworkNode> {
  if (!isRecord(raw)) fail("Unknown catalog.network");
  const out = new Map<AodlNetworkId, AodlNetworkNode>();
  for (const id of Object.keys(raw)) {
    if (FORBIDDEN_GRAPH_IDS.has(id) || !isNetworkId(id)) {
      fail(`Unknown network id: ${id}`);
    }
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown network node ${id}`);
    out.set(id, {
      id,
      repo: readString(row, "repo", `network.${id}`),
      owns: readString(row, "owns", `network.${id}`),
    });
  }
  return out;
}

export function parseAodlCatalog(raw: unknown): AodlCatalog {
  if (!isRecord(raw)) fail("Unknown catalog");
  if (typeof raw.schemaVersion !== "number") fail("Unknown catalog.schemaVersion");
  return {
    schemaVersion: raw.schemaVersion,
    harnesses: parseHarnesses(raw.harnesses),
    network: parseNetwork(raw.network),
  };
}

export function orchestrasFromCatalog(catalog: AodlCatalog): OrchestraProject[] {
  const rows: OrchestraProject[] = [];
  for (const id of AODL_NETWORK_IDS) {
    const node = catalog.network.get(id);
    if (!node) continue;
    rows.push({
      id: node.id,
      name: node.id,
      subtitle: node.owns,
      agents: [],
      chatIds: [],
      status: "idle",
      updatedAt: CATALOG_UPDATED_AT,
      topologyId: "unknown",
      providerId: "unknown",
    });
  }
  return rows;
}

export function getOrchestra(catalog: AodlCatalog, id: string): OrchestraProject {
  if (!isNetworkId(id) || FORBIDDEN_GRAPH_IDS.has(id) || !catalog.network.has(id)) {
    fail(`Unknown id: ${id}`);
  }
  const rows = orchestrasFromCatalog(catalog);
  const row = rows.find((item) => item.id === id);
  if (!row) fail(`Unknown id: ${id}`);
  return row;
}

export function loadAodlOrchestras(): OrchestraProject[] {
  const raw: unknown = pinnedCatalog;
  return orchestrasFromCatalog(parseAodlCatalog(raw));
}

function cwdMatches(cwd: string | undefined, nodeId: string): boolean {
  if (!cwd) return false;
  const parts = cwd.replace(/\\/g, "/").split("/").filter((part) => part.length > 0);
  return parts.some((part) => part === nodeId);
}

function nameMatches(agent: AgentInfo, nodeId: string): boolean {
  const needle = nodeId.toLowerCase();
  return agent.name.toLowerCase() === needle || agent.kind.toLowerCase() === needle || agent.id.toLowerCase() === needle;
}

function isRunning(agent: AgentInfo): boolean {
  return agent.status === "running";
}

function isHermesOrGateway(agent: AgentInfo): boolean {
  if (!isRunning(agent)) return false;
  const kind = agent.kind.toLowerCase();
  const id = agent.id.toLowerCase();
  const name = agent.name.toLowerCase();
  return kind === "hermes" || kind === "gateway" || id.includes("gateway") || name.includes("gateway");
}

function uniqueKinds(agents: AgentInfo[]): string[] {
  const seen = new Set<string>();
  const kinds: string[] = [];
  for (const agent of agents) {
    if (seen.has(agent.kind)) continue;
    seen.add(agent.kind);
    kinds.push(agent.kind);
  }
  return kinds;
}

function dashAgents(hosts: HostInfo[]): string[] {
  const self = hosts.find((row) => row.self);
  if (!self?.online) return [];
  return uniqueKinds(self.agents.filter((agent) => isRunning(agent) && cwdMatches(agent.cwd, "dash")));
}

function hermesAgents(hosts: HostInfo[]): string[] {
  const matched: AgentInfo[] = [];
  for (const host of hosts) {
    for (const agent of host.agents) {
      if (isHermesOrGateway(agent)) matched.push(agent);
    }
  }
  return uniqueKinds(matched);
}

function matchingAgents(hosts: HostInfo[], nodeId: AodlNetworkId): string[] {
  const matched: AgentInfo[] = [];
  for (const host of hosts) {
    for (const agent of host.agents) {
      if (!isRunning(agent)) continue;
      if (cwdMatches(agent.cwd, nodeId) || nameMatches(agent, nodeId)) matched.push(agent);
    }
  }
  return uniqueKinds(matched);
}

export function hydrateOrchestras(rows: OrchestraProject[], hosts: HostInfo[], now: number): OrchestraProject[] {
  const byId = new Map<string, OrchestraProject>();
  for (const row of rows) {
    if (!isNetworkId(row.id) || FORBIDDEN_GRAPH_IDS.has(row.id)) continue;
    byId.set(row.id, row);
  }
  const out: OrchestraProject[] = [];
  for (const id of AODL_NETWORK_IDS) {
    const row = byId.get(id);
    if (!row) continue;
    let agents: string[] = [];
    if (id === "dash") agents = dashAgents(hosts);
    else if (id === "hermes-agent") agents = hermesAgents(hosts);
    else agents = matchingAgents(hosts, id);
    const active = agents.length > 0;
    out.push({
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      topologyId: row.topologyId,
      providerId: row.providerId,
      agents,
      chatIds: [],
      status: active ? "active" : "idle",
      updatedAt: active ? now : row.updatedAt,
    });
  }
  return out;
}
