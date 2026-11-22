import { EPHEMERAL_DATA_BY_KIND, type EphemeralKind } from "../vendor/ephemeral-ui/kinds.generated";

/** Card gallery paging and props comparison (screens/GalleryScreen.tsx). */
export const GALLERY_PAGE_SIZE = 6;
export const galleryPages = (fixtures: number): number => Math.max(1, Math.ceil(fixtures / GALLERY_PAGE_SIZE));
/** 1-based page that holds the fixture at a 0-based catalog index. */
export const galleryPageOf = (index: number): number => Math.floor(Math.max(0, index) / GALLERY_PAGE_SIZE) + 1;

export type GalleryResult = { ok: boolean; match: boolean; diff: string[]; synthetic: string[] };

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const parse = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };

/** Top-level prop keys whose values differ between two key-sorted props JSON strings. */
export function propsDiff(expected: string, actual: string): string[] {
  if (expected === actual) return [];
  const a = parse(expected), b = parse(actual);
  if (!record(a) || !record(b)) return ["props"];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}

/**
 * Props the card copies from a kit data file Dash replaces with a synthetic stand-in (scripts/ephemeral-kit/
 * synthetic.mjs keeps the kit's sanitized measurements out of Dash): ops boards copy the snapshot's capture time
 * and provenance into their spec. Only these keys, only for these kinds, may differ from the catalog.
 */
const SYNTHETIC_PROPS: Partial<Record<"trace" | "intent" | "ops", readonly string[]>> = { ops: ["capturedAt", "provenance"] };

/** Compare a drawn card's props with its catalog fixture's. `synthetic`: differing keys explained by synthetic data. */
export function catalogParity(kind: EphemeralKind, expected: string, actual: string | null): { match: boolean; diff: string[]; synthetic: string[] } {
  if (actual === null) return { match: false, diff: ["props"], synthetic: [] };
  const all = propsDiff(expected, actual);
  const source = EPHEMERAL_DATA_BY_KIND[kind];
  const allowed = source ? SYNTHETIC_PROPS[source] ?? [] : [];
  const diff = all.filter(k => !allowed.includes(k)), synthetic = all.filter(k => allowed.includes(k));
  return { match: diff.length === 0, diff, synthetic };
}
