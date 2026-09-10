/** Shared Reanimated springs. Press is snappier than the nav gel. */

export const GEL = {
  mass: 0.4,
  stiffness: 240,
  damping: 13,
} as const;

export const SNAP = {
  mass: 0.32,
  stiffness: 420,
  damping: 22,
} as const;

export const PRESS_SCALE = {
  row: 0.985,
  control: 0.92,
  nav: 0.9,
} as const;

export const MOTION_MS = {
  enter: 240,
  exit: 140,
  stagger: 36,
} as const;
