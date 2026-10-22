import type { InfoLevel } from "./density";

/**
 * Per-component information contracts. Each visualisation asks "what do I draw at level N?"
 * and renders exactly that set. Levels are cumulative: L(n+1) adds parts, never removes them,
 * so L5 hides nothing and L1 is the single most important fact. Table: docs/design/DENSITY.md.
 */
export const INFO_CONTRACTS = {
  /** Trace timeline: the profiler of agent work over time. */
  timeline: ["rows", "goal", "bars", "axis", "counts", "outliers", "annotations"],
  stat: ["value", "delta", "chart", "range", "breakdown"],
  readStrip: ["headline", "body", "numbers", "tag"],
  actionChip: ["title", "outcome", "why", "hint", "buttons"],
  orchestraNode: ["glyph", "label", "state", "caption", "path"],
  toolRow: ["name", "status", "args", "duration", "output"],
  zeroCard: ["name", "phase", "trace", "step", "elapsed", "counts", "path", "workers", "age"],
  traceCard: ["phase", "step", "elapsed", "counts", "workers", "read"],
} as const;

export type InfoComponent = keyof typeof INFO_CONTRACTS;
export type InfoPart<C extends InfoComponent> = (typeof INFO_CONTRACTS)[C][number];

/** Level at which each part first appears. */
const FIRST: { [C in InfoComponent]: Record<InfoPart<C>, InfoLevel> } = {
  timeline: { rows: 1, goal: 2, bars: 3, axis: 4, counts: 4, outliers: 5, annotations: 5 },
  stat: { value: 1, delta: 2, chart: 3, range: 4, breakdown: 5 },
  readStrip: { headline: 1, body: 2, numbers: 3, tag: 4 },
  actionChip: { title: 1, outcome: 2, why: 3, hint: 4, buttons: 5 },
  orchestraNode: { glyph: 1, label: 2, state: 3, caption: 4, path: 5 },
  toolRow: { name: 1, status: 2, args: 3, duration: 4, output: 5 },
  zeroCard: { name: 1, phase: 1, trace: 1, step: 2, elapsed: 2, counts: 3, path: 4, workers: 4, age: 5 },
  traceCard: { phase: 1, step: 1, elapsed: 2, counts: 3, workers: 4, read: 5 },
};

export function firstLevel<C extends InfoComponent>(component: C, part: InfoPart<C>): InfoLevel {
  return FIRST[component][part];
}

export function shows<C extends InfoComponent>(component: C, part: InfoPart<C>, level: InfoLevel): boolean {
  return level >= firstLevel(component, part);
}

/** The parts drawn at a level, in contract order. */
export function partsAt<C extends InfoComponent>(component: C, level: InfoLevel): InfoPart<C>[] {
  const all: readonly InfoPart<C>[] = INFO_CONTRACTS[component];
  return all.filter(part => shows(component, part, level));
}

/** ReadStrip L1: first sentence only. */
export function readText(text: string, level: InfoLevel): string {
  if (shows("readStrip", "body", level)) return text;
  const first = text.split(/(?<=\.)\s+/)[0];
  return first ?? text;
}

/** How many sentences or segments a component lists at a level: L2 top 3, L3+ all. */
export function topN<T>(items: readonly T[], level: InfoLevel, at2 = 3): readonly T[] {
  if (level <= 1) return [];
  if (level === 2) return items.slice(0, at2);
  return items;
}
