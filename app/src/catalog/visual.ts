/**
 * Pinned from kvnloo/aodl@8e41ef024262339d28a968d71113fc52819d4bd4
 * encodings/visual.json, encodings/ir-map.json, encodings/topology-graphs.json
 * Do not fetch at runtime. Unknown ids and not-inferred silhouettes fail closed.
 * Do not infer topology from drawing density.
 */
import irMapJson from "./encodings/ir-map.json";
import topologyGraphsJson from "./encodings/topology-graphs.json";
import visualJson from "./encodings/visual.json";

export type IrTopologyStatus = "expressible" | "not-inferred" | "unspecified";

export interface VisualTopology {
  id: string;
  label: string;
  description: string;
  pattern: string;
  satellites: number;
  power: number;
  nodeAccent: string;
}

export interface VisualProvider {
  id: string;
  label: string;
  hue: string;
}

export interface VisualModel {
  id: string;
  label: string;
  core: string;
  accent: string;
}

export interface VisualEffort {
  id: string;
  label: string;
  orbits: number;
  energy: number;
  accent: string;
}

export interface VisualOperatingMode {
  id: string;
  label: string;
  marker: string;
  accent: string;
  motion: string;
}

export interface VisualRuntimeState {
  id: string;
  label: string;
  marker: string;
  accent: string;
}

export interface OwnerRule {
  prefix: string;
  provider: string;
  model: string;
  effort: string;
}

export interface TopologyGraph {
  nodes: Array<[number, number, number]>;
  edges: Array<[number, number]>;
  envelope: string | undefined;
  center: string | undefined;
  directed: boolean;
  soft: boolean;
}

export interface CompiledTopology {
  id: string;
  status: "expressible";
}

export interface HarnessLook {
  provider: VisualProvider;
  model: VisualModel;
  effort: VisualEffort;
}

export interface VisualCatalog {
  topologies: Map<string, VisualTopology>;
  providers: Map<string, VisualProvider>;
  models: Map<string, VisualModel>;
  efforts: Map<string, VisualEffort>;
  operatingModes: Map<string, VisualOperatingMode>;
  runtimeStates: Map<string, VisualRuntimeState>;
  ownerRules: OwnerRule[];
  graphs: Map<string, TopologyGraph>;
  ir: Map<string, IrTopologyStatus>;
  irStatus(id: string): IrTopologyStatus;
  graph(pattern: string): TopologyGraph;
  inferTopology(nodeCount: number, edgeCount: number): never;
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

function readString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) fail(`Unknown or invalid field ${label}.${key}`);
  return value;
}

function readNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`Unknown or invalid field ${label}.${key}`);
  return value;
}

function readStatus(value: unknown, id: string): IrTopologyStatus {
  if (value === "expressible" || value === "not-inferred" || value === "unspecified") return value;
  fail(`Unknown ir-map status for ${id}`);
}

function parsePair(raw: unknown, label: string): [number, number] {
  if (!Array.isArray(raw) || raw.length !== 2) fail(`Unknown ${label}`);
  const a = raw[0];
  const b = raw[1];
  if (typeof a !== "number" || typeof b !== "number") fail(`Unknown ${label}`);
  return [a, b];
}

function parseTriple(raw: unknown, label: string): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3) fail(`Unknown ${label}`);
  const a = raw[0];
  const b = raw[1];
  const c = raw[2];
  if (typeof a !== "number" || typeof b !== "number" || typeof c !== "number") fail(`Unknown ${label}`);
  return [a, b, c];
}

function parseTopologies(raw: unknown): Map<string, VisualTopology> {
  if (!isRecord(raw)) fail("Unknown visual.topologies");
  const out = new Map<string, VisualTopology>();
  for (const id of Object.keys(raw)) {
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown topology ${id}`);
    out.set(id, {
      id,
      label: readString(row, "label", `topologies.${id}`),
      description: readString(row, "description", `topologies.${id}`),
      pattern: readString(row, "pattern", `topologies.${id}`),
      satellites: readNumber(row, "satellites", `topologies.${id}`),
      power: readNumber(row, "power", `topologies.${id}`),
      nodeAccent: readString(row, "nodeAccent", `topologies.${id}`),
    });
  }
  return out;
}

function parseProviders(raw: unknown): Map<string, VisualProvider> {
  if (!isRecord(raw)) fail("Unknown visual.providers");
  const out = new Map<string, VisualProvider>();
  for (const id of Object.keys(raw)) {
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown provider ${id}`);
    out.set(id, {
      id,
      label: readString(row, "label", `providers.${id}`),
      hue: readString(row, "hue", `providers.${id}`),
    });
  }
  return out;
}

function parseModels(raw: unknown): Map<string, VisualModel> {
  if (!isRecord(raw)) fail("Unknown visual.models");
  const out = new Map<string, VisualModel>();
  for (const id of Object.keys(raw)) {
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown model ${id}`);
    out.set(id, {
      id,
      label: readString(row, "label", `models.${id}`),
      core: readString(row, "core", `models.${id}`),
      accent: readString(row, "accent", `models.${id}`),
    });
  }
  return out;
}

function parseEfforts(raw: unknown): Map<string, VisualEffort> {
  if (!isRecord(raw)) fail("Unknown visual.efforts");
  const out = new Map<string, VisualEffort>();
  for (const id of Object.keys(raw)) {
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown effort ${id}`);
    out.set(id, {
      id,
      label: readString(row, "label", `efforts.${id}`),
      orbits: readNumber(row, "orbits", `efforts.${id}`),
      energy: readNumber(row, "energy", `efforts.${id}`),
      accent: readString(row, "accent", `efforts.${id}`),
    });
  }
  return out;
}

function parseOperatingModes(raw: unknown): Map<string, VisualOperatingMode> {
  if (!isRecord(raw)) fail("Unknown visual.operatingModes");
  const out = new Map<string, VisualOperatingMode>();
  for (const id of Object.keys(raw)) {
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown operatingMode ${id}`);
    out.set(id, {
      id,
      label: readString(row, "label", `operatingModes.${id}`),
      marker: readString(row, "marker", `operatingModes.${id}`),
      accent: readString(row, "accent", `operatingModes.${id}`),
      motion: readString(row, "motion", `operatingModes.${id}`),
    });
  }
  return out;
}

function parseRuntimeStates(raw: unknown): Map<string, VisualRuntimeState> {
  if (!isRecord(raw)) fail("Unknown visual.runtimeStates");
  const out = new Map<string, VisualRuntimeState>();
  for (const id of Object.keys(raw)) {
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown runtimeState ${id}`);
    out.set(id, {
      id,
      label: readString(row, "label", `runtimeStates.${id}`),
      marker: readString(row, "marker", `runtimeStates.${id}`),
      accent: readString(row, "accent", `runtimeStates.${id}`),
    });
  }
  return out;
}

function parseOwnerRules(raw: unknown): OwnerRule[] {
  if (!Array.isArray(raw)) fail("Unknown visual.ownerRules");
  const out: OwnerRule[] = [];
  for (const [index, row] of raw.entries()) {
    if (!isRecord(row)) fail(`Unknown ownerRule ${index}`);
    out.push({
      prefix: readString(row, "prefix", `ownerRules.${index}`),
      provider: readString(row, "provider", `ownerRules.${index}`),
      model: readString(row, "model", `ownerRules.${index}`),
      effort: readString(row, "effort", `ownerRules.${index}`),
    });
  }
  return out;
}

function parseGraphs(raw: unknown): Map<string, TopologyGraph> {
  if (!isRecord(raw)) fail("Unknown topology-graphs");
  const out = new Map<string, TopologyGraph>();
  for (const id of Object.keys(raw)) {
    const row = raw[id];
    if (!isRecord(row)) fail(`Unknown graph ${id}`);
    if (!Array.isArray(row.nodes) || !Array.isArray(row.edges)) fail(`Unknown graph ${id}`);
    const envelope = typeof row.envelope === "string" ? row.envelope : undefined;
    const center = typeof row.center === "string" ? row.center : undefined;
    out.set(id, {
      nodes: row.nodes.map((node, index) => parseTriple(node, `graphs.${id}.nodes.${index}`)),
      edges: row.edges.map((edge, index) => parsePair(edge, `graphs.${id}.edges.${index}`)),
      envelope,
      center,
      directed: row.directed === true,
      soft: row.soft === true,
    });
  }
  return out;
}

function parseIr(raw: unknown): Map<string, IrTopologyStatus> {
  if (!isRecord(raw)) fail("Unknown ir-map");
  if (!isRecord(raw.topologies)) fail("Unknown ir-map.topologies");
  const out = new Map<string, IrTopologyStatus>();
  for (const id of Object.keys(raw.topologies)) {
    const row = raw.topologies[id];
    if (!isRecord(row)) fail(`Unknown ir-map topology ${id}`);
    out.set(id, readStatus(row.status, id));
  }
  return out;
}

export function parseVisualCatalog(visualRaw: unknown, irRaw: unknown, graphsRaw: unknown): VisualCatalog {
  if (!isRecord(visualRaw)) fail("Unknown visual catalog");
  const topologies = parseTopologies(visualRaw.topologies);
  const providers = parseProviders(visualRaw.providers);
  const models = parseModels(visualRaw.models);
  const efforts = parseEfforts(visualRaw.efforts);
  const operatingModes = parseOperatingModes(visualRaw.operatingModes);
  const runtimeStates = parseRuntimeStates(visualRaw.runtimeStates);
  const ownerRules = parseOwnerRules(visualRaw.ownerRules);
  const graphs = parseGraphs(graphsRaw);
  const ir = parseIr(irRaw);
  for (const id of topologies.keys()) {
    if (!ir.has(id)) fail(`Unknown ir-map row for topology ${id}`);
    const topology = topologies.get(id);
    if (!topology) fail(`Unknown topology ${id}`);
    if (!graphs.has(topology.pattern)) fail(`Unknown topology graph ${topology.pattern}`);
  }
  for (const rule of ownerRules) {
    if (!providers.has(rule.provider)) fail(`Unknown ownerRule provider ${rule.provider}`);
    if (!models.has(rule.model)) fail(`Unknown ownerRule model ${rule.model}`);
    if (!efforts.has(rule.effort)) fail(`Unknown ownerRule effort ${rule.effort}`);
  }
  return {
    topologies,
    providers,
    models,
    efforts,
    operatingModes,
    runtimeStates,
    ownerRules,
    graphs,
    ir,
    irStatus(id: string): IrTopologyStatus {
      const status = ir.get(id);
      if (!status) fail(`Unknown topology id: ${id}`);
      return status;
    },
    graph(pattern: string): TopologyGraph {
      const found = graphs.get(pattern);
      if (!found) fail(`Unknown topology graph: ${pattern}`);
      return found;
    },
    inferTopology(_nodeCount: number, _edgeCount: number): never {
      fail("Topology is not inferred from drawing density; fail closed");
    },
  };
}

let cached: VisualCatalog | undefined;

export function loadVisualCatalog(): VisualCatalog {
  if (!cached) {
    const visualRaw: unknown = visualJson;
    const irRaw: unknown = irMapJson;
    const graphsRaw: unknown = topologyGraphsJson;
    cached = parseVisualCatalog(visualRaw, irRaw, graphsRaw);
  }
  return cached;
}

export function resolveTopology(catalog: VisualCatalog, id: string): VisualTopology {
  const topology = catalog.topologies.get(id);
  if (!topology) fail(`Unknown topology id: ${id}`);
  return topology;
}

export function resolveProvider(catalog: VisualCatalog, id: string): VisualProvider {
  const provider = catalog.providers.get(id);
  if (!provider) fail(`Unknown provider id: ${id}`);
  return provider;
}

export function resolveModel(catalog: VisualCatalog, id: string): VisualModel {
  const model = catalog.models.get(id);
  if (!model) fail(`Unknown model id: ${id}`);
  return model;
}

export function resolveEffort(catalog: VisualCatalog, id: string): VisualEffort {
  const effort = catalog.efforts.get(id);
  if (!effort) fail(`Unknown effort id: ${id}`);
  return effort;
}

export function resolveOperatingMode(catalog: VisualCatalog, id: string): VisualOperatingMode {
  const mode = catalog.operatingModes.get(id);
  if (!mode) fail(`Unknown operatingMode id: ${id}`);
  return mode;
}

export function resolveRuntimeState(catalog: VisualCatalog, id: string): VisualRuntimeState {
  const state = catalog.runtimeStates.get(id);
  if (!state) fail(`Unknown runtimeState id: ${id}`);
  return state;
}

export function compileTopology(catalog: VisualCatalog, id: string): CompiledTopology {
  const topology = resolveTopology(catalog, id);
  const status = catalog.irStatus(id);
  if (status !== "expressible") {
    fail(`Fail closed: topology ${id} is ${status}`);
  }
  return { id: topology.id, status };
}

export function matchOwnerRule(catalog: VisualCatalog, owner: string): OwnerRule {
  let best: OwnerRule | undefined;
  for (const rule of catalog.ownerRules) {
    if (owner === rule.prefix || owner.startsWith(`${rule.prefix}-`) || owner.startsWith(rule.prefix)) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  if (!best) fail(`Unknown owner prefix: ${owner}`);
  return best;
}

export function harnessLook(catalog: VisualCatalog, owner: string): HarnessLook {
  const rule = matchOwnerRule(catalog, owner);
  return {
    provider: resolveProvider(catalog, rule.provider),
    model: resolveModel(catalog, rule.model),
    effort: resolveEffort(catalog, rule.effort),
  };
}

export function harnessLookOrUnspecified(catalog: VisualCatalog, owner: string): HarnessLook {
  try {
    return harnessLook(catalog, owner);
  } catch {
    return {
      provider: resolveProvider(catalog, "unknown"),
      model: resolveModel(catalog, "unknown"),
      effort: resolveEffort(catalog, "unknown"),
    };
  }
}

export function runtimeStateFromLive(input: { assistantState?: string; online?: boolean }): string {
  if (input.assistantState !== undefined) {
    if (input.assistantState === "pending") return "claimed";
    if (input.assistantState === "streaming") return "running";
    if (input.assistantState === "done") return "unknown";
    if (input.assistantState === "error") return "blocked";
    if (input.assistantState === "interrupted") return "paused";
    fail(`Unknown assistant state: ${input.assistantState}`);
  }
  if (input.online === false) return "paused";
  if (input.online === true) return "running";
  return "unknown";
}
