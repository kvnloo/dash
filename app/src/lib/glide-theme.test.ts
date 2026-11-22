import { describe, expect, test } from "bun:test";
import { glide, glideDuration, glidePalette } from "./glide-theme";
import { colors, glass, proofMono, radius, type } from "../theme";

describe("shared Glide tokens", () => {
  test("keeps light and dark semantic palette roles distinct", () => {
    for (const scheme of ["light", "dark"] as const) {
      const tokens = glide.color[scheme];
      expect(glidePalette(scheme)).toEqual({
        background: tokens.bg, surface: tokens.card, foreground: tokens.fg,
        border: tokens.border, accent: tokens.primary, onAccent: tokens.primaryFg,
      });
    }
    expect(glidePalette("light")).not.toEqual(glidePalette("dark"));
  });
  test("feeds Dash's default colors, radii, type and glass", () => {
    if (!proofMono) {
      expect(colors.bg).toBe(glide.color.dark.bg);
      expect(colors.onAccent).toBe(glide.color.dark.primaryFg);
      expect(colors.actionStrong).toBe(glide.brand.cta.rim);
    }
    expect(radius.pill).toBe(glide.radius.pill);
    expect(type.body.fontSize).toBe(glide.type.base.size);
    expect(glass.blurWeb).toBe(glide.glass.bar.blur);
  });
  test("divides motion duration by Turbo speed and honors reduced motion first", () => {
    expect(glideDuration("base")).toBe(Math.round(glide.motion.duration.base / glide.motion.speed.default));
    expect(glideDuration("base", true)).toBe(Math.round(glide.motion.duration.base / (glide.motion.speed.default * glide.motion.speed.turbo)));
    expect(glideDuration("base", true, true)).toBe(0);
  });
});
