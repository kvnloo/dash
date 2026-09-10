---
version: alpha
name: Dash
description: Phone UI for laptop coding agents. OLED black, cream ink, gold as the only accent. Native 60px nav. Operate mode.
colors:
  bg: "#000000"
  surface: "#121212"
  surfaceRaised: "#1c1c1c"
  primary: "#e6cd96"
  border: "#262626"
  text: "#f2f2f2"
  textMuted: "#8b8b8b"
  textFaint: "#5a5a5a"
  accent: "#ffffff"
  onAccent: "#000000"
  bubble: "#1f1f1f"
  danger: "#ff6b6b"
  ok: "#34c759"
  warn: "#ffb020"
  gold: "#e6cd96"
  goldHi: "rgba(240, 212, 150, 0.95)"
  goldLo: "rgba(206, 168, 96, 0.9)"
  goldGlow: "rgba(220, 190, 120, 0.7)"
  goldGlass: "rgba(230, 205, 150, 0.72)"
  gold68: "rgba(230, 205, 150, 0.68)"
  goldRim: "rgba(239, 223, 188, 0.95)"
  ink: "#ECE8DF"
  ink2: "#B4AFA3"
  ink3: "#837F74"
  inkDark: "#211B10"
  devNav: "rgba(12, 13, 11, 0.91)"
  devNav96: "rgba(12, 13, 11, 0.874)"
  navGlass: "rgba(24, 26, 23, 0.46)"
  hair: "rgba(236, 232, 223, 0.10)"
  hair2: "rgba(236, 232, 223, 0.16)"
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

Dash is a one-handed phone for talking to coding agents. The screen is OLED black. Cream ink carries reading. Gold is the only brand mark: the pager pill, and nowhere as a wash. Chrome recedes; the job is the list, the thread, and the composer.

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

The gold pill is the only moving brand object. It follows the selected tab on the UI thread with gel springs (mass 0.4, stiffness 240, damping 13). Press scale is `0.985` on rows, `0.92` on controls, `0.9` on nav circles. Enters are 240ms; exits are 140ms. Honor reduced motion with a crossfade.

Composer and search are the same dock family: one field, gold send when there is text, chips for `/` and `@` only when those tokens are in play.

## Do's and Don'ts

Do keep content above chrome. Do keep hit targets at 44px. Do keep the gold pill on the selected tab.

Don't add a gold glow overlay, an 80px nav spacer, or WebView nav. Don't park a composer on `paddingBottom: insets.bottom`. Don't use React Native `KeyboardAvoidingView` for Main or Chat. Don't use emoji as icons. Don't start a second Metro on 8097.
