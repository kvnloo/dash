/** zerOS ui-foundation/tokens.json @ 5cf5101. OKLCH → linear sRGB → sRGB,
 * clamped to gamut and rounded to 8 bits once; no runtime colour conversion. */
const mono = process.env.EXPO_PUBLIC_ZEROS_THEME === "proof-mono";
/** Proof Mono: meaning must survive without hue. */
export const proofMono = mono;
const night = {
  bg: "#0c0c0a", surfaceRaised: "#151611",
  text: "#ECE8DF", textMuted: "#B4AFA3", textTertiary: "#837F74", textFaint: "#5e5b52",
  accent: "#d7b986", // oklch(0.80 0.075 80)
  actionStrong: "#eccd8c", // oklch(0.86 0.09 85)
  actionMuted: "#99835c", // oklch(0.62 0.06 80)
  ok: "#98cf8b", // oklch(0.80 0.11 140)
  information: "#81b9da", // oklch(0.76 0.075 235)
  warn: "#e7a875", // oklch(0.78 0.10 60)
  danger: "#e37f65", // oklch(0.70 0.13 35)
  provenance: "#b098cd", // oklch(0.72 0.08 305)
};
const palette = mono ? { ...night, bg: "#050505", surfaceRaised: "#111111", text: "#f0f0ed", textMuted: "#c4c4c0", textTertiary: "#92928d", textFaint: "#74746f", accent: "#f0f0ed", actionStrong: "#ffffff", actionMuted: "#b0b0ac", ok: "#f0f0ed", information: "#d8d8d4", warn: "#c2c2bd", danger: "#ffffff", provenance: "#a6a6a1" } : night;
export const glass = {
  fill: mono ? "rgba(20,20,20,.58)" : "rgba(24,26,23,.46)",
  fillRaised: mono ? "rgba(10,10,10,.90)" : "rgba(18,20,17,.82)",
  fillNavStrong: mono ? "rgba(14,14,14,.76)" : "rgba(20,22,19,.66)",
  fillChip: mono ? "rgba(20,20,20,.58)" : "rgba(24,26,23,.46)",
  fillChipOn: mono ? "rgba(14,14,14,.76)" : "rgba(20,22,19,.66)",
  fillNav: mono ? "rgba(20,20,20,.58)" : "rgba(24,26,23,.46)",
  border: mono ? "rgba(255,255,255,.12)" : "rgba(236,232,223,.10)",
  borderBright: mono ? "rgba(255,255,255,.20)" : "rgba(236,232,223,.16)",
  hair: mono ? "rgba(255,255,255,.12)" : "rgba(236,232,223,.10)",
  hair2: mono ? "rgba(255,255,255,.20)" : "rgba(236,232,223,.16)",
  quiet: mono ? "rgba(255,255,255,.07)" : "rgba(236,232,223,.06)",
  sheen: mono ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.10)",
  spec: mono ? "rgba(255,255,255,.30)" : "rgba(255,255,255,.34)",
  rim: mono ? "rgba(255,255,255,.26)" : "rgba(255,255,255,.30)",
  edge: mono ? "rgba(0,0,0,.28)" : "rgba(0,0,0,.18)",
  highlight: "rgba(255,255,255,.18)", // glass-rim at 60% opacity
  sat: 1.7, bright: 1.08, blurIos: 32, blurAndroid: 22, blurWeb: 16, blurNav: 24, blurCircle: 18,
} as const;
export const colors = {
  ...palette, surface: glass.fill, border: glass.hair, onAccent: palette.bg, bubble: glass.fillNavStrong,
  gold: palette.accent, goldHi: palette.actionStrong, goldLo: palette.actionMuted,
  goldGlow: palette.actionMuted, goldGlass: palette.accent, gold68: palette.actionMuted,
  goldRim: palette.actionStrong, ink: palette.text, ink2: palette.textMuted,
  ink3: palette.textTertiary, inkDark: palette.bg, devNav: glass.fillNavStrong,
  devNav96: glass.fillNavStrong, navGlass: glass.fill, hair: glass.hair, hair2: glass.hair2,
} as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, scene: 64 } as const;
export const radius = { sm: 6, card: 8, md: 14, lg: 18, pill: 999 } as const;
export const controlMin = 44;
export const timing = { immediate: 140, state: 240, transition: 560 } as const;
export const easing = { settle: [.2,.75,.2,1], press: [.2,.7,.2,1], sheet: [.32,.72,0,1], spring: [.3,.8,.3,1.5] } as const;
export const fonts = { editorial: "CormorantGaramond_500Medium", body: "HankenGrotesk_400Regular", semibold: "HankenGrotesk_600SemiBold", mono: "IBMPlexMono_400Regular" } as const;
export const type = {
  title: { fontFamily: fonts.editorial, fontSize: 30, lineHeight: 34, fontWeight: "500" as const },
  section: { fontFamily: fonts.editorial, fontSize: 24, lineHeight: 28, fontWeight: "500" as const },
  cardTitle: { fontFamily: fonts.editorial, fontSize: 22, lineHeight: 28, fontWeight: "500" as const },
  number: { fontFamily: fonts.editorial, fontSize: 34, lineHeight: 36, fontWeight: "500" as const, fontVariant: ["tabular-nums"] as ("tabular-nums")[] },
  heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, fontWeight: "600" as const },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, fontWeight: "600" as const, letterSpacing: .4 },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
} as const;
