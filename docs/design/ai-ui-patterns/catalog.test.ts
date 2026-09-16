import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DASH_STATUSES = new Set(["shipped", "in-flight", "gap", "reject"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (str(item)) out.push(item);
  }
  return out;
}

function loadCatalog(): Record<string, unknown> {
  const raw: unknown = JSON.parse(
    readFileSync(join(import.meta.dir, "catalog.json"), "utf8"),
  );
  if (!isRecord(raw)) {
    throw new Error("catalog.json must be an object");
  }
  return raw;
}

describe("AI UI pattern catalog", () => {
  const catalog = loadCatalog();
  const aodl = isRecord(catalog.aodl) ? catalog.aodl : {};
  const executors = new Set(strList(aodl.executors));
  const notSpawn = new Set(strList(aodl.notSpawnTargets));
  const knownAodl = new Set([...executors, ...notSpawn]);
  const topologies = new Set(strList(aodl.topologies));
  const efforts = new Set(strList(aodl.efforts));
  const modes = new Set(strList(aodl.operatingModes));
  const states = new Set(strList(aodl.runtimeStates));

  const surfaces = Array.isArray(catalog.surfaces) ? catalog.surfaces : [];
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const patterns = Array.isArray(catalog.patterns) ? catalog.patterns : [];

  const surfaceIds = new Set<string>();
  for (const row of surfaces) {
    if (isRecord(row) && str(row.id)) surfaceIds.add(row.id);
  }
  const productIds = new Set<string>();
  for (const row of products) {
    if (isRecord(row) && str(row.id)) productIds.add(row.id);
  }

  test("schema version is 1 and lists are non-empty", () => {
    expect(catalog.schemaVersion).toBe(1);
    expect(surfaceIds.size).toBeGreaterThanOrEqual(7);
    expect(productIds.has("dash")).toBe(true);
    expect(productIds.has("t3-code")).toBe(true);
    expect(productIds.has("chatgpt")).toBe(true);
    expect(patterns.length).toBeGreaterThanOrEqual(20);
  });

  test("AODL executor list matches the spawn contract", () => {
    expect([...executors]).toEqual(["hermes", "omp", "grok", "codex", "claude", "pi", "fx"]);
    expect(notSpawn.has("o8")).toBe(true);
    expect(notSpawn.has("firstmate")).toBe(true);
    expect(executors.has("o8")).toBe(false);
  });

  test("every product aodl id is a known catalog id", () => {
    for (const row of products) {
      if (!isRecord(row)) continue;
      for (const id of strList(row.aodlIds)) {
        expect(knownAodl.has(id)).toBe(true);
      }
    }
  });

  test("pattern ids are unique and dash.status is closed", () => {
    const seen = new Set<string>();
    for (const row of patterns) {
      if (!isRecord(row)) {
        throw new Error("pattern must be an object");
      }
      expect(str(row.id)).toBe(true);
      if (!str(row.id)) continue;
      expect(seen.has(row.id)).toBe(false);
      seen.add(row.id);
      const dash = isRecord(row.dash) ? row.dash : {};
      expect(str(dash.status) && DASH_STATUSES.has(dash.status)).toBe(true);
      for (const surface of strList(row.surfaces)) {
        expect(surfaceIds.has(surface)).toBe(true);
      }
      for (const product of strList(row.products)) {
        expect(productIds.has(product)).toBe(true);
      }
      const aodlRef = isRecord(row.aodl) ? row.aodl : {};
      for (const id of strList(aodlRef.topologies)) {
        expect(topologies.has(id)).toBe(true);
      }
      for (const id of strList(aodlRef.operatingModes)) {
        expect(modes.has(id)).toBe(true);
      }
      for (const id of strList(aodlRef.runtimeStates)) {
        expect(states.has(id)).toBe(true);
      }
      for (const id of strList(aodlRef.efforts)) {
        expect(efforts.has(id)).toBe(true);
      }
    }
    expect(seen.has("docked-composer")).toBe(true);
    expect(seen.has("worktree-per-thread-board")).toBe(true);
    expect(seen.has("control-plane-not-executor")).toBe(true);
  });

  test("shipped Dash patterns name a file that exists in this repo", () => {
    const shipped = patterns.filter((row) => {
      if (!isRecord(row)) return false;
      const dash = isRecord(row.dash) ? row.dash : {};
      return dash.status === "shipped" && str(dash.where);
    });
    expect(shipped.length).toBeGreaterThan(0);
    const language = readFileSync(join(import.meta.dir, "../language.md"), "utf8");
    expect(language).toContain("ai-ui-patterns");
  });
});
