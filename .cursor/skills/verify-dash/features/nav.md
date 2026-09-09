# Pager gold

The collapsed pager is a 144×50 stadium with a gold pill that follows Bots / Chats / Orchestra. Native AppNav is a WebView of the same CSS.

## Sub-features

- `nav-colors` paints sRGB gold `#d7b986`, 68% fill, cream rim, stadium `rgba(12,13,11,0.874)`.
- `nav-indicator` sets `left: calc(3px + n * (100% - 6px) / 3)`.
- `nav-swipe` moves the pill when Main's pager index changes.

## How to get to it (user POV)

- Main screen bottom chrome.
- Tap a pager slot or swipe the body.

## Driving it with control-dash

Preconditions:

- Doctor optional. Nav unit tests do not need the bridge.

- **Unit tests.** Run `bun scripts/verify-dash/control-dash.ts test`. `nav` exit 0. This is the default proof.
- **Phone.** Shake → Reload. Swipe Bots / Chats / Orchestra. Gold tracks the page.
- **Debug web (8099).** `run({ action: "setMainTab", index: 2 })`. Screenshot the pager, not the whole phone chrome only.
- **Proof.** `artifacts/verify-dash/tests.json` `nav.code === 0`. Pixel claims need a screenshot against `docs/design/frames/golden-nav-probe.png`.

## Gotchas

- `oklch` / `color-mix` drop on Android WebView. sRGB must be listed first in CSS.
- Pair / Settings / Voice freeze the pager on tab 1 by design. Only Main is wired to the swipe index.
