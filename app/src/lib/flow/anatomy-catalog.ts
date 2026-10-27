/** Static, prebuilt anatomy figure selection and injected HTML caching for Flow. */
export type FigureId = "dial-indicator" | "test-rig";

export interface FigureEntry {
  readonly id: FigureId;
  readonly title: string;
  readonly keywords: readonly string[];
}

export const FIGURES: readonly FigureEntry[] = [
  {
    id: "dial-indicator",
    title: "Dial indicator",
    keywords: ["dial indicator", "dial gauge", "indicator", "runout"],
  },
  {
    id: "test-rig",
    title: "Test rig",
    keywords: ["test rig", "test bench", "fixture", "rig"],
  },
];

/** The figures are static HTML, never interactive live artifacts. */
export const FIGURE_FRAME: Readonly<{ staticOnly: true }> = Object.freeze({ staticOnly: true });

/** Ignore punctuation as word separators, but not partial-word matches. */
function normalizedWords(text: string): string {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");
}

const EXPLANATION_START = /^(?:how does|how do|explain|what is|show me)(?: |$)/;

export function matchFigure(question: string): FigureId | null {
  const words = normalizedWords(question);
  if (!EXPLANATION_START.test(words)) return null;

  const haystack = " " + words + " ";
  let best: FigureId | null = null;
  let highest = 0;
  let tied = false;

  for (const figure of FIGURES) {
    const hits = figure.keywords.filter(keyword =>
      haystack.includes(" " + normalizedWords(keyword) + " "),
    ).length;
    if (hits > highest) {
      best = figure.id;
      highest = hits;
      tied = false;
    } else if (hits > 0 && hits === highest) {
      tied = true;
    }
  }

  return tied ? null : best;
}

export interface FigureLoadResult {
  readonly html: string;
  readonly fromCache: boolean;
  readonly loadMs: number;
}

export interface FigureCacheOptions {
  readonly load: (id: FigureId) => Promise<string>;
  readonly capacity?: number;
  readonly now: () => number;
}

function isFigureId(id: string): id is FigureId {
  return FIGURES.some(figure => figure.id === id);
}

/** Returns elapsed nonnegative time, even if the injected clock moves backward. */
function elapsed(now: () => number, since: number): number {
  return Math.max(0, now() - since);
}

export function createFigureCache({ load, capacity = 8, now }: FigureCacheOptions): {
  get: (id: string) => Promise<FigureLoadResult>;
} {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("Figure cache capacity must be a positive integer");
  }

  // Map insertion order is the LRU order: oldest first, newest last.
  const cached = new Map<FigureId, string>();
  const loading = new Map<FigureId, Promise<FigureLoadResult>>();

  function get(id: string): Promise<FigureLoadResult> {
    if (!isFigureId(id)) {
      return Promise.reject(new Error("Unknown anatomy figure: " + id));
    }

    const start = now();
    const html = cached.get(id);
    if (html !== undefined) {
      cached.delete(id);
      cached.set(id, html);
      return Promise.resolve({ html, fromCache: true, loadMs: elapsed(now, start) });
    }

    const pending = loading.get(id);
    if (pending) return pending;

    // Defer invoking the injected loader until after the pending request is recorded.
    // A synchronous throw or an async rejection clears the pending entry and never caches.
    const request = Promise.resolve()
      .then(() => load(id))
      .then(loadedHtml => {
        const result: FigureLoadResult = {
          html: loadedHtml,
          fromCache: false,
          loadMs: elapsed(now, start),
        };
        cached.delete(id);
        cached.set(id, loadedHtml);
        while (cached.size > capacity) {
          const oldest = cached.keys().next().value;
          if (oldest === undefined) break;
          cached.delete(oldest);
        }
        return result;
      })
      .finally(() => {
        loading.delete(id);
      });

    loading.set(id, request);
    return request;
  }

  return { get };
}

/** Inclusive millisecond budget, rejecting invalid and negative durations. */
export function withinLoadBudget(loadMs: number, budgetMs = 300): boolean {
  return Number.isFinite(loadMs) && Number.isFinite(budgetMs) &&
    loadMs >= 0 && budgetMs >= 0 && loadMs <= budgetMs;
}
