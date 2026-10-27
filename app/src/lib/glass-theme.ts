/**
 * Glass theme (DASH_GLASS build only): the Android wallpaper shows through the window, the
 * system blurs it (modules/dash-glass), and Dash paints one tint over it so text stays legible.
 * Pure: no React, no native, no storage. See docs/design/GLASS-THEME.md.
 */
import { colors } from "../theme";

export type ThemeMode = "classic" | "glass";
export type GlassPresetName = "clear" | "frosted" | "deep";

export interface GlassPrefs {
  readonly mode: ThemeMode;
  /** Opacity of the tint (colors.bg) painted over the blurred wallpaper, 0..1. */
  readonly tint: number;
  /** Window background blur radius in dp; 0 = tint only. */
  readonly blur: number;
}

/** What the screen paints. `active` false => exactly today's opaque Classic look. */
export interface GlassScene {
  readonly active: boolean;
  /** Root view behind every scene. */
  readonly root: string;
  /** Canvas gradient stops: extra scrim under the header and the dock. */
  readonly scrimTop: string;
  readonly scrimBottom: string;
  /** Surfaces that must occlude app content painted below them (Chat window over Main). */
  readonly window: string;
  /** Panel fill when no in-app blur sampling is available (replaces the opaque fallback). */
  readonly panelFallback: string;
  /** Native radii in dp handed to setWindowGlass. */
  readonly windowBlur: number;
  readonly behindBlur: number;
  /** Effective tint after the no-blur fallback boost. */
  readonly tint: number;
}

type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6);
  const n = Number.parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Source-over in gamma-encoded sRGB, which is what Android's compositor does. */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return [0, 1, 2].map(i => top[i]! * alpha + bottom[i]! * (1 - alpha)) as unknown as Rgb;
}

/** Smallest tint alpha (to 0.01) that gives `text` the `ratio` over `tint` composited on `wallpaper`. */
export function minTintFor(text: string, tint: string, wallpaper: string, ratio: number): number {
  const t = hexToRgb(text), k = hexToRgb(tint), w = hexToRgb(wallpaper);
  for (let a = 0; a <= 100; a += 1) if (contrast(t, over(k, a / 100, w)) >= ratio) return a / 100;
  return 1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Floor: body text (colors.text) keeps WCAG AA 4.5:1 over a mid-grey wallpaper, the typical
 * blurred average. Below this a bright wallpaper region makes body text fail.
 */
export const TINT_FLOOR = minTintFor(colors.text, colors.bg, "#808080", 4.5);
/** Frosted default: body text keeps 4.5:1 even over a pure-white wallpaper region. */
export const TINT_SAFE = minTintFor(colors.text, colors.bg, "#ffffff", 4.5);
export const TINT_MAX = 0.95;
export const BLUR_MAX = 60;
/** With cross-window blur off (battery saver), raise the tint: detail is no longer softened. */
export const NO_BLUR_TINT_BOOST = 0.12;

export const GLASS_PRESETS: Readonly<Record<GlassPresetName, { tint: number; blur: number }>> = {
  clear: { tint: round2(TINT_FLOOR), blur: 16 },
  frosted: { tint: round2(Math.ceil(TINT_SAFE * 20) / 20), blur: 28 },
  deep: { tint: 0.85, blur: 40 },
};

export const GLASS_DEFAULTS: GlassPrefs = { mode: "glass", ...GLASS_PRESETS.frosted };
export const TINT_STEP = 0.05;
export const BLUR_STEP = 4;

export function clampTint(n: number): number {
  return round2(clamp(Number.isFinite(n) ? n : GLASS_DEFAULTS.tint, TINT_FLOOR, TINT_MAX));
}

export function clampBlur(n: number): number {
  return Math.round(clamp(Number.isFinite(n) ? n : GLASS_DEFAULTS.blur, 0, BLUR_MAX));
}

export function parseGlassPrefs(raw: unknown): GlassPrefs {
  if (!raw || typeof raw !== "object") return GLASS_DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    mode: r.mode === "classic" ? "classic" : "glass",
    tint: clampTint(typeof r.tint === "number" ? r.tint : GLASS_DEFAULTS.tint),
    blur: clampBlur(typeof r.blur === "number" ? r.blur : GLASS_DEFAULTS.blur),
  };
}

export function presetOf(prefs: Pick<GlassPrefs, "tint" | "blur">): GlassPresetName | null {
  for (const name of Object.keys(GLASS_PRESETS) as GlassPresetName[]) {
    const p = GLASS_PRESETS[name];
    if (p.tint === prefs.tint && p.blur === prefs.blur) return name;
  }
  return null;
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${round2(clamp(alpha, 0, 1))})`;
}

export const CLASSIC_SCENE: GlassScene = {
  active: false, root: colors.bg, scrimTop: colors.surfaceRaised, scrimBottom: colors.bg,
  window: colors.bg, panelFallback: colors.surfaceRaised, windowBlur: 0, behindBlur: 0, tint: 1,
};

/**
 * `blurAvailable` is the live WindowManager.isCrossWindowBlurEnabled() (null = unknown yet,
 * treated as unavailable so the first frame is never under-tinted).
 */
export function resolveGlassScene(prefs: GlassPrefs, glassBuild: boolean, blurAvailable: boolean | null): GlassScene {
  if (!glassBuild || prefs.mode !== "glass") return CLASSIC_SCENE;
  const blurOn = blurAvailable === true && prefs.blur > 0;
  const tint = round2(clamp(prefs.tint + (blurOn ? 0 : NO_BLUR_TINT_BOOST), TINT_FLOOR, TINT_MAX));
  // Scrims only add opacity where chrome text sits; they never reduce the body tint.
  const extra = Math.min(0.25, TINT_MAX - tint);
  return {
    active: true,
    root: rgba(colors.bg, tint),
    scrimTop: rgba(colors.bg, extra),
    scrimBottom: rgba(colors.bg, extra * 0.8),
    window: rgba(colors.bg, Math.max(tint, 0.94)),
    panelFallback: rgba(colors.surfaceRaised, 0.72),
    windowBlur: blurOn ? prefs.blur : 0,
    behindBlur: 0,
    tint,
  };
}
