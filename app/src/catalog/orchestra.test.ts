import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AODL_NETWORK_IDS,
  getOrchestra,
  loadAodlOrchestras,
  orchestrasFromCatalog,
  parseAodlCatalog,
} from "./orchestra";

const PINNED_NETWORK_IDS = [
  "aodl",
  "dash",
  "frontier-kb",
  "hermes-keel",
  "hermes-agent",
  "blueprint",
  "evolve",
] as const;

const FORBIDDEN_GRAPH_IDS = ["o8", "firstmate", "orch-dash", "orch-mesh", "orch-auth"] as const;

function fixture(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    rule: "Unknown ids fail closed.",
    supported: ["hermes", "omp", "o8", "grok", "codex", "claude", "pi", "fx"],
    harnesses: {
      hermes: { name: "Hermes Agent", kind: "executor", dash: "wired" },
      omp: { name: "Oh My Pi", kind: "executor", dash: "wired" },
      o8: { name: "o8", kind: "control-room", dash: "none" },
      grok: { name: "Grok Build", kind: "executor", dash: "wired" },
      codex: { name: "Codex", kind: "executor", dash: "wired" },
      claude: { name: "Claude Code", kind: "executor", dash: "wired" },
      pi: { name: "Pi", kind: "executor", dash: "none" },
      fx: { name: "fx", kind: "executor", dash: "none" },
    },
    distros: {
      firstmate: { name: "firstmate", kind: "distro" },
    },
    network: {
      aodl: { repo: "https://github.com/kvnloo/aodl", owns: "IR, schema" },
      dash: { repo: "https://github.com/kvnloo/dash", owns: "phone UI + Tailscale bridge that spawns executor CLIs" },
      "frontier-kb": { repo: "https://github.com/kvnloo/frontier-kb", owns: "cross-harness research notes" },
      "hermes-keel": { repo: "https://github.com/kvnloo/hermes-keel", owns: "Hermes-only governance. Level 0 only." },
      "hermes-agent": { repo: "https://github.com/NousResearch/hermes-agent", owns: "Kanban, profiles, gateway, Telegram router" },
      blueprint: { repo: "https://github.com/kvnloo/blueprint", owns: "product goal" },
      evolve: { repo: "https://github.com/kvnloo/evolve", owns: "legacy C(RAID)/Claude Flow orchestration" },
    },
    ...overrides,
  };
}

describe("AODL orchestra catalog", () => {
  test("lists pinned network node ids, not DEMO_ORCHESTRAS orch-* ids", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    expect(rows.map((row) => row.id)).toEqual([...PINNED_NETWORK_IDS]);
    expect(AODL_NETWORK_IDS).toEqual([...PINNED_NETWORK_IDS]);
    for (const id of FORBIDDEN_GRAPH_IDS) {
      expect(rows.map((row) => row.id)).not.toContain(id);
    }
  });

  test("maps owns onto subtitle and executor harnesses onto dash agents", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("dash")?.subtitle).toBe("phone UI + Tailscale bridge that spawns executor CLIs");
    expect(byId.get("dash")?.agents).toEqual(["hermes", "omp", "grok", "codex", "claude", "pi", "fx"]);
    expect(byId.get("dash")?.agents).not.toContain("o8");
    expect(byId.get("hermes-keel")?.agents).toEqual(["hermes"]);
    expect(byId.get("hermes-agent")?.agents).toEqual(["hermes"]);
    expect(byId.get("aodl")?.agents).toEqual([]);
    expect(byId.get("frontier-kb")?.name).toBe("frontier-kb");
  });

  test("rejects unknown orchestra ids", () => {
    const catalog = parseAodlCatalog(fixture());
    expect(() => getOrchestra(catalog, "orch-dash")).toThrow(/unknown/i);
    expect(() => getOrchestra(catalog, "o8")).toThrow(/unknown/i);
    expect(() => getOrchestra(catalog, "firstmate")).toThrow(/unknown/i);
    expect(() => getOrchestra(catalog, "not-a-node")).toThrow(/unknown/i);
  });

  test("fails closed when the catalog sneaks a forbidden graph id into network", () => {
    const network = {
      aodl: { repo: "https://github.com/kvnloo/aodl", owns: "IR" },
      o8: { repo: "https://github.com/hurttlocker/o8", owns: "control room" },
    };
    expect(() => parseAodlCatalog(fixture({ network }))).toThrow(/unknown|fail closed|o8/i);
    expect(() =>
      parseAodlCatalog(
        fixture({
          network: {
            firstmate: { repo: "https://github.com/kunchenguid/firstmate", owns: "distro" },
          },
        }),
      ),
    ).toThrow(/unknown|fail closed|firstmate/i);
  });

  test("fails closed on an unknown network id", () => {
    expect(() =>
      parseAodlCatalog(
        fixture({
          network: {
            aodl: { repo: "https://github.com/kvnloo/aodl", owns: "IR" },
            "orch-dash": { repo: "https://example.invalid", owns: "demo" },
          },
        }),
      ),
    ).toThrow(/unknown/i);
  });

  test("pinned catalog copy matches AODL network ids", () => {
    const rows = loadAodlOrchestras();
    expect(rows.map((row) => row.id)).toEqual([...PINNED_NETWORK_IDS]);
    expect(rows.find((row) => row.id === "dash")?.subtitle).toContain("phone UI + Tailscale bridge");
    const raw = JSON.parse(readFileSync(join(import.meta.dir, "aodl-catalog.json"), "utf8")) as {
      network: Record<string, unknown>;
      distros: Record<string, unknown>;
      harnesses: Record<string, unknown>;
    };
    expect(Object.keys(raw.network)).toEqual([...PINNED_NETWORK_IDS]);
    expect(Object.keys(raw.distros)).toEqual(["firstmate"]);
    expect("o8" in raw.harnesses).toBe(true);
    expect("o8" in raw.network).toBe(false);
    expect("firstmate" in raw.network).toBe(false);
  });

  test("Orchestra UI reads the catalog loader, not DEMO_ORCHESTRAS", () => {
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/OrchestraPane.tsx"), "utf8");
    const detail = readFileSync(join(import.meta.dir, "../screens/OrchestraDetailScreen.tsx"), "utf8");
    const mock = readFileSync(join(import.meta.dir, "../mock/orchestra.ts"), "utf8");
    const search = readFileSync(join(import.meta.dir, "../lib/global-search.ts"), "utf8");
    const scenarios = readFileSync(join(import.meta.dir, "../debug/scenarios.ts"), "utf8");
    expect(pane).toContain("loadAodlOrchestras");
    expect(pane).not.toContain("DEMO_ORCHESTRAS");
    expect(detail).toContain("loadAodlOrchestras");
    expect(detail).not.toContain("DEMO_ORCHESTRAS");
    expect(search).toContain("loadAodlOrchestras");
    expect(search).not.toContain("DEMO_ORCHESTRAS");
    expect(mock).not.toContain("orch-dash");
    expect(mock).not.toContain("DEMO_ORCHESTRAS");
    expect(scenarios).toContain('orchestraId: "dash"');
    expect(scenarios).not.toContain("orch-dash");
  });
});

