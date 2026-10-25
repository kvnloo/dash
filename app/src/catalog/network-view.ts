import pinnedCatalog from "./aodl-catalog.json";
import { AODL_NETWORK_IDS, parseAodlCatalog, type AodlNetworkId } from "./orchestra";

export type AodlHarnessId =
  | "hermes" | "omp" | "o8" | "grok" | "codex" | "claude" | "pi" | "fx";

export const AODL_HARNESS_IDS: readonly AodlHarnessId[] = [
  "hermes", "omp", "o8", "grok", "codex", "claude", "pi", "fx",
];

export interface CatalogHarness {
  id: AodlHarnessId;
  name: string;
  kind: "executor" | "control-room";
  repo: string;
  dash: "wired" | "none";
}

export interface CatalogNetworkNode {
  id: AodlNetworkId;
  repo: string;
  owns: string;
  /** Only declared Dash wiring or an exact harness-repository match. No inferred edges. */
  linkedHarnessIds: AodlHarnessId[];
}

export interface AodlNetworkView {
  nodes: CatalogNetworkNode[];
  harnesses: CatalogHarness[];
  distro: { id: "firstmate"; name: string };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid AODL " + label);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Invalid AODL " + label);
  }
  return value;
}

function repoUrl(value: unknown, label: string): string {
  const url = text(value, label);
  if (!url.startsWith("https://github.com/")) throw new Error("Invalid AODL repo URL: " + label);
  return url;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).length !== expected.length ||
      Object.keys(value).some((id) => !expected.includes(id))) {
    throw new Error("Unknown or missing AODL " + label + " ids");
  }
}

/** A read-only projection of AODL's pinned catalog, never observed runtime evidence. */
export function networkViewFromCatalog(raw: unknown): AodlNetworkView {
  const source = record(raw, "catalog");
  const parsed = parseAodlCatalog(raw);
  if (parsed.schemaVersion !== 1) throw new Error("Unsupported AODL catalog version");
  const network = record(source.network, "network");
  const harnessesRaw = record(source.harnesses, "harnesses");
  const distros = record(source.distros, "distros");
  exactKeys(network, AODL_NETWORK_IDS, "network");
  exactKeys(harnessesRaw, AODL_HARNESS_IDS, "harness");
  exactKeys(distros, ["firstmate"], "distro");

  const supported: unknown = source.supported;
  if (!Array.isArray(supported) || supported.length !== AODL_HARNESS_IDS.length ||
      new Set(supported).size !== AODL_HARNESS_IDS.length ||
      supported.some((id: unknown) => typeof id !== "string" || !AODL_HARNESS_IDS.includes(id))) {
    throw new Error("Unknown or missing AODL supported harness ids");
  }

  const distro = record(distros.firstmate, "firstmate");
  if (distro.kind !== "distro") throw new Error("firstmate must be a distro");

  const harnesses: CatalogHarness[] = AODL_HARNESS_IDS.map((id) => {
    const row = record(harnessesRaw[id], "harness " + id);
    const info = parsed.harnesses.get(id);
    if (!info) throw new Error("Missing AODL harness " + id);
    const dash: unknown = row.dash;
    if (dash !== "wired" && dash !== "none") throw new Error("Unknown Dash wiring: " + id);
    if (id === "o8" && info.kind !== "control-room") throw new Error("o8 must be a control room");
    if (id !== "o8" && info.kind !== "executor") throw new Error("Unknown harness kind: " + id);
    return {
      id,
      name: info.name,
      kind: info.kind,
      repo: repoUrl(row.repo, "harness " + id),
      dash,
    };
  });

  const nodes: CatalogNetworkNode[] = AODL_NETWORK_IDS.map((id) => {
    const node = parsed.network.get(id);
    if (!node) throw new Error("Missing AODL network node " + id);
    const repo = repoUrl(node.repo, "network " + id);
    return {
      id,
      repo,
      owns: node.owns,
      linkedHarnessIds: harnesses.filter((harness) =>
        harness.kind === "executor" &&
        (id === "dash" ? harness.dash === "wired" : harness.repo === repo),
      ).map((harness) => harness.id),
    };
  });

  return { nodes, harnesses, distro: { id: "firstmate", name: text(distro.name, "firstmate.name") } };
}

export function loadAodlNetworkView(): AodlNetworkView {
  const source: unknown = pinnedCatalog;
  return networkViewFromCatalog(source);
}
