/** Turbo (dogfood) mode: the live preview build runs every animation faster so iteration feels instant.
 * Set at bundle time by the preview Metro (EXPO_PUBLIC_DASH_TURBO=1); the stable build is unaffected. */
export const TURBO = process.env.EXPO_PUBLIC_DASH_TURBO === "1";
/** Multiplier for every duration: transitions, presses, ambient orb loops. */
export const SPEED = TURBO ? 0.55 : 1;
export function turboMs(duration: number): number {
  return Math.max(1, Math.round(duration * SPEED));
}
