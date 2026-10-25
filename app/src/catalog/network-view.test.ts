import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pinnedCatalog from "./aodl-catalog.json";
import { AODL_HARNESS_IDS, loadAodlNetworkView, networkViewFromCatalog } from "./network-view";
import { AODL_NETWORK_IDS } from "./orchestra";

const expectedNetwork = [
  "aodl", "dash", "frontier-kb", "hermes-keel", "hermes-agent", "blueprint", "evolve",
];
const expectedHarnesses = [
  "hermes", "omp", "o8", "grok", "codex", "claude", "pi", "fx",
];

describe("Orchestra AODL catalog projection", () => {
  test("renders exactly canonical network ids and owns, without demo or control-room nodes", () => {
    const view = loadAodlNetworkView();
    expect(view.nodes.map((node) => node.id)).toEqual(expectedNetwork);
    expect([...AODL_NETWORK_IDS]).toEqual(expectedNetwork);
    expect(view.nodes.find((node) => node.id === "aodl")?.owns).toBe(pinnedCatalog.network.aodl.owns);
    expect(view.nodes.find((node) => node.id === "dash")?.owns).toBe(pinnedCatalog.network.dash.owns);
    expect(view.nodes.find((node) => node.id === "hermes-agent")?.owns).toBe(pinnedCatalog.network["hermes-agent"].owns);
    expect(view.nodes.find((node) => node.id === "blueprint")?.owns).toBe(pinnedCatalog.network.blueprint.owns);
    expect(view.nodes.every((node) => node.owns.length > 0 && node.repo.startsWith("https://github.com/"))).toBe(true);
    for (const id of ["orch-dash", "orch-auth", "o8", "firstmate"]) {
      expect(view.nodes.some((node) => node.id === id)).toBe(false);
    }
  });

  test("links harnesses only from declared Dash wiring or exact repo identity", () => {
    const view = loadAodlNetworkView();
    expect(view.nodes.find((node) => node.id === "dash")?.linkedHarnessIds).toEqual([
      "hermes", "omp", "grok", "codex", "claude", "pi", "fx",
    ]);
    expect(view.nodes.find((node) => node.id === "hermes-agent")?.linkedHarnessIds).toEqual(["hermes"]);
    expect(view.nodes.find((node) => node.id === "hermes-keel")?.linkedHarnessIds).toEqual([]);
    expect(view.nodes.find((node) => node.id === "aodl")?.linkedHarnessIds).toEqual([]);
    expect(view.nodes.find((node) => node.id === "evolve")?.linkedHarnessIds).toEqual([]);
  });

  test("lists all eight harness ids, keeping o8 a control room and firstmate a distro", () => {
    const view = loadAodlNetworkView();
    expect([...AODL_HARNESS_IDS]).toEqual(expectedHarnesses);
    expect(view.harnesses.map((harness) => harness.id)).toEqual(expectedHarnesses);
    expect(view.harnesses.find((harness) => harness.id === "o8")?.kind).toBe("control-room");
    expect(view.distro).toEqual({ id: "firstmate", name: "firstmate" });
    expect(view.harnesses.some((harness) => harness.id === "firstmate")).toBe(false);
  });

  test("rejects unknown or missing network/harness/distro ids", () => {
    expect(() => networkViewFromCatalog({
      ...pinnedCatalog,
      network: { ...pinnedCatalog.network, "orch-auth": { repo: "https://github.com/example/auth", owns: "demo" } },
    })).toThrow(/unknown|missing/i);
    expect(() => networkViewFromCatalog({
      ...pinnedCatalog,
      network: { ...pinnedCatalog.network, o8: { repo: "https://github.com/example/o8", owns: "fake graph" } },
    })).toThrow(/unknown/i);
    expect(() => networkViewFromCatalog({
      ...pinnedCatalog,
      harnesses: { ...pinnedCatalog.harnesses, firstmate: { kind: "executor", name: "wrong" } },
    })).toThrow(/unknown|missing/i);
    expect(() => networkViewFromCatalog({
      ...pinnedCatalog,
      distros: { ...pinnedCatalog.distros, o8: { kind: "distro" } },
    })).toThrow(/unknown|missing/i);
    const { evolve: excluded, ...incompleteNetwork } = pinnedCatalog.network;
    expect(excluded.owns.length).toBeGreaterThan(0);
    expect(() => networkViewFromCatalog({
      ...pinnedCatalog, network: incompleteNetwork,
    })).toThrow(/unknown|missing/i);
  });

  test("rejects unsupported versions, malformed wiring and duplicate supported ids", () => {
    expect(() => networkViewFromCatalog({ ...pinnedCatalog, schemaVersion: 2 })).toThrow(/version/i);
    expect(() => networkViewFromCatalog({
      ...pinnedCatalog,
      supported: ["hermes", "hermes", "o8", "grok", "codex", "claude", "pi", "fx"],
    })).toThrow(/supported/i);
    expect(() => networkViewFromCatalog({
      ...pinnedCatalog,
      harnesses: { ...pinnedCatalog.harnesses, pi: { ...pinnedCatalog.harnesses.pi, dash: "probably" } },
    })).toThrow(/wiring/i);
    expect(() => networkViewFromCatalog({
      ...pinnedCatalog,
      distros: { firstmate: { ...pinnedCatalog.distros.firstmate, kind: "executor" } },
    })).toThrow(/distro/i);
  });

  test("mounts the real catalog alongside the evidence graph even without a paired bridge", () => {
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/OrchestraPane.tsx"), "utf8");
    const component = readFileSync(join(import.meta.dir, "../components/AodlCatalogNetwork.tsx"), "utf8");
    expect(pane).toContain('import { AodlCatalogNetwork }');
    expect(pane).toContain("<AodlCatalogNetwork />");
    expect(pane).toContain("<OrchestraGraph");
    expect(component).toContain("catalog.nodes.map");
    expect(component).toContain("node.owns");
    expect(component).toContain("node.linkedHarnessIds");
    expect(component).not.toContain("DEMO_ORCHESTRAS");
  });
});
