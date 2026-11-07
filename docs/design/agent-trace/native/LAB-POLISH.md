# Lab sizing and tile interaction contract

The single `DensityProvider` owns Compact / Comfortable / Rich across Lab, Trace and Orchestra. Density changes presentation, never the evidence or action authority. `Aa 160%` is an explicit typography/layout preview on top of the native system font scale; it is not a claim of device accessibility qualification.

## Sizing

`componentSizing` in `app/src/lib/tile-layout.ts` defines minima, not fixed container heights. Text may grow intrinsic height; parents must supply `minWidth: 0`, stretch their children and avoid an aspect ratio on charts.

| Component | Compact / Comfortable / Rich | Flex / aspect rule |
|---|---|---|
| Generic tile / row | 44 / 60 / 84 px minimum, scaled for large type | Stretch width; no fixed height or aspect |
| Trace profiler / timeline row | Above minima, at least 52 × font scale and enough height for packed lanes | Label and plot use identical item heights; worker bands divide available vertical space, reserving note space |
| Timeline on resize | Preserve normalized translation and zoom, clamp to new bounds | Plot width follows the actual row, not a stale initial measure |
| Timeline axis | Intrinsic 34 px | Thin hours using scaled label width; reserve separation before the now-label |
| Stat tile | 100 / 136 / 176 px minimum, scaled for large type | Responsive 1–3-column TileGrid reflows before narrow character wrapping; equal-height stretched inner surfaces; spark fills its column, intrinsic chart height 28 px |
| READ | Intrinsic multiline height; padding 8 / 12 / 18 px | Stretch width; animated and static text share preview scaling |
| Action chip | Row minimum plus intrinsic title/body/buttons; padding 8 / 12 / 18 px | Stretch width, retain its existing horizontal swipe arbitration |
| Orb | Explicit 20 / 40 / 64 / 48 px square | No hidden 76 px native box; captions remain outside the orb square |
| Orchestra card | Stat-tile minimum and density padding | Existing GlassSurface language and navigation retained |

There is no component named `Profiler` in merged #88's source. The available profiler-like view is the trace timeline/waterfall; its lane sizing, width-resize behavior and large-type axis were repaired here. Do not represent this as verification of a separate, unidentified profiler implementation.

## Gesture contract

`useTileGestures` uses Gesture Handler and Reanimated. A 180 ms inter-tap window arbitrates triple > double > single, with immediate press-in feedback. Movement fails taps; multiple pointers fail the hold. The plot's existing pan/pinch/scrub handlers and action-chip swipes are not wrapped in competing tile gestures.

- Single: existing navigation where supplied, otherwise a measured tile-to-detail overlay.
- Double: reversible pin local to the mounted view. It does not imply a persisted favourites system.
- Triple: explicit clipboard copy, with success/failure text.
- Hold 350 ms: 4–8 directional actions. Slide and release commits; centre release or pointer cancellation cancels. A selection tick occurs only on sector entry; commit uses the stronger success haptic. Native haptics require native evidence.
- The wheel clamps to the viewport and mirrors action directions, never text, through `useHandedness`.
- Native accessibility actions expose the same actions. On web, Enter/Space opens, P pins and C copies when the tile itself has focus.
- On web, `pan-y` permits ordinary browser scrolling. A non-passive, hold-gated touch listener reserves vertical movement only after activation. This listener is absent from the native implementation; native motion stays on the UI thread.
- Contextual Orchestra feedback is an explicitly selected radial action, not an automatic long-press side effect. No approval or upstream mutation is attached to double taps.

Motion adds bounded spring-response press/shadow, measured detail morph, direct native-text number tickers, hold tilt and radial bloom. The newly integrated fast-first policy keeps all tiles immediately usable: no stagger delay is reintroduced. Existing timeline rubber-band/pinch and its newly bounded velocity settle remain. Reduced motion disables geometric transitions and continuous orb motion; detail uses an opacity transition.

## Performance

The previous thinking-orbs adapter built pictures and called React `setState` on each JS animation frame for every orb. Dash now renders static depth-banded SVG paths and uses one Reanimated clock with compositor transforms, native raster caching, app-background and screen-focus stops. This preserves the monochrome dotted-sphere language, not exact per-mode geometry parity with the third-party engine. Thinking, tool, streaming and paused/approval states remain distinguishable.

Lab uses FlashList section cells with stable memoized content and viewability-gated orb activity. Normal Lab caps animated state samples at six; `Animate 20` is an explicit all-thinking stress fixture. This is not a claim of a global animation budget for every third-party component elsewhere in Dash. The newly integrated fast-first READ policy removes simulated loading for text that is already known; no shimmer clock is reintroduced.

## Reproduction

Export a debug-enabled Expo web build, serve it with an SPA fallback, then run:

    node scripts/lab-polish-proof.mjs http://127.0.0.1:PORT OUTPUT_DIRECTORY

The harness launches its own headless Chromium with 412×915 touch emulation, checks three widths and three densities at 100% / 160% type, captures profiler rows and morph/wheel sequences, and asserts tap arbitration, scroll arbitration, cancellation, left-handed and vertical wheel selection, keyboard activation, reduced-motion orb stability, resize bounds and zero browser errors. It never attaches to a phone or an existing browser.

Detailed before/after rAF intervals and CDP timing receipts are in the worker's run report. Browser missed-frame estimates are not Android frame telemetry. Bots' shared Tree/ReplyBlocks/tool-row files are intentionally left to the concurrent detail worker; adopting these gestures there must preserve disclosure, keyboard tree semantics and swipe collapse rather than nesting competing handlers.
