import tokens from "../vendor/ephemeral-ui/glide.json";

export const glide = tokens;
export type GlideScheme = keyof typeof glide.color;

export function glidePalette(scheme: GlideScheme) {
  const c = glide.color[scheme];
  return { background: c.bg, surface: c.card, foreground: c.fg, border: c.border, accent: c.primary, onAccent: c.primaryFg };
}

/** Speed is a multiplier, not a duration. Reduced motion wins over Turbo. */
export function glideDuration(duration: keyof typeof glide.motion.duration, turbo = false, reduced = false) {
  return reduced ? 0 : Math.round(glide.motion.duration[duration] /
    (glide.motion.speed.default * (turbo ? glide.motion.speed.turbo : 1)));
}
