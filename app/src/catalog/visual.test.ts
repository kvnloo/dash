import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAodlOrchestras } from "./orchestra";
import { compileTopology, loadVisualCatalog, providerIdForHarness, resolveTopology } from "./visual";

describe("AODL visual encodings", () => {
  test("pins visual.json topology ids and ir-map statuses", () => {
    const catalog = loadVisualCatalog();
    expect([...catalog.topologies.keys()]).toEqual([
      "solo",
      "paired",
      "council",
      "hierarchy",
      "mesh",
      "ring",
      "star",
      "swarm",
      "cluster",
      "parallel",
      "pipeline",
      "supervisor",
      "blackboard",
      "marketplace",
      "hybrid",
      "unknown",
    ]);
    expect(catalog.irStatus("pipeline")).toBe("expressible");
    expect(catalog.irStatus("swarm")).toBe("not-inferred");
    expect(catalog.irStatus("hybrid")).toBe("not-inferred");
    expect(catalog.irStatus("unknown")).toBe("unspecified");
  });

  test("fails closed on unknown topology ids", () => {
    const catalog = loadVisualCatalog();
    expect(() => resolveTopology(catalog, "orch-dash")).toThrow(/unknown/i);
    expect(() => resolveTopology(catalog, "openavatar")).toThrow(/unknown/i);
    expect(() => compileTopology(catalog, "not-a-silhouette")).toThrow(/unknown/i);
  });

  test("fails closed on not-inferred and unspecified silhouettes", () => {
    const catalog = loadVisualCatalog();
    expect(() => compileTopology(catalog, "swarm")).toThrow(/not-inferred|fail closed/i);
    expect(() => compileTopology(catalog, "hybrid")).toThrow(/not-inferred|fail closed/i);
    expect(() => compileTopology(catalog, "unknown")).toThrow(/unspecified|fail closed/i);
    expect(compileTopology(catalog, "pipeline").status).toBe("expressible");
    expect(compileTopology(catalog, "star").status).toBe("expressible");
  });

  test("does not infer topology from node or edge density", () => {
    const catalog = loadVisualCatalog();
    const mesh = catalog.graph("mesh");
    const star = catalog.graph("star");
    expect(mesh.nodes.length).toBeGreaterThan(0);
    expect(star.edges.length).toBeGreaterThan(0);
    expect(() => catalog.inferTopology(mesh.nodes.length, mesh.edges.length)).toThrow(/not inferred|fail closed/i);
  });

  test("Orchestra cards draw TopologyBadge, not HarnessAvatar letters", () => {
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/OrchestraPane.tsx"), "utf8");
    const detail = readFileSync(join(import.meta.dir, "../screens/OrchestraDetailScreen.tsx"), "utf8");
    const badge = readFileSync(join(import.meta.dir, "../components/TopologyBadge.tsx"), "utf8");
    expect(pane).toContain("TopologyBadge");
    expect(pane).not.toContain("HarnessAvatar");
    expect(detail).toContain("TopologyBadge");
    expect(detail).not.toContain("HarnessAvatar");
    expect(badge).toContain("topology-graphs.json");
    expect(badge).not.toContain("OpenAvatar");
  });

  test("catalog harnesses map to visual.json providers and fail closed", () => {
    expect(providerIdForHarness("omp")).toBe("cursor");
    expect(providerIdForHarness("codex")).toBe("openai");
    expect(providerIdForHarness("grok")).toBe("xai");
    expect(providerIdForHarness("claude")).toBe("anthropic");
    expect(providerIdForHarness("not-a-harness")).toBe("unknown");
    const avatar = readFileSync(join(import.meta.dir, "../components/HarnessAvatar.tsx"), "utf8");
    expect(avatar).toContain("OrchestraCore");
    expect(avatar).toContain("providerIdForHarness");
    expect(avatar).not.toContain("toUpperCase");
  });

  test("Orchestra network nodes declare expressible topologies", () => {
    const catalog = loadVisualCatalog();
    for (const row of loadAodlOrchestras()) {
      expect(compileTopology(catalog, row.topologyId).status).toBe("expressible");
      expect(catalog.providers.has(row.providerId)).toBe(true);
    }
  });
});
