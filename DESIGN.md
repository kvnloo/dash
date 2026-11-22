---
version: alpha
name: Dash
description: Phone UI for laptop coding agents. Living Night near-black, cream ink, gold as the only accent. Native 60px nav. Operate mode.
colors:
  bg: "#0c0c0a"
  surfaceRaised: "#151611"
  text: "#ECE8DF"
  textMuted: "#B4AFA3"
  textTertiary: "#837F74"
  textFaint: "#5e5b52"
  accent: "#d7b986"
  actionStrong: "#eccd8c"
  actionMuted: "#99835c"
  ok: "#98cf8b"
  information: "#81b9da"
  warn: "#e7a875"
  danger: "#e37f65"
  provenance: "#b098cd"
  orchestraSubagent: "#63bfae"
  surface: "rgba(24,26,23,.46)"
  border: "rgba(236,232,223,.10)"
  onAccent: "#0c0c0a"
  bubble: "rgba(20,22,19,.66)"
  gold: "#d7b986"
  goldHi: "#eccd8c"
  goldLo: "#99835c"
  goldGlow: "#99835c"
  goldGlass: "#d7b986"
  gold68: "#99835c"
  goldRim: "#eccd8c"
  ink: "#ECE8DF"
  ink2: "#B4AFA3"
  ink3: "#837F74"
  inkDark: "#0c0c0a"
  devNav: "rgba(20,22,19,.66)"
  devNav96: "rgba(20,22,19,.66)"
  navGlass: "rgba(24,26,23,.46)"
  hair: "rgba(236,232,223,.10)"
  hair2: "rgba(236,232,223,.16)"
typography:
  title:
    fontSize: 22px
    fontWeight: 700
    letterSpacing: -0.3px
  heading:
    fontSize: 17px
    fontWeight: 600
  body:
    fontSize: 16px
    lineHeight: 24px
  small:
    fontSize: 13px
    lineHeight: 18px
  label:
    fontSize: 12px
    fontWeight: 600
    letterSpacing: 0.6px
  mono:
    fontFamily: monospace
    fontSize: 14px
    lineHeight: 20px
rounded:
  sm: 10px
  md: 16px
  lg: 22px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
---

## Overview

Dash is a one-handed phone for talking to coding agents. The canvas is Living Night near-black. Cream ink carries reading. Gold is the only brand mark: the pager pill, and nowhere as a wash. Chrome recedes; the job is the list, the thread, and the composer.

## Colors

Use `{colors.bg}` as the canvas. Surfaces step `{colors.surface}` then `{colors.surfaceRaised}`. Body text is `{colors.text}`; secondary is `{colors.ink2}` or `{colors.textMuted}`. Gold (`{colors.gold}`, `{colors.gold68}`) marks selection and the active nav pill only. Status uses `{colors.ok}`, `{colors.warn}`, `{colors.danger}` — not gold.

Hairlines are `{colors.hair}` / `{colors.hair2}`, not `{colors.border}`, on glass chrome.

## Typography

System UI for everything except `{typography.mono}`. `{typography.label}` is reserved for short chrome captions. Do not introduce a second display face.

## Layout

The native tab chrome is 60px tall. Immersive and pager toggles are 44×44. Adjacent hits keep at least `{spacing.sm}`. Bottom composers sit in KeyboardDock and ride the IME; they do not use a safe-area spacer as a keyboard substitute. Android 15 is edge-to-edge; Expo Go does not resize the window for the keyboard.

## Elevation & Depth

Nav and circular controls use `{colors.devNav96}` glass, `{colors.hair2}` rim, and a single dark drop shadow. Gold glow is not a layer on the pager. Nested radii stay concentric: outer radius equals inner radius plus padding.

## Shapes

Rows and sheets use `{rounded.md}` or `{rounded.lg}`. The pager is a stadium. Icon buttons are circles. Do not put `{rounded.lg}` on a control inside a `{rounded.sm}` parent.

## Components

The gold pill is the only moving brand object. It follows the selected tab on the UI thread with the critically damped pager timing (no overshoot). Press scale is `0.985` on rows, `0.92` on controls, `0.9` on nav circles. Enters are 150ms; exits are 120ms; nothing runs past 180ms. Honor reduced motion with a crossfade: no travel, opacity only. [MOTION.md](MOTION.md) is the motion contract and holds the tokens.

Composer and search are the same dock family: one field, gold send when there is text, chips for `/` and `@` only when those tokens are in play.

## Do's and Don'ts

Do keep content above chrome. Do keep hit targets at 44px. Do keep the gold pill on the selected tab.

Don't add a gold glow overlay, an 80px nav spacer, or WebView nav. Don't park a composer on `paddingBottom: insets.bottom`. Don't use React Native `KeyboardAvoidingView` for Main or Chat. Don't use emoji as icons. Don't start a second Metro on 8097.
