/** Liquid-glass overlays — dark Grok palette, Zero-style refraction edge. */
export const glass = {
  fill: "rgba(18, 18, 18, 0.68)",
  fillRaised: "rgba(28, 28, 28, 0.78)",
  fillChip: "rgba(18, 18, 18, 0.55)",
  fillChipOn: "rgba(38, 38, 38, 0.72)",
  border: "rgba(255, 255, 255, 0.07)",
  borderBright: "rgba(255, 255, 255, 0.12)",
  highlight: "rgba(255, 255, 255, 0.04)",
  blurIos: 32,
  blurAndroid: 22,
  blurWeb: 16,
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
