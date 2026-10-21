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
export const snappy = { duration: 150, easing: criticalProgress };
/** Only for direct-manipulation release; not layout or graph movement. */
export const settle = { duration: 180, easing: criticalProgress };
export const fade = { duration: 120 };
export const nav = { duration: 160 };
export const press = { duration: 70 };

/** Compatibility names for existing consumers; no elastic nav spring. */
export const GEL = snappy;
export const SNAP = snappy;

/** Signed velocity in the same units as distance. Bounded, monotone settle. */
export function navDuration(distance: number, velocity: number, reduced = false): number {
  "worklet";
  if (reduced) return 0;
  const toward = distance * velocity > 0;
  return toward ? Math.max(80, Math.min(nav.duration, Math.abs(distance / velocity) * 1000)) : nav.duration;
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
  enter: 150,
  exit: 120,
  stagger: 0,
} as const;
