import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentInfo, HostInfo } from "../../../shared/protocol";
import {
  AODL_NETWORK_IDS,
  getOrchestra,
  hydrateOrchestras,
  loadAodlOrchestras,
  orchestrasFromCatalog,
  parseAodlCatalog,
  type OrchestraProject,
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

  test("maps owns onto subtitle and never pins live agents or active status", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get("dash")?.subtitle).toBe("phone UI + Tailscale bridge that spawns executor CLIs");
    expect(byId.get("frontier-kb")?.name).toBe("frontier-kb");
    for (const row of rows) {
      expect(row.status).toBe("idle");
      expect(row.agents).toEqual([]);
      expect(row.chatIds).toEqual([]);
    }
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

  test("Orchestra UI hydrates from connection.hosts, not DEMO_ORCHESTRAS", () => {
    const pane = readFileSync(join(import.meta.dir, "../screens/panes/OrchestraPane.tsx"), "utf8");
    const detail = readFileSync(join(import.meta.dir, "../screens/OrchestraDetailScreen.tsx"), "utf8");
    const mock = readFileSync(join(import.meta.dir, "../mock/orchestra.ts"), "utf8");
    const search = readFileSync(join(import.meta.dir, "../lib/global-search.ts"), "utf8");
    const scenarios = readFileSync(join(import.meta.dir, "../debug/scenarios.ts"), "utf8");
    expect(pane).toContain("loadAodlOrchestras");
    expect(pane).toContain("hydrateOrchestras");
    expect(pane).toContain("connection.hosts");
    expect(pane).not.toContain("DEMO_ORCHESTRAS");
    expect(detail).toContain("loadAodlOrchestras");
    expect(detail).toContain("hydrateOrchestras");
    expect(detail).toContain("connection.hosts");
    expect(detail).not.toContain("DEMO_ORCHESTRAS");
    expect(search).toContain("loadAodlOrchestras");
    expect(search).not.toContain("DEMO_ORCHESTRAS");
    expect(mock).not.toContain("orch-dash");
    expect(mock).not.toContain("DEMO_ORCHESTRAS");
    expect(scenarios).toContain('orchestraId: "dash"');
    expect(scenarios).not.toContain("orch-dash");
  });
});

function host(partial: Omit<HostInfo, "name" | "hostname" | "online" | "self" | "agents"> & Partial<HostInfo>): HostInfo {
  return {
    name: partial.name ?? partial.id,
    hostname: partial.hostname ?? partial.id,
    online: partial.online ?? true,
    self: partial.self ?? false,
    agents: partial.agents ?? [],
    address: partial.address,
    id: partial.id,
  };
}

function agent(partial: Omit<AgentInfo, "name" | "kind" | "status"> & Partial<AgentInfo>): AgentInfo {
  return {
    name: partial.name ?? partial.id,
    kind: partial.kind ?? "omp",
    status: partial.status ?? "running",
    detail: partial.detail,
    cwd: partial.cwd,
    id: partial.id,
  };
}

function byId(rows: OrchestraProject[]): Map<string, OrchestraProject> {
  return new Map(rows.map((row) => [row.id, row]));
}

describe("hydrateOrchestras", () => {
  const NOW = 1_700_000_000_000;

  test("empty hosts leave every pinned node idle", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    const hydrated = hydrateOrchestras(rows, [], NOW);
    expect(hydrated.map((row) => row.id)).toEqual([...PINNED_NETWORK_IDS]);
    for (const row of hydrated) {
      expect(row.status).toBe("idle");
      expect(row.agents).toEqual([]);
      expect(row.chatIds).toEqual([]);
    }
  });

  test("dash is active only when the self host is online with a running dash cwd", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    const self = host({
      id: "mbp",
      self: true,
      agents: [
        agent({ id: "omp:dash", kind: "omp", cwd: "/home/you/workspace/dash" }),
        agent({ id: "omp:other", kind: "omp", cwd: "/home/you/workspace/keyconf.gen" }),
      ],
    });
    const live = byId(hydrateOrchestras(rows, [self], NOW));
    expect(live.get("dash")?.status).toBe("active");
    expect(live.get("dash")?.agents).toEqual(["omp"]);
    expect(live.get("dash")?.chatIds).toEqual([]);
    expect(live.get("dash")?.updatedAt).toBe(NOW);
    expect(live.get("aodl")?.status).toBe("idle");
    expect(live.get("hermes-agent")?.status).toBe("idle");
  });

  test("dash stays idle when self is offline or the matching agent is not running", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    const offline = host({
      id: "mbp",
      self: true,
      online: false,
      agents: [agent({ id: "omp:dash", kind: "omp", cwd: "/home/you/workspace/dash" })],
    });
    expect(byId(hydrateOrchestras(rows, [offline], NOW)).get("dash")?.status).toBe("idle");

    const installed = host({
      id: "mbp",
      self: true,
      agents: [agent({ id: "harness:omp", kind: "omp", status: "available", cwd: "/home/you/workspace/dash" })],
    });
    expect(byId(hydrateOrchestras(rows, [installed], NOW)).get("dash")?.status).toBe("idle");

    const peer = host({
      id: "groot",
      self: false,
      agents: [agent({ id: "omp:dash", kind: "omp", cwd: "/home/you/workspace/dash" })],
    });
    expect(byId(hydrateOrchestras(rows, [peer], NOW)).get("dash")?.status).toBe("idle");
  });

  test("hermes-agent is active iff a running hermes or gateway is on the roster", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    const hermes = host({
      id: "groot",
      agents: [agent({ id: "a2a:hermes", name: "Hermes", kind: "hermes" })],
    });
    const withHermes = byId(hydrateOrchestras(rows, [hermes], NOW));
    expect(withHermes.get("hermes-agent")?.status).toBe("active");
    expect(withHermes.get("hermes-agent")?.agents).toEqual(["hermes"]);
    expect(withHermes.get("hermes-keel")?.status).toBe("idle");
    expect(withHermes.get("dash")?.status).toBe("idle");

    const gateway = host({
      id: "mbp",
      self: true,
      agents: [agent({ id: "hermes:default", name: "gateway", kind: "hermes" })],
    });
    expect(byId(hydrateOrchestras(rows, [gateway], NOW)).get("hermes-agent")?.status).toBe("active");

    const stopped = host({
      id: "mbp",
      self: true,
      agents: [agent({ id: "a2a:hermes", name: "Hermes", kind: "hermes", status: "offline" })],
    });
    expect(byId(hydrateOrchestras(rows, [stopped], NOW)).get("hermes-agent")?.status).toBe("idle");
  });

  test("aodl frontier-kb blueprint evolve stay idle unless a running cwd or name matches", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    const matches = host({
      id: "mbp",
      self: true,
      agents: [
        agent({ id: "omp:aodl", kind: "omp", cwd: "/home/you/workspace/aodl" }),
        agent({ id: "codex:kb", kind: "codex", name: "frontier-kb", cwd: "/tmp/notes" }),
        agent({ id: "omp:blueprint", kind: "omp", cwd: "/opt/blueprint" }),
        agent({ id: "claude:evolve", kind: "claude", cwd: "/home/you/evolve" }),
      ],
    });
    const live = byId(hydrateOrchestras(rows, [matches], NOW));
    expect(live.get("aodl")?.status).toBe("active");
    expect(live.get("aodl")?.agents).toEqual(["omp"]);
    expect(live.get("frontier-kb")?.status).toBe("active");
    expect(live.get("frontier-kb")?.agents).toEqual(["codex"]);
    expect(live.get("blueprint")?.status).toBe("active");
    expect(live.get("evolve")?.status).toBe("active");
    expect(live.get("dash")?.status).toBe("idle");
    expect(live.get("hermes-keel")?.status).toBe("idle");
  });

  test("fails closed on orch-dash and o8 even if callers smuggle them in", () => {
    const rows = orchestrasFromCatalog(parseAodlCatalog(fixture()));
    const smuggled: OrchestraProject[] = [
      ...rows,
      {
        id: "orch-dash",
        name: "Dash",
        subtitle: "demo",
        agents: ["omp"],
        chatIds: ["demo-omp"],
        status: "active",
        updatedAt: NOW,
        topologyId: "unknown",
        providerId: "unknown",
      },
      {
        id: "o8",
        name: "o8",
        subtitle: "control room",
        agents: ["o8"],
        chatIds: [],
        status: "active",
        updatedAt: NOW,
        topologyId: "unknown",
        providerId: "unknown",
      },
    ];
    const self = host({
      id: "mbp",
      self: true,
      agents: [
        agent({ id: "omp:dash", kind: "omp", cwd: "/home/you/workspace/dash" }),
        agent({ id: "o8", kind: "o8", name: "o8", cwd: "/opt/o8" }),
      ],
    });
    const hydrated = hydrateOrchestras(smuggled, [self], NOW);
    expect(hydrated.map((row) => row.id)).toEqual([...PINNED_NETWORK_IDS]);
    expect(hydrated.map((row) => row.id)).not.toContain("orch-dash");
    expect(hydrated.map((row) => row.id)).not.toContain("o8");
    expect(hydrated.every((row) => row.status !== "paused")).toBe(true);
  });
});

