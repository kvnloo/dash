import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_HARNESS_IDS, isCatalogHarness } from "./catalog";

describe("harness catalog", () => {
  test("shared ids match harnesses/catalog.json", () => {
    const raw: unknown = JSON.parse(readFileSync(join(import.meta.dir, "../harnesses/catalog.json"), "utf8"));
    if (typeof raw !== "object" || raw === null || !("ids" in raw) || !Array.isArray(raw.ids)) {
      throw new Error("catalog.json must be { ids: string[] }");
    }
    expect(raw.ids).toEqual([...CATALOG_HARNESS_IDS]);
  });

  test("omp is a catalog harness; unknown ids fail closed", () => {
    expect(isCatalogHarness("omp")).toBe(true);
    expect(isCatalogHarness("cursor-cloud")).toBe(false);
    expect(isCatalogHarness("a2a")).toBe(false);
  });
});
