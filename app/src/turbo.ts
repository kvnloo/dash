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

/** Identity of the JavaScript bundle, not the bridge or phone application's installed binary. */
export interface ServedBuild {
  sha: string | null;
  servedAtMs: number | null;
}

/** Parse build-time EXPO_PUBLIC values without treating absent metadata as a fresh build. */
export function parseServedBuild(shaValue: string | undefined, timeValue: string | undefined): ServedBuild {
  const candidate = shaValue?.trim() ?? "";
  const sha = /^[0-9a-f]{7,64}$/i.test(candidate) ? candidate.toLowerCase() : null;
  const timestamp = timeValue?.trim() ?? "";
  let servedAtMs: number | null = null;

  if (/^\d{10}$/.test(timestamp)) servedAtMs = Number(timestamp) * 1_000;
  else if (/^\d{13}$/.test(timestamp)) servedAtMs = Number(timestamp);
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp)) {
    servedAtMs = Date.parse(timestamp);
  }

  return {
    sha,
    servedAtMs: servedAtMs !== null && Number.isFinite(servedAtMs) && servedAtMs > 0 ? servedAtMs : null,
  };
}

// The direct property reads let Expo inline these values into the JS bundle.
// The Metro launcher must set both for the chip to show a real SHA and age.
export const SERVED_BUILD = parseServedBuild(
  process.env.EXPO_PUBLIC_DASH_BUILD_SHA,
  process.env.EXPO_PUBLIC_DASH_BUILD_TIME,
);

export function servedAgeLabel(servedAtMs: number | null, nowMs: number): string {
  if (servedAtMs === null || !Number.isFinite(nowMs)) return "age unknown";
  const ageMs = nowMs - servedAtMs;
  if (ageMs < -60_000) return "clock skew";
  if (ageMs < 60_000) return "just served";
  if (ageMs < 3_600_000) return Math.floor(ageMs / 60_000) + "m old";
  if (ageMs < 86_400_000) return Math.floor(ageMs / 3_600_000) + "h old";
  return Math.floor(ageMs / 86_400_000) + "d old";
}

export function servedBuildLabel(build: ServedBuild, nowMs: number): string {
  return (build.sha?.slice(0, 7) ?? "SHA ?") + " · " + servedAgeLabel(build.servedAtMs, nowMs);
}

/** Use both fields so a newly served bundle reappears after hiding the previous one. */
export function servedBuildKey(build: ServedBuild): string {
  return (build.sha ?? "?") + ":" + (build.servedAtMs ?? "?");
}

export function shouldShowServedChip(turbo: boolean, hiddenFor: string | null, build: ServedBuild): boolean {
  return turbo && hiddenFor !== servedBuildKey(build);
}
