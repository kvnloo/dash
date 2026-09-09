/** HomeForge / zerOS `base.css` + `tokens.css` (dev-integ). Expo cannot run CSS saturate/brightness. */
export const glass = {
  fill: "rgba(18, 18, 18, 0.68)",
  fillRaised: "rgba(28, 28, 28, 0.78)",
  fillChip: "rgba(18, 18, 18, 0.55)",
  fillChipOn: "rgba(38, 38, 38, 0.72)",
  /** --glass / --z-glass */
  fillNav: "rgba(24, 26, 23, 0.46)",
  /** --glass-strong */
  fillNavStrong: "rgba(20, 22, 19, 0.66)",
  border: "rgba(255, 255, 255, 0.07)",
  borderBright: "rgba(255, 255, 255, 0.12)",
  /** --hair */
  hair: "rgba(236, 232, 223, 0.10)",
  /** --hair-2 */
  hair2: "rgba(236, 232, 223, 0.16)",
  /** --glass-sheen */
  sheen: "rgba(255, 255, 255, 0.10)",
  /** --glass-spec / --z-glass-specular */
  spec: "rgba(255, 255, 255, 0.34)",
  /** --glass-rim */
  rim: "rgba(255, 255, 255, 0.30)",
  /** --glass-edge */
  edge: "rgba(0, 0, 0, 0.18)",
  highlight: "rgba(255, 255, 255, 0.34)",
  sat: 1.7,
  bright: 1.08,
  blurIos: 32,
  blurAndroid: 22,
  blurWeb: 16,
  /** .glass backdrop-filter blur(24px) */
  blurNav: 24,
  /** .dev-control-circle / collapsed pager */
  blurCircle: 18,
} as const;

export const colors = {
  bg: "#000000",
  surface: "#121212",
  surfaceRaised: "#1c1c1c",
  border: "#262626",
  text: "#f2f2f2",
  textMuted: "#8b8b8b",
  textFaint: "#5a5a5a",
  accent: "#ffffff",
  onAccent: "#000000",
  bubble: "#1f1f1f",
  danger: "#ff6b6b",
  ok: "#34c759",
  warn: "#ffb020",
  /** mobile.jsx pager gold */
  gold: "#e6cd96",
  goldHi: "rgba(240, 212, 150, 0.95)",
  goldLo: "rgba(206, 168, 96, 0.9)",
  goldGlow: "rgba(220, 190, 120, 0.7)",
  /** color-mix(in srgb, var(--gold) 72%, transparent) */
  goldGlass: "rgba(230, 205, 150, 0.72)",
  /** collapsed indicator: color-mix(gold 68%, transparent) */
  gold68: "rgba(230, 205, 150, 0.68)",
  /** color-mix(in srgb, white 36%, var(--gold)) */
  goldRim: "rgba(239, 223, 188, 0.95)",
  ink: "#ECE8DF",
  ink2: "#B4AFA3",
  ink3: "#837F74",
  inkDark: "#211B10",
  /** --dev-nav */
  devNav: "rgba(12, 13, 11, 0.91)",
  /** color-mix(dev-nav 96%, transparent) */
  devNav96: "rgba(12, 13, 11, 0.874)",
  navGlass: "rgba(24, 26, 23, 0.46)",
  hair: "rgba(236, 232, 223, 0.10)",
  hair2: "rgba(236, 232, 223, 0.16)",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 22,
  pill: 999,
} as const;

export const type = {
  title: { fontSize: 22, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 24 },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: "600" as const, letterSpacing: 0.6, textTransform: "uppercase" as const },
  mono: { fontFamily: "monospace" as const, fontSize: 14, lineHeight: 20 },
} as const;
