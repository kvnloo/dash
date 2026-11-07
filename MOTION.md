# Motion

This file is the motion contract for Dash. The other z0 apps use the same numbers (see "Other z0 apps").
The tokens live in `app/src/motion.ts`. The renderer helpers live in `app/src/components/motion-enter.ts`.
Tests in `app/src/components/motion.test.ts` lock both.

The technique names below come from the oneshotprompts.com motion vocabulary
(`/techniques/<name>/`). Use these names in prompts and reviews, so that an agent and a person mean the same motion.

## Laws

1. **Fast first.** Motion confirms an action. It never gates the action. Every finite transition ends in 180 ms or less
   (`settle`, the release budget). Turbo (`dsh`) makes each token shorter, never longer.
2. **No overshoot on layout or navigation.** Use a *critically damped spring*: damping ratio 1, no bounce.
   An *underdamped spring* (a wobble) or an *elastic ease* is not permitted on a layout, a page, or a sheet.
   The code does not use `withSpring`. We render the critical response with `withTiming` so that the deadline is hard.
3. **Distance-based duration.** A longer move takes longer, but sub-linearly (square root) and never past `far`.
4. **Interruptible motion.** A shared value is cancelled and retargeted. It is never queued.
   On a gesture release, the release velocity is kept (*velocity-preserving retarget*: `navProgress`, `settleTiming`).
5. **Reduce motion = no travel, keep the crossfade.** Under the OS reduce-motion setting, translate, scale and height
   jump to the end (`ReduceMotion.System`). Opacity still crossfades in `fade` time (`ReduceMotion.Never`).
   The user still sees each state change, but nothing moves. Press feedback has no scale (not an instant scale).
6. **No stagger.** Every row is usable at once (`entranceDelay` = 0).
7. **Ambient loops are not transitions.** Use `ambient()` in `motion-ambient.ts`. Loops stop on blurred screens.

## Tokens

| Token | Normal | Turbo | Use |
|---|---:|---:|---|
| `press` | 70 ms | 60 ms | *Press depress*: scale to `PRESS_SCALE` (row 0.985, control 0.92, nav 0.9) |
| `fade` / `crossfade` / `MOTION_MS.crossfade` | 120 ms | 100 ms | Opacity, exits, status surfaces, the reduce-motion crossfade |
| `nav` | 140 ms | 120 ms | One page of the tab pager |
| `snappy` | 150 ms | 100 ms | Default open, toggles, the mic pill |
| `settle` | 180 ms | 120 ms | Gesture release, and the ceiling for distance-based durations |
| `MOTION_MS.enter` / `exit` | 150 / 120 ms | 0 / 0 | Layout enter and exit builders (`enterUp`, `popIn`, `fadeOut`) |

### Spring constants

`criticalProgress(t) = (1 - (1 + 9t)e^(-9t)) / (1 - 10e^(-9))` is a critically damped spring that reaches its target at
omega * t = 9. `criticalSpring(ms)` gives the same response as spring constants: `mass 1`, `stiffness = omega^2`,
`damping = 2 * omega`, with `omega = 9000 / ms` and `overshootClamping: true`.

| Token | Duration | Stiffness | Damping | Damping ratio |
|---|---:|---:|---:|---:|
| `SPRING.snappy` | 150 ms | 3600 | 120 | 1 |
| `SPRING.settle` | 180 ms | 2500 | 100 | 1 |

Do not use these constants with `withSpring` in Dash. The source tests forbid it. They are for apps and libraries
that only have a spring API (Framer Motion, SwiftUI, Compose).

### Distance-based durations

`distanceDuration(distance, near, far, span) = near + (far - near) * sqrt(min(1, |distance| / span))`

| Function | near | far | span | Distance |
|---|---|---|---|---|
| `pageDuration(pages)` | `nav` | `settle` | 3 | Pages past the first. One page = 140 ms, two = 163 ms, four or more = 180 ms |
| `morphDuration(travel, h)` | `fade` | `settle` | h / 2 | Pixels from the source row to the window centre |

A fling toward the target still finishes early. `navDuration` takes the minimum of the page budget and
distance / velocity, with a floor of 80 ms.

## The five most visible transitions

| # | Surface | Technique | Before | Now |
|---|---|---|---|---|
| 1 | Tab pager (tap a tab, `setPage`) | *Tab panel slide*, *distance-based duration* | 140 ms for any jump, so a four-page jump was a blur | `pageDuration`: 140 ms for one page, up to 180 ms. Swipes are unchanged |
| 2 | Chat window open/close (`useWindowMorph`) | *Shared-element transition* (card to detail) | 150 ms from any row. Reduce motion jumped with no feedback | `morphDuration`: 120 ms near the centre to 180 ms from the edge. Reduce motion: opacity crossfade only |
| 3 | Press feedback (`PressScale`, on every row and control) | *Press depress* | Reduce motion still jumped to the pressed scale | `pressScaleFor`: no scale under reduce motion |
| 4 | Connection banner and queued stack (`ConnectionPill`, `QueuedStack`) | *Toast slide-in stack* (fade only) | Literal 110 ms. The queue used the *exit* duration for its enter and ignored reduce motion | `statusIn` / `statusOut`: `MOTION_MS.crossfade`, kept under reduce motion |
| 5 | Mic hold pill (`MicButton`) | *Segmented control slide* | Height, knob and icon motion ignored reduce motion | `spatial(snappy)`: jumps under reduce motion |

## Renderer helpers (`motion-enter.ts`)

- `spatial(token)`: a `withTiming` config for translate, scale and height. It adds `ReduceMotion.System`.
- `opacity(token = crossfade)`: a `withTiming` config for opacity. It adds `ReduceMotion.Never`.
- `statusIn` / `statusOut`: opacity-only layout builders for status surfaces.
- `enterUp`, `enterDown`, `popIn`, `popOut`, `fadeOut`: layout builders. These are spatial, so they use `ReduceMotion.System`.

A new finite animation must use a token and one of these helpers. Do not write a literal duration in a component.

## Other z0 apps

Web (CSS) equivalents of the same curve and durations:

```css
:root {
  --ease-critical: linear(0, 0.228, 0.538, 0.752, 0.875, 0.940, 0.972, 0.988, 0.995, 0.998, 1);
  --dur-press: 70ms; --dur-fade: 120ms; --dur-nav: 140ms; --dur-snappy: 150ms; --dur-settle: 180ms;
}
@media (prefers-reduced-motion: reduce) {
  /* Keep the opacity crossfade; remove transform, size and position transitions. */
  .motion-spatial { transition-property: opacity; }
  html { scroll-behavior: auto; }
}
```

For a distance-based duration on the web, compute `distanceDuration` in JavaScript and set `transition-duration`
inline. With a spring API, use the `SPRING` constants with overshoot clamping on.

## Review checklist

- Does the transition end in 180 ms or less, and in turbo too?
- Is there overshoot on a layout, page or sheet? It must not have one.
- Does a longer travel get a longer (bounded) duration?
- Can a new gesture or tap interrupt it?
- With reduce motion on, does nothing move, and is each state change still visible as a crossfade?
