import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compileTopology,
  harnessLookOrUnspecified,
  loadVisualCatalog,
  matchOwnerRule,
  resolveModel,
  resolveProvider,
  resolveRuntimeState,
  resolveTopology,
  runtimeStateFromLive,
} from "./visual";

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

  test("ownerRules map catalog harness prefixes onto visual.json hues and cores", () => {
    const catalog = loadVisualCatalog();
    const codex = matchOwnerRule(catalog, "codex");
    expect(codex.provider).toBe("openai");
    expect(codex.model).toBe("codex");
    expect(resolveProvider(catalog, codex.provider).hue).toBe("#54d7c2");
    expect(resolveModel(catalog, codex.model).core).toBe("lattice");

    const grok = matchOwnerRule(catalog, "grok");
    expect(grok.provider).toBe("xai");
    expect(grok.model).toBe("grok");
    expect(resolveProvider(catalog, grok.provider).hue).toBe("#d875ef");
    expect(resolveModel(catalog, grok.model).core).toBe("flare");

    const sol = matchOwnerRule(catalog, "codex-sol");
    expect(sol.model).toBe("codex-sol");
    expect(resolveModel(catalog, sol.model).core).toBe("lattice");
    expect(resolveModel(catalog, sol.model).accent).toBe("#f2c75f");
  });

  test("fails closed on unknown provider, model, and owner ids", () => {
    const catalog = loadVisualCatalog();
    expect(() => resolveProvider(catalog, "omp")).toThrow(/unknown/i);
    expect(() => resolveProvider(catalog, "openavatar")).toThrow(/unknown/i);
    expect(() => resolveModel(catalog, "claude")).toThrow(/unknown/i);
    expect(() => resolveModel(catalog, "sigil")).toThrow(/unknown/i);
    expect(() => matchOwnerRule(catalog, "omp")).toThrow(/unknown/i);
    expect(() => matchOwnerRule(catalog, "claude")).toThrow(/unknown/i);
    expect(() => matchOwnerRule(catalog, "openavatar")).toThrow(/unknown/i);
    expect(() => matchOwnerRule(catalog, "host")).toThrow(/unknown/i);
  });

  test("unspecified harnesses use the declared unknown look, not an invented silhouette", () => {
    const catalog = loadVisualCatalog();
    const omp = harnessLookOrUnspecified(catalog, "omp");
    const claude = harnessLookOrUnspecified(catalog, "claude");
    const invented = harnessLookOrUnspecified(catalog, "openavatar");
    expect(omp.provider.id).toBe("unknown");
    expect(omp.model.core).toBe("plain");
    expect(claude.provider.hue).toBe("#9ca39a");
    expect(invented.model.id).toBe("unknown");
    expect(omp.model.core).not.toBe("sigil");
    const mapped = harnessLookOrUnspecified(catalog, "codex");
    expect(mapped.provider.id).toBe("openai");
    expect(mapped.model.core).toBe("lattice");
    const grok = harnessLookOrUnspecified(catalog, "grok");
    expect(grok.provider.id).toBe("xai");
    expect(grok.model.core).toBe("flare");
  });

  test("live session cadence maps onto declared runtimeStates and fails closed otherwise", () => {
    const catalog = loadVisualCatalog();
    expect(runtimeStateFromLive({ assistantState: "streaming" })).toBe("running");
    expect(runtimeStateFromLive({ assistantState: "error" })).toBe("blocked");
    expect(runtimeStateFromLive({ assistantState: "interrupted" })).toBe("paused");
    expect(runtimeStateFromLive({ assistantState: "pending" })).toBe("claimed");
    expect(runtimeStateFromLive({ online: false })).toBe("paused");
    expect(runtimeStateFromLive({ online: true })).toBe("running");
    expect(runtimeStateFromLive({})).toBe("unknown");
    expect(() => runtimeStateFromLive({ assistantState: "thinking" })).toThrow(/unknown/i);
    expect(resolveRuntimeState(catalog, "running").marker).toBe("flow");
    expect(() => resolveRuntimeState(catalog, "done")).toThrow(/unknown/i);
  });

  test("Orchestra cards draw TopologyBadge, not HarnessAvatar letters", () => {
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/OrchestraPane.tsx"), "utf8");
    const detail = readFileSync(join(import.meta.dir, "../screens/OrchestraDetailScreen.tsx"), "utf8");
    const badge = readFileSync(join(import.meta.dir, "../components/TopologyBadge.tsx"), "utf8");
    expect(pane).toContain("TopologyBadge");
    expect(pane).not.toContain("HarnessAvatar");
    expect(detail).toContain("TopologyBadge");
    expect(badge).toContain("topology-graphs.json");
    expect(badge).not.toContain("OpenAvatar");
  });

  test("Chats, Bots, live rows, and search consume visual.json cores instead of letter-in-circle avatars", () => {
    const avatar = readFileSync(join(import.meta.dir, "../components/HarnessAvatar.tsx"), "utf8");
    const chats = readFileSync(join(import.meta.dir, "../screens/panes/ChatsPane.tsx"), "utf8");
    const bots = readFileSync(join(import.meta.dir, "../screens/panes/BotsPane.tsx"), "utf8");
    const conversations = readFileSync(join(import.meta.dir, "../screens/ConversationsScreen.tsx"), "utf8");
    const search = readFileSync(join(import.meta.dir, "../components/SearchResultRow.tsx"), "utf8");
    const detail = readFileSync(join(import.meta.dir, "../screens/OrchestraDetailScreen.tsx"), "utf8");
    expect(avatar).toContain("harnessLookOrUnspecified");
    expect(avatar).toContain("VisualCore");
    expect(avatar).not.toContain("trim()[0]");
    expect(avatar).not.toContain("OpenAvatar");
    expect(chats).toContain("harnessId={");
    expect(bots).toContain("harnessId={profile.harness}");
    expect(conversations).toContain("harnessId={");
    expect(search).toContain("TopologyBadge");
    expect(search).toContain("harnessId");
    expect(detail).toContain("harnessId={harnessId}");
    const picker = readFileSync(join(import.meta.dir, "../components/HarnessPicker.tsx"), "utf8");
    expect(picker).toContain("harnessId={h.id}");
  });
});
