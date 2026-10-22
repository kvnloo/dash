/**
 * Two independent display axes.
 * Layout density: spacing, row height, padding. Information density: how much data each
 * visualisation draws. One reducer, one persisted shape, global default plus per-screen and
 * per-chat overrides.
 */

export type LayoutDensity = "compact" | "comfortable" | "spacious";
export const LAYOUTS: readonly LayoutDensity[] = ["compact", "comfortable", "spacious"];
export const LAYOUT_LABEL: Record<LayoutDensity, string> = { compact: "Compact", comfortable: "Comfortable", spacious: "Spacious" };

export type InfoLevel = 1 | 2 | 3 | 4 | 5;
export const INFO_LEVELS: readonly InfoLevel[] = [1, 2, 3, 4, 5];

export interface DensityValue { layout: LayoutDensity; info: InfoLevel }
export const DEFAULT_DENSITY: DensityValue = { layout: "comfortable", info: 3 };

/** Persisted shape. Keys of `screens` are screen ids ("orchestra", "trace") or `chat:<id>`. */
export interface DensityPrefs { global: DensityValue; screens: Record<string, Partial<DensityValue>> }
export const DEFAULT_PREFS: DensityPrefs = { global: DEFAULT_DENSITY, screens: {} };

/** Snap any dial position to a level; NaN and out-of-range values clamp. */
export function toInfoLevel(value: number): InfoLevel {
  "worklet";
  const n = Number.isFinite(value) ? Math.round(value) : 3;
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 4;
  return 5;
}

export function parseLayout(value: unknown): LayoutDensity {
  if (value === "rich") return "spacious";
  return value === "compact" || value === "spacious" ? value : "comfortable";
}

export function parseInfo(value: unknown): InfoLevel {
  return typeof value === "number" ? toInfoLevel(value) : DEFAULT_DENSITY.info;
}

export function parsePrefs(raw: unknown): DensityPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  const global = "global" in raw && raw.global && typeof raw.global === "object" ? raw.global : {};
  const screensRaw = "screens" in raw && raw.screens && typeof raw.screens === "object" ? raw.screens : {};
  const screens: Record<string, Partial<DensityValue>> = {};
  for (const [key, value] of Object.entries(screensRaw)) {
    if (!value || typeof value !== "object") continue;
    const entry: Partial<DensityValue> = {};
    if ("layout" in value) entry.layout = parseLayout(value.layout);
    if ("info" in value) entry.info = parseInfo(value.info);
    screens[key] = entry;
  }
  return {
    global: { layout: parseLayout("layout" in global ? global.layout : undefined), info: parseInfo("info" in global ? global.info : undefined) },
    screens,
  };
}

/** Most specific wins: chat override, then screen override, then global. */
export function resolveDensity(prefs: DensityPrefs, screen?: string, chat?: string): DensityValue {
  const s = screen ? prefs.screens[screen] : undefined;
  const c = chat ? prefs.screens[`chat:${chat}`] : undefined;
  return {
    layout: c?.layout ?? s?.layout ?? prefs.global.layout,
    info: c?.info ?? s?.info ?? prefs.global.info,
  };
}

export type DensityAction =
  | { type: "layout"; value: LayoutDensity; scope?: string }
  | { type: "info"; value: number; scope?: string }
  | { type: "step"; axis: "layout" | "info"; delta: number; scope?: string; base: DensityValue }
  | { type: "clear"; scope: string };

/** `scope` undefined writes the global default; otherwise the override for that screen or chat. */
export function densityReducer(prefs: DensityPrefs, action: DensityAction): DensityPrefs {
  if (action.type === "clear") {
    if (!(action.scope in prefs.screens)) return prefs;
    const screens = { ...prefs.screens };
    delete screens[action.scope];
    return { ...prefs, screens };
  }
  let patch: Partial<DensityValue>;
  if (action.type === "layout") patch = { layout: action.value };
  else if (action.type === "info") patch = { info: toInfoLevel(action.value) };
  else if (action.axis === "info") patch = { info: toInfoLevel(action.base.info + action.delta) };
  else patch = { layout: stepLayout(action.base.layout, action.delta) };
  if (action.scope === undefined) return { ...prefs, global: { ...prefs.global, ...patch } };
  return { ...prefs, screens: { ...prefs.screens, [action.scope]: { ...prefs.screens[action.scope], ...patch } } };
}

export function stepLayout(layout: LayoutDensity, delta: number): LayoutDensity {
  const i = LAYOUTS.indexOf(layout) + Math.round(delta);
  return LAYOUTS[Math.max(0, Math.min(LAYOUTS.length - 1, i))] ?? layout;
}

/** Spacing per layout. Spacious stays within 1.25x Comfortable; the old Rich was 1.4-1.5x. */
export function layoutSizing(layout: LayoutDensity, fontScale = 1) {
  const scale = Math.max(1, fontScale);
  const pick = <T,>(c: T, m: T, s: T) => layout === "compact" ? c : layout === "spacious" ? s : m;
  return {
    rowMin: Math.ceil(pick(44, 60, 72) * scale),
    tileMin: Math.ceil(pick(100, 136, 164) * scale),
    padding: pick(8, 12, 15),
    plotMin: pick(44, 68, 84),
    gap: pick(4, 8, 10),
  };
}
