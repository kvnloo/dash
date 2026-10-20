# Dash × zerOS Living Night

Status: the owner-directed visual contract for Dash, as of 2026-10-20. This file supersedes
the **palette, type and surface** sections of [language.md](language.md). The information
architecture in language.md is unchanged: top tabs, the `@` dock, Grok History density,
plain assistant text and status dots.

Sources:
- zerOS `packages/ui-foundation/tokens.json` at commit `5cf5101`. This is the authority for
  every value below.
- zerOS `primitives.css`, which defines `.z-btn`, `.z-icon-btn`, `.z-chip`, `.z-card` and `.z-field`.
- The approved phone surface in the same language: garden room plant entry, captured at
  `project-artifacts/garden-room/plant-entry-v2/pepper-top.png`.
- The voice orb catalog in zerOS homeforge, `src/dev-page/voice-preferences.js` plus
  `VoiceOrbAvatar` and `ElevenLabsOrb`.

The old note "no cyan/violet zerOS palette" was about an invented palette. The real zerOS
palette is warm night and gold, and this file adopts it.

## Intent

Dash is a cockpit for agents that do real work on the owner's machines. The zerOS
language says three things, and Dash should say them too:

1. **Calm authority.** A warm near-black canvas, warm-white text and one precious
   accent (gold). Nothing glows unless it means something.
2. **Editorial weight for what matters, instrument precision for the rest.** A serif
   (Cormorant Garamond) is for names, titles and big numbers. A grotesk (Hanken Grotesk) is
   for everything you read while working. Mono (IBM Plex Mono) is only for machine truth:
   paths, hosts, ids and times.
3. **Material, not panels.** Floating surfaces are liquid glass over the canvas: a blurred
   tint, a bright top rim, a faint edge and a soft shadow. There are no opaque grey slabs.

Truth rules from zerOS still apply. No fake activity, no decorative waveforms, and no motion
that implies work is happening when it isn't. A status dot, orb phase or "live" label is
shown only from bridge state.

## Tokens (living-night; day-frost may follow)

Port `tokens.json` → `app/src/theme.ts` as typed constants. Convert oklch to sRGB hex
once, at build time, and write the conversion in a comment beside each value.

| Role | Token | Value |
|---|---|---|
| canvas | `--z-canvas` | `#0c0c0a` |
| raised canvas | `--z-canvas-raised` | `#151611` |
| text primary / secondary / tertiary / faint | | `#ECE8DF` / `#B4AFA3` / `#837F74` / `#5e5b52` |
| action (gold) / strong / muted | `--z-action*` | oklch(0.80 0.075 80) / (0.86 0.09 85) / (0.62 0.06 80) |
| success / information / warning / danger / provenance | | oklch .80 .11 140 / .76 .075 235 / .78 .10 60 / .70 .13 35 / .72 .08 305 |
| glass / strong / raised | | rgba(24,26,23,.46) / (20,22,19,.66) / (18,20,17,.82) |
| sheen / specular / rim / edge | | rgba(255,255,255,.10) / .34 / .30 / rgba(0,0,0,.18) |
| hairlines subtle / default / quiet | | rgba(236,232,223,.10) / .16 / .06 |
| radius control / card / sheet / scene / pill | | 6 / 8 / 14 / 18 / 999 |
| space | | 4 8 12 16 24 32 48 64 |
| min touch | `--z-control-min` | 44 |
| motion immediate / state / transition | | 140 / 240 / 560 ms |
| easings settle / press / sheet / spring | | the four cubic-beziers from tokens.json |

Canvas treatment: `#0c0c0a`, with a very faint warm vertical wash toward `#151611` at the top
(see the garden reference). It is never pure `#000`.

## Type

Vendor through `@expo-google-fonts/cormorant-garamond`, `@expo-google-fonts/hanken-grotesk`
and `@expo-google-fonts/ibm-plex-mono`, loaded with `expo-font` before first paint, behind the
existing splash. The scale:

| Use | Family | Size/line | Weight |
|---|---|---|---|
| screen title, chat title, bot name in detail | Cormorant Garamond | 30/34 | 500 |
| section title ("Today", "Growth timeline"-style) | Cormorant Garamond | 24/28 | 500 |
| big numbers (counts, approvals pending) | Cormorant Garamond | 34/36 | 500, tabular |
| row title | Hanken Grotesk | 16/22 | 600 |
| body, assistant text | Hanken Grotesk | 16/24 | 400 |
| meta, previews | Hanken Grotesk | 13/18 | 400, text-secondary |
| micro label | Hanken Grotesk | 12/16 | 600, +0.4 tracking, sentence case (not shouty caps) |
| host, path, id, timestamp | IBM Plex Mono | 12/16 | 400, text-tertiary |

## Components

- **Top navigation bar** (owner decision, 2026-10-20: keep the bar): a 60 px row with the
  Expand button (opens Voice), the 144×50 three-dot pager with the gold gel pill, and the
  Bridge details chevron, as before the restyle. Living Night only restyles it: glass-strong
  fill, glass-rim top edge, hairline, Feather stroke icons in text-secondary. Geometry lives in
  `golden-nav.ts` and is pinned by mutation tests.
- **Workspace header** (Main, under the bar): the current pane's name in Cormorant 30, then
  Approvals with a sans numeral on a gold pill when pending, New chat and Settings icon buttons.
- **Header icons**: `.z-icon-btn`, a 44 px hit area with a 36 px glass circle and a 1.5 px
  stroke icon in text-secondary. Pressed state is gold. Use one consistent stroke icon family.
- **Chat rows**: the avatar is a 40 px circle carrying the harness identity orb (a small
  static rendering of that harness's preset, not a letter). The title is Hanken 16/600, the
  preview is one line at 13/18 in text-secondary, and the time is mono, right-aligned, in
  text-tertiary. Rows are separated by subtle hairlines inset 68 px. A row that is live on the
  host has a gold dot. A row that the host no longer reports is rendered as **stale**: text
  is tertiary and the label "ended" is in mono. Stale threads are never presented as live.
- **Section headers**: "Today" and "Yesterday" use Cormorant 24, with a mono count on the right.
- **`@` dock**: a single glass pill, 52 px tall, radius pill, fully inside the safe area. The
  `@` glyph sits in gold inside the pill on the left, followed by the placeholder in
  text-faint. Scope chips (`.z-chip`) appear above the pill only while it has focus. The
  current overlap bug, where the `@` floats over the border, must not survive.
- **Chat screen**: the title is Cormorant 22 in the header. Assistant text is plain Hanken
  16/24 with no bubble. User bubbles use glass-strong with a rim hairline, radius 18 and an
  8 px bottom-right corner. Tool and status lines are mono 12 in text-tertiary, each with a
  4 px dot that is gold while running and success when done.
- **Composer**: one glass sheet, radius 18, with the input on the left and the controls in a
  single row on the right: attach, mic, then send or stop. Send is a 36 px gold circle with
  a canvas-coloured arrow. Stop is a 36 px warm-white circle with a canvas square. The
  placeholder is a single line that truncates and never wraps across lines.
- **Primary button** (Pair, Approve all, Save): the garden "Edit plant" button. That is a
  gold gradient from action-strong at the top to action at the bottom, with canvas text in
  Hanken 16/600, radius pill, 52 px tall and a 1 px specular top rim. Secondary is `.z-btn` ghost.
- **Cards** (Orchestra products, approval items, settings groups): `.z-card` glass with
  radius 14 and 16 px padding. Group titles are Cormorant 22 in gold when the card is the
  "Focus" of the screen (the garden pattern). Otherwise they are text-primary.
- **Metric strips**: the garden Age/Height/Produce/Health row is the pattern for any
  numbers row, such as approvals pending, bulk-ready, or blocked. It is a micro label, then a
  Cormorant number, then a mono sublabel, with hairline separators between cells.
- **Voice**: the orb comes from the zerOS catalog: chatgpt "Atmosphere", gemini "Spectrum",
  siri "Perimeter", alexa "Light ring", and the official ElevenLabs orb. The default orb
  follows the harness: Hermes uses Atmosphere and Grok uses its silver orb. Orb phase
  (idle, listening, thinking, speaking) is driven only by real voice state.

## Glass in React Native

Use `expo-blur` `BlurView`, with intensity tuned per platform (the current
`glass.blurAndroid` and similar values are fine). Put the glass tint layer above the blur,
then a 1 px top border of glass-rim at about 60% opacity as the specular edge, then
a 1 px full border of the hairline. Shadows come from `--z-shadow-context` on iOS and from
elevation 6 on Android. On Android, where blur is costly, cap concurrent BlurViews to the
header, the dock and the composer. Cards use a tint without blur.

## Proof

Before calling this done:
- regenerate `bun run debug:shots` for all nine frames in language.md, plus approvals;
- view each one at 390×844;
- compare against `pepper-top.png` for grammar, not layout;
- run Proof Mono (`proof-mono` tokens) once to show that meaning survives without hue;
- keep all existing tests green.
