import { glide, glideDuration, glidePalette } from "./lib/glide-theme";
import { TURBO } from "./turbo";

const mono = process.env.EXPO_PUBLIC_ZEROS_THEME === "proof-mono";
/** Proof Mono: meaning must survive without hue. */
export const proofMono = mono;
// The Dash shell remains dark; embedded cards and the gallery can use either shared scheme.
const dark = glide.color.dark;
const night = {
  bg: dark.bg, surfaceRaised: dark.popover,
  text: dark.fg, textMuted: dark.mutedFg, textTertiary: dark.faint, textFaint: "#5e5b52",
  accent: dark.primary, actionStrong: glide.brand.cta.rim, actionMuted: glide.brand.cta.shade,
  ok: dark.successFg, information: dark.info, warn: dark.warning,
  danger: dark.dangerFg, provenance: dark.magenta,
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
  sat: glide.glass.card.saturate / 100, bright: 1.08,
  blurIos: glide.glass.card.blur, blurAndroid: glide.glass.card.blur, blurWeb: glide.glass.bar.blur,
  blurNav: glide.glass.bar.blur, blurCircle: glide.glass.composer.blur,
} as const;
export const colors = {
  ...palette, orchestraSubagent: mono ? palette.textMuted : "#63bfae", surface: glass.fill, border: glass.hair, onAccent: mono ? palette.bg : glidePalette("dark").onAccent, bubble: glass.fillNavStrong,
  gold: palette.accent, goldHi: palette.actionStrong, goldLo: palette.actionMuted,
  goldGlow: palette.actionMuted, goldGlass: palette.accent, gold68: palette.actionMuted,
  goldRim: palette.actionStrong, ink: palette.text, ink2: palette.textMuted,
  ink3: palette.textTertiary, inkDark: palette.bg, devNav: glass.fillNavStrong,
  devNav96: glass.fillNavStrong, navGlass: glass.fill, hair: glass.hair, hair2: glass.hair2,
} as const;
// One tint over the wallpaper keeps chat readable even against bright images.
export const wallpaperScrim = "rgba(8,9,8,0.80)";
export const space = { xs: glide.space["1"], sm: glide.space["2"], md: glide.space["3"], lg: glide.space["4"], xl: glide.space["6"], xxl: 32, xxxl: 48, scene: 64 } as const;
export const radius = { sm: glide.radius.chip, card: glide.radius.tile, md: glide.radius.block, lg: glide.radius.card, pill: glide.radius.pill } as const;
export const controlMin = 44;
export const timing = { immediate: glideDuration("press", TURBO), state: glideDuration("base", TURBO), transition: glideDuration("reveal", TURBO) } as const;
export const easing = { settle: [.2,.75,.2,1], press: [.2,.7,.2,1], sheet: [.32,.72,0,1], spring: [.3,.8,.3,1.5] } as const;
export const fonts = { editorial: "CormorantGaramond_500Medium", body: "HankenGrotesk_400Regular", semibold: "HankenGrotesk_600SemiBold", mono: "IBMPlexMono_400Regular" } as const;
export const type = {
  title: { fontFamily: fonts.editorial, fontSize: 30, lineHeight: 34, fontWeight: "500" as const },
  section: { fontFamily: fonts.editorial, fontSize: 24, lineHeight: 28, fontWeight: "500" as const },
  cardTitle: { fontFamily: fonts.editorial, fontSize: 22, lineHeight: 28, fontWeight: "500" as const },
  number: { fontFamily: fonts.editorial, fontSize: 34, lineHeight: 36, fontWeight: "500" as const, fontVariant: ["tabular-nums"] as ("tabular-nums")[] },
  heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, fontWeight: "600" as const },
  body: { fontFamily: fonts.body, fontSize: glide.type.base.size, lineHeight: Math.round(glide.type.base.size * glide.type.base.lineHeight) },
  small: { fontFamily: fonts.body, fontSize: glide.type.size.body, lineHeight: 18 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, fontWeight: "600" as const, letterSpacing: .4 },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
} as const;
