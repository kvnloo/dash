---
name: dash-motion
description: S-tier Expo/Reanimated 4 motion for Dash. Use when adding press, enter/exit, list, composer, or nav micro-interactions on the phone.
---

# Dash motion

Dash is Expo Go on an S25 Ultra. Motion is Reanimated 4 on the UI thread. The gold nav pill already has gel physics in `golden-nav.ts`. Everything else uses `app/src/motion.ts` + `PressScale`.

Pair with `building-native-ui/references/animations.md` (Reanimated v4, springs, transforms, <300ms) and `emilkowalski-motion` (one language, 140–220ms controls, stagger only small groups). This skill overrides Expo defaults where they fight FPS or the 60px native nav.

## Stack

- `react-native-reanimated` 4 only. Never `Animated` from `react-native`.
- Gestures: `react-native-gesture-handler` + shared values. No JS-thread `onScroll`.
- Haptics: `haptic.tap()` / `select()` / `success()` from `app/src/haptics.ts`. Press scale without a haptic feels cheap; haptic without scale feels dead.
- Keyboard: `KeyboardDock`. Do not animate `paddingBottom` by hand to chase the IME.

## Primitives (use these)

| Feel | API | Where |
|------|-----|--------|
| Press squash | `PressScale` + `PRESS_SCALE.row` (0.985) / `.control` (0.92) / `.nav` (0.9) | Rows, chips, send, nav circles |
| Appear | `enterUp` / `enterDown` / `popIn` from `motion-enter.ts` | Chips, send button, connection pill |
| Disappear | `fadeOut` / `popOut` (~140ms) | Send ↔ mic swap, chips |
| Layout reflow | `LinearTransition.springify()` with `SNAP` | Chip rows only |
| Idle pulse | `PulseDot` (opacity, UI thread) | Streaming status |

Springs live in `app/src/motion.ts`. Press is snappier than the gel pill (`SNAP` vs `GEL`). Do not invent a third spring.

```tsx
<PressScale scaleTo={PRESS_SCALE.control} onPress={submit} accessibilityRole="button">
  <Ionicons name="arrow-up" />
</PressScale>

<Animated.View entering={popIn} exiting={popOut}>
  {/* send circle */}
</Animated.View>
```

## Rules that keep 0.1% lows

- Animate **transform** and **opacity** only. Never width, height, padding, margin, or `top`.
- One blur per surface, baked into `GlassSurface`. Never blur-per-frame, never extra shadows during a fling.
- No `GOLD_GLOW` overlay on native `AppNav`. The pill is gel (`pillStep` / `pillStretch`), not a drop-shadow.
- **Never** `entering=` on FlashList rows (Bots, Chats, Orchestra, messages, search). Recycle remounts would replay the animation and hitch.
- Keep work under ~300ms. Springs, not 500ms eases.
- `ReduceMotion.System` on every `withSpring`. Honor the OS.
- Nav press scales the **circle / tab**, not the gel track. Do not put layout animations on `AppNav`.
- Offscreen pager stays `offscreenPageLimit={1}`. Do not add per-page enter animations.

## Where micro-interactions belong

1. **Every pressable** — `PressScale`. Kill `opacity: 0.85` pressed styles; squash is the feedback.
2. **Send affordance** — gold circle `popIn` when `canSend` becomes true; `popOut` when it clears. Pair with existing send haptic.
3. **Scope chips** (`@` `/`) — `staggerUp(i)` at 36ms, `LinearTransition` on the wrap, press squash.
4. **Connection pill** — `enterDown` when the bridge drops.
5. **Nav** — expand / menu / tabs squash; pill stays on its own spring.
6. **Bridge pull** — down chevron + top pan. Sheet `translateY` + GEL spring. Rubber past open. No Modal.
7. **Streaming** — `PulseDot` only. Do not bounce the whole message row.

Skip: layout morphs on the composer shell, width-animated pills, per-character pair-code bounce, anything that runs during a pager fling.

## Anti-patterns

- `FadeIn.duration(500)` on lists
- `withTiming` for presses (use `withSpring`)
- Nested `Pressable` inside `PressScale`
- WebView nav, 80px chrome, glow overlays
- `useEffect` → `setState` to drive motion (do it with shared values)
- `LayoutAnimation` from React Native
