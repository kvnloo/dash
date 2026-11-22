/** Card gallery paging and props comparison (screens/GalleryScreen.tsx). */
export const GALLERY_PAGE_SIZE = 6;
export const galleryPages = (fixtures: number): number => Math.max(1, Math.ceil(fixtures / GALLERY_PAGE_SIZE));
/** 1-based page that holds the fixture at a 0-based catalog index. */
export const galleryPageOf = (index: number): number => Math.floor(Math.max(0, index) / GALLERY_PAGE_SIZE) + 1;

export type GalleryResult = { ok: boolean; match: boolean; diff: string[] };

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const parse = (s: string): unknown => { try { return JSON.parse(s); } catch { return undefined; } };

/** Top-level prop keys whose values differ between two key-sorted props JSON strings. */
export function propsDiff(expected: string, actual: string): string[] {
  if (expected === actual) return [];
  const a = parse(expected), b = parse(actual);
  if (!record(a) || !record(b)) return ["props"];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}
