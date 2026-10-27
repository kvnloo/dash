/** Turbo (dogfood) mode: the live preview build uses DeepSeek Harness's motion profile so iteration feels instant.
 * DSH (deepseek-ai/deepseek-harness packages/client): ~100-120 ms ease-out on opacity/transform/colour only,
 * no entrance animations on structural changes, content appears instantly (only chevrons/indicators move),
 * streaming text published once per frame. Set at bundle time by the preview Metro (EXPO_PUBLIC_DASH_TURBO=1). */
export const TURBO = process.env.EXPO_PUBLIC_DASH_TURBO === "1";
/** Multiplier for ambient loops (orbs, pulses) in turbo. */
export const SPEED = TURBO ? 0.55 : 1;
export function turboMs(duration: number): number {
  return Math.max(1, Math.round(duration * SPEED));
}
/** Pick the DSH-profile value in turbo, the normal value otherwise. */
export function dsh(normal: number, turbo: number): number {
  return TURBO ? turbo : normal;
}
