/** Catalog harness ids. Keep in lockstep with `harnesses/catalog.json`. */
export const CATALOG_HARNESS_IDS = ["omp", "codex", "grok", "claude", "hermes"] as const;

export type CatalogHarnessId = (typeof CATALOG_HARNESS_IDS)[number];

export function isCatalogHarness(id: string): id is CatalogHarnessId {
  for (const item of CATALOG_HARNESS_IDS) {
    if (item === id) return true;
  }
  return false;
}
