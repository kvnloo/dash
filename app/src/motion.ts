import { dsh } from "./turbo";
/** Fast first: motion confirms an action, never gates it.
 * A normalized critically damped response has a hard timing deadline.
 * Duration springs are not deadlines: their energy tail can run longer.
 * System reduced-motion handling is applied by the renderer, keeping these
 * tokens dependency-free and mutation-testable.
 */
export function criticalProgress(t: number): number {
  "worklet";
  return (1 - (1 + 9 * t) * Math.exp(-9 * t)) / (1 - 10 * Math.exp(-9));
}
export const snappy = { duration: dsh(150, 100), easing: criticalProgress };
/** Only for direct-manipulation release; not layout or graph movement. */
export const settle = { duration: dsh(180, 120), easing: criticalProgress };
export const fade = { duration: dsh(120, 100) };
/** Reserve two display frames of scheduling headroom inside the 180 ms release budget. */
export const nav = { duration: dsh(140, 120) };
export const press = { duration: dsh(70, 60) };

/** Compatibility names for existing consumers; no elastic nav spring. */
export const GEL = snappy;
export const SNAP = snappy;

/**
 * Spring constants for the same response as `criticalProgress`: a critically damped spring
 * (damping ratio exactly 1, no overshoot) that reaches its target at omega * t = 9 by `durationMs`.
 * Dash renders it with `withTiming(…, { duration, easing: criticalProgress })` so the deadline is
 * hard; these numbers are for other z0 apps and spring APIs that need the same feel.
 */
export function criticalSpring(durationMs: number) {
  "worklet";
  const omega = 9000 / durationMs;
  return { mass: 1, stiffness: omega * omega, damping: 2 * omega, overshootClamping: true } as const;
}
export function dampingRatio(spring: { mass: number; stiffness: number; damping: number }): number {
  "worklet";
  return spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
}
export const SPRING = {
  snappy: criticalSpring(snappy.duration),
  settle: criticalSpring(settle.duration),
} as const;

/**
 * Distance-based duration: a longer move takes longer, but sub-linearly (square root) and never past
 * `far`. Zero distance gets `near`; a move of `span` or more gets `far`. Monotone and bounded.
 */
export function distanceDuration(distance: number, near: number, far: number, span: number): number {
  "worklet";
  if (!(span > 0) || !Number.isFinite(distance)) return near;
  const fraction = Math.min(1, Math.abs(distance) / span);
  return Math.round(near + (far - near) * Math.sqrt(fraction));
}

/** One page keeps `nav`; a jump across four or more pages takes the full release budget (`settle`). */
export function pageDuration(pages: number): number {
  "worklet";
  return distanceDuration(Math.max(0, Math.abs(pages) - 1), nav.duration, Math.max(nav.duration, settle.duration), 3);
}

/** Window open morph: a row near the centre opens in `fade` time, a far row in `settle` time. */
export function morphDuration(travel: number, windowHeight: number): number {
  "worklet";
  return distanceDuration(travel, fade.duration, settle.duration, windowHeight / 2);
}

/**
 * Reduce motion: spatial motion (translate, scale, height) is removed, and the state change stays
 * visible as an opacity crossfade in `fade` time. Opacity is not motion, so it is never skipped.
 */
export const REDUCED_MOTION = { spatial: "jump", opacity: "crossfade" } as const;
export const crossfade = { duration: fade.duration };

/** Press feedback under reduce motion is no scale at all, not an instant scale jump. */
export function pressScaleFor(scaleTo: number, reduced: boolean): number {
  "worklet";
  return reduced ? 1 : scaleTo;
}

/** Signed velocity in the same units as distance. Bounded, monotone settle. */
export function navDuration(distance: number, velocity: number, reduced = false): number {
  "worklet";
  if (reduced) return 0;
  const base = pageDuration(distance);
  const toward = distance * velocity > 0;
  return toward ? Math.max(80, Math.min(base, Math.abs(distance / velocity) * 1000)) : base;
}

/** Monotone Hermite settle; preserves release velocity unless it would overshoot. */
export function navProgress(t: number, distance: number, velocity: number, duration: number): number {
  "worklet";
  const slope = distance === 0 ? 0 : Math.max(0, Math.min(3, velocity * duration / (1000 * distance)));
  return (slope - 2) * t * t * t + (3 - 2 * slope) * t * t + slope * t;
}

/** Release velocity uses the same units as the animated value, not screen pixels. */
export function settleTiming(distance: number, velocity: number) {
  "worklet";
  const duration = navDuration(distance, velocity);
  return { duration, easing: (t: number) => {
    "worklet";
    return navProgress(t, distance, velocity, duration);
  } };
}

/** Drop stagger entirely: every item is usable immediately, even in long lists. */
export function entranceDelay(_index: number): number {
  "worklet";
  return 0;
}

export const PRESS_SCALE = {
  row: 0.985,
  control: 0.92,
  nav: 0.9,
} as const;

export const MOTION_MS = {
  enter: dsh(150, 0),
  exit: dsh(120, 0),
  /** Status surfaces (connection pill, queued stack) fade even in turbo; opacity is not motion. */
  crossfade: fade.duration,
  stagger: 0,
} as const;
