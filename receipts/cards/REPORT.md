# Dash ephemeral card styles

Dash is the default. Ephemeral cards now use Dash’s dark glass, foreground, hairline, accent and corner tokens on a light or dark OS. Blueprint adds a cooler glass surface and Proof Mono uses Dash’s monochrome tokens. The offline frame uses system sans and monospace fallbacks where its font sandbox cannot access the app’s registered fonts.

App style uses dark Gmail, GitHub, Stripe and Spotify palettes. Other apps use the active Dash palette. Settings and the pinned Gallery control share one preference. The card document adds 16 px horizontal padding, 15 px list text, 44 px control heights and coarse-pointer hint suppression while retaining the kit’s actions. The Android and iOS host containers use the height reported by the card.

## Baseline and browser evidence

| Run | Result |
| --- | --- |
| Baseline typecheck | Passed |
| Baseline tester army, Gallery pages 1 and 5 | 2 passed |
| Updated typecheck | Passed |
| Updated tester army, card style journeys | 3 passed |
| Updated tester army, catalog properties across 37 Gallery pages | 37 passed, 219 fixtures |

The army uses the real Expo export, isolated Bun bridge and fixture ACP agent. At 412 × 915 and 2.6× scale, the new journeys cover both styles in a light OS, Gmail control sizing and the intent round trip, brand palettes, Blueprint, unbranded fallback, frame fit, live Gallery switching and preference persistence. The project uses army journeys for behavior coverage.

## Visual passes

1. The first Dash capture exposed a truncated inbox query and saturated avatars. The header now wraps the query and uses gold-accented icon and avatar styling.
2. Reviewed both palettes and all four cards side by side. Straightened inbox separators, used the kit’s brand glyphs and gave the Spotify playback button a circular 44 px target.
3. Compared the inbox captures with the supplied targets and reviewed all four cards for alignment, contrast and bottom clipping. The comparison panels show the supplied before image, supplied target and captured Dash chat, from left to right. Gmail retains the kit’s pin and search actions. The Gallery picker stays visible while scrolling, and the Stripe capture waits for the total animation to settle.

- [Gmail Dash comparison](compare-gmail-dash.png) and [Gmail App comparison](compare-gmail-app.png)
- [GitHub Dash](github-dash.png) and [GitHub App](github-app.png)
- [Stripe Dash](stripe-dash.png) and [Stripe App](stripe-app.png)
- [Spotify Dash](spotify-dash.png) and [Spotify App](spotify-app.png)
- [Gallery Dash](gallery-dash.png) and [Gallery App](gallery-app.png)

## Runtime coverage

These captures cover headless Chromium on macOS, using the lane’s pass-through adapter for Linux bwrap and loopback ports in the reserved range. Native Android WebView and iOS sizing, platform font rendering and touch behavior remain unverified. Proof Mono is mapped by the card host and was outside this browser run. O15 release gating requires the full army.
