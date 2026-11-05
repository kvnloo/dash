import type { ContextSnapshot } from "./context";

/** The /context grid: 20 x 10 cells, each worth maximum / 200 tokens (the layout omp's /context draws). */
export const GRID_COLS = 20;
export const GRID_ROWS = 10;
export const GRID_CELLS = GRID_COLS * GRID_ROWS;

export type GridKind = "category" | "free" | "buffer";
/** `id` is the category id for a category cell, otherwise the kind itself. */
export type GridCell = { kind: GridKind; id: string };
export type GridLine = { kind: GridKind; id: string; label: string; tokens: number; percent: number; estimated: boolean; cells: number };
export type ContextGridPlan = {
  /** Always exactly GRID_CELLS: categories first, free space next, the auto-compact buffer at the end. */
  cells: GridCell[];
  categories: GridLine[];
  /** Null when the window size is unknown: nothing is claimed, every cell is free. */
  free: GridLine | null;
  /** Null when the window size is unknown. `bufferKnown` is false when no usable compaction threshold was recorded. */
  buffer: GridLine | null;
  bufferKnown: boolean;
};

/** The bridge also sends these as categories, but the grid draws them as free space and the buffer, not as colours. */
const NOT_A_COLOUR = new Set(["free", "reserved"]);

const percentOf = (tokens: number, maximum: number): number => maximum > 0 ? tokens / maximum * 100 : 0;
const allFree = (): GridCell[] => Array.from({ length: GRID_CELLS }, () => ({ kind: "free", id: "free" }));

/**
 * Lay a snapshot out on the grid. Pure: no layout, colour or glyph decisions.
 *
 * Every category gets cells in proportion to its tokens, at least one when it holds any. When the
 * categories and the buffer would not fit, the largest category gives up a cell at a time. Free cells
 * come next and the auto-compact buffer (maximum - threshold) goes at the very end.
 */
export function planContextGrid(snapshot: ContextSnapshot | null | undefined): ContextGridPlan {
  if (!snapshot) return { cells: allFree(), categories: [], free: null, buffer: null, bufferKnown: false };
  const maximum = Number.isFinite(snapshot.maximum) && snapshot.maximum > 0 ? snapshot.maximum : 0;

  const coloured = snapshot.categories.filter(c => !NOT_A_COLOUR.has(c.id));
  const source: { id: string; label: string; tokens: number; estimated: boolean }[] = coloured.length || snapshot.used <= 0
    ? coloured
    : [{ id: "used", label: "Used", tokens: snapshot.used, estimated: snapshot.estimated }];
  if (maximum === 0) {
    // No window size: no proportions to draw and no percentages to claim. Keep the token counts.
    return { cells: allFree(), categories: source.map(c => ({ kind: "category", id: c.id, label: c.label, tokens: c.tokens, percent: 0, estimated: c.estimated, cells: 0 })), free: null, buffer: null, bufferKnown: false };
  }
  const bufferKnown = snapshot.threshold > 0 && snapshot.threshold < maximum;
  const bufferTokens = bufferKnown ? maximum - snapshot.threshold : 0;
  const freeTokens = Math.max(0, maximum - snapshot.used - bufferTokens);

  const perCell = maximum / GRID_CELLS;
  const cellsFor = (tokens: number): number => tokens > 0 ? Math.max(1, Math.round(tokens / perCell)) : 0;
  const counts = source.map(category => ({ category, count: cellsFor(category.tokens) }));
  const bufferCells = Math.min(GRID_CELLS, cellsFor(bufferTokens));

  let overflow = counts.reduce((sum, entry) => sum + entry.count, 0) - (GRID_CELLS - bufferCells);
  while (overflow > 0) {
    // Largest first, so a category that is already down to one cell keeps its place on the grid.
    let largest: (typeof counts)[number] | undefined;
    for (const entry of counts) if (!largest || entry.count > largest.count) largest = entry;
    if (!largest || largest.count <= 1) break;
    largest.count -= 1;
    overflow -= 1;
  }
  const used = counts.reduce((sum, entry) => sum + entry.count, 0);
  // More categories than cells is not a real snapshot, but the grid must still be exactly 200 cells.
  const bufferShown = Math.max(0, Math.min(bufferCells, GRID_CELLS - used));
  const freeShown = Math.max(0, GRID_CELLS - used - bufferShown);

  const cells: GridCell[] = [];
  for (const { category, count } of counts) for (let i = 0; i < count; i++) cells.push({ kind: "category", id: category.id });
  for (let i = 0; i < freeShown; i++) cells.push({ kind: "free", id: "free" });
  for (let i = 0; i < bufferShown; i++) cells.push({ kind: "buffer", id: "buffer" });

  return {
    cells: cells.slice(0, GRID_CELLS),
    categories: counts.map(({ category, count }) => ({ kind: "category", id: category.id, label: category.label, tokens: category.tokens, percent: percentOf(category.tokens, maximum), estimated: category.estimated, cells: count })),
    free: { kind: "free", id: "free", label: "Free space", tokens: freeTokens, percent: percentOf(freeTokens, maximum), estimated: snapshot.estimated, cells: freeShown },
    buffer: { kind: "buffer", id: "buffer", label: "Autocompact buffer", tokens: bufferTokens, percent: percentOf(bufferTokens, maximum), estimated: true, cells: bufferShown },
    bufferKnown,
  };
}

/** What the grid says in words, for the accessibility value: the cells are otherwise silent. */
export function gridSummary(plan: ContextGridPlan): string {
  const filled = plan.cells.filter(cell => cell.kind === "category").length;
  const free = plan.cells.filter(cell => cell.kind === "free").length;
  const buffer = plan.cells.length - filled - free;
  return `${filled} of ${plan.cells.length} cells used, ${free} free${buffer ? `, ${buffer} autocompact buffer` : ""}`;
}

/** 85000 -> "85k", 8540 -> "8.5k", 1_200_000 -> "1.2M": the short form the peek has room for. */
export function compactTokens(tokens: number): string {
  const trim = (value: number): string => value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  if (tokens >= 1_000_000) return `${trim(tokens / 1_000_000)}M`;
  if (tokens >= 1000) return `${trim(tokens / 1000)}k`;
  return String(Math.round(tokens));
}

/** "~42% · 85k / 200k", or the honest unknown when the window size is not known. */
export function peekSummary(snapshot: ContextSnapshot | null | undefined): string {
  if (!snapshot || !(snapshot.maximum > 0)) return "Context unknown";
  const mark = snapshot.estimated ? "~" : "";
  return `${mark}${Math.round(snapshot.used / snapshot.maximum * 100)}% · ${compactTokens(snapshot.used)} / ${compactTokens(snapshot.maximum)}`;
}

/** "<1%" instead of a misleading "0%" for a category that holds a few tokens. */
export function percentLabel(percent: number, tokens: number): string {
  return tokens > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}
