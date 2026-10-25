import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadVisualCatalog,
  resolveHarnessVisual,
  resolveModel,
  resolveOperatingMode,
  resolveProvider,
} from "./visual";

describe("issue #21: AODL harness identity", () => {
  test("model ids and geometry come from pinned visual.json, not a second image catalog", () => {
    const catalog = loadVisualCatalog();
    expect(resolveModel(catalog, "codex").core).toBe("lattice");
    expect(resolveModel(catalog, "grok").core).toBe("flare");
    expect(resolveModel(catalog, "claude-haiku").core).toBe("facet");
    expect(resolveModel(catalog, "multi").core).toBe("linked");
    expect(resolveModel(catalog, "unknown").core).toBe("plain");
    expect(resolveProvider(catalog, "openai").hue).toBe("#54d7c2");
    expect(resolveProvider(catalog, "xai").hue).toBe("#d875ef");
    expect(() => resolveModel(catalog, "unspecified-fake-model")).toThrow(/unknown model/i);
    expect(() => resolveProvider(catalog, "unspecified-fake-provider")).toThrow(/unknown provider/i);
  });

  test("known harnesses select only a declared model/core and canonical provider hue", () => {
    const codex = resolveHarnessVisual({ harnessId: "codex" });
    expect([codex.provider.id, codex.model.id, codex.model.core]).toEqual(["openai", "codex", "lattice"]);
    const grok = resolveHarnessVisual({ harnessId: "grok" });
    expect([grok.provider.id, grok.model.id, grok.model.core]).toEqual(["xai", "grok", "flare"]);
    const claude = resolveHarnessVisual({ harnessId: "claude" });
    expect([claude.provider.id, claude.model.id, claude.model.core]).toEqual(["anthropic", "unknown", "plain"]);
    const omp = resolveHarnessVisual({ harnessId: "omp" });
    expect([omp.provider.id, omp.model.id, omp.model.core]).toEqual(["multi", "unknown", "plain"]);
    // A generic Claude/OMP harness cannot truthfully claim Haiku or any active model.
    expect(resolveHarnessVisual({ harnessId: "claude", modelId: "claude-haiku" }).model.core).toBe("facet");
    expect(resolveHarnessVisual({ harnessId: "omp", modelId: "multi" }).model.core).toBe("linked");
    expect(resolveHarnessVisual({ harnessId: "codex", modelId: "codex-sol" }).model.accent).toBe("#f2c75f");
  });

  test("unknown ids, provider mismatches, and undeclared models fail closed", () => {
    const unknown = resolveHarnessVisual({ harnessId: "not-a-harness", modelId: "codex" });
    expect([unknown.provider.id, unknown.model.id, unknown.model.core]).toEqual(["unknown", "unknown", "plain"]);
    expect(resolveHarnessVisual({ harnessId: "codex", modelId: "grok" }).model.id).toBe("unknown");
    expect(resolveHarnessVisual({ harnessId: "claude", modelId: "grok" }).model.id).toBe("unknown");
    expect(resolveHarnessVisual({ harnessId: "claude", modelId: "imaginary" }).model.id).toBe("unknown");
    expect(resolveHarnessVisual({ harnessId: "" }).provider.id).toBe("unknown");
  });

  test("only declared, IR-expressible topology may appear; never infer swarm/unknown", () => {
    expect(resolveHarnessVisual({ harnessId: "codex", topologyId: "pipeline" }).topologyId).toBe("pipeline");
    expect(resolveHarnessVisual({ harnessId: "codex", topologyId: "swarm" }).topologyId).toBeUndefined();
    expect(resolveHarnessVisual({ harnessId: "codex", topologyId: "hybrid" }).topologyId).toBeUndefined();
    expect(resolveHarnessVisual({ harnessId: "codex", topologyId: "unknown" }).topologyId).toBeUndefined();
    expect(resolveHarnessVisual({ harnessId: "codex", topologyId: "made-up" }).topologyId).toBeUndefined();
    expect(resolveHarnessVisual({ harnessId: "codex" }).topologyId).toBeUndefined();
  });

  test("effort, state, operating mode and economic perimeter remain distinct channels", () => {
    const active = resolveHarnessVisual({
      harnessId: "codex", effortId: "max", stateId: "running",
      operatingModeId: "copilot", valueScore: 0,
    });
    expect([active.effort.orbits, active.effort.energy]).toEqual([4, 1]);
    expect(active.state.label).toBe("Running");
    expect(active.state.cadence).toMatchObject({ periodMs: 900, rotate: true });
    expect(active.operatingMode.marker).toBe("link");
    expect(active.valueScore).toBe(0);
    expect(resolveOperatingMode(loadVisualCatalog(), "does-not-exist").id).toBe("unknown");
    const unknown = resolveHarnessVisual({ harnessId: "codex", effortId: "bogus", stateId: "bogus", operatingModeId: "bogus" });
    expect([unknown.effort.id, unknown.state.id, unknown.operatingMode.id, unknown.valueScore]).toEqual(["unknown", "unknown", "unknown", null]);
    for (const score of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveHarnessVisual({ harnessId: "codex", valueScore: score }).valueScore).toBeNull();
    }
    expect(resolveHarnessVisual({ harnessId: "codex", valueScore: 100 }).valueScore).toBe(100);
  });

  test("real component wiring consumes the resolved channels, not static orb assets", () => {
    const avatar = readFileSync(join(import.meta.dir, "../components/HarnessAvatar.tsx"), "utf8");
    const core = readFileSync(join(import.meta.dir, "../components/HarnessVisualCore.tsx"), "utf8");
    const search = readFileSync(join(import.meta.dir, "../components/SearchResultRow.tsx"), "utf8");
    expect(avatar).toContain("resolveHarnessVisual");
    expect(avatar).toContain("<HarnessVisualCore");
    expect(avatar).toContain("stateId,");
    expect(avatar).not.toContain("require(");
    expect(core).toContain("look.model.core");
    expect(core).toContain("look.provider.hue");
    expect(core).toContain("look.effort.orbits");
    expect(core).toContain("look.state.label");
    expect(core).toContain("look.operatingMode.marker");
    expect(core).toContain('look.valueScore === null ? "dashed" : "solid"');
    expect(core).toContain("reduceMotionChanged");
    expect(core).toContain("useNativeDriver: true");
    expect(search).toContain("stateId={motion.stateId}");
    expect(search).toContain("effortId={motion.effortId}");
  });
});
