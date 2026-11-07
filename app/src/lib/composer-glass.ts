import { colors } from "../theme";

/**
 * The input must have an opaque ink-safe floor. Native blur may decorate the
 * rim, but it must never be the only barrier between transcript and input.
 * expo-blur's Android target sampling is available from API 31.
 */
export interface ComposerGlassPolicy {
  readonly blur: boolean;
  readonly backingColor: string;
  readonly shieldColor: string;
}

export const COMPOSER_GLASS_RIM = 1;

export function composerGlassPolicy(
  platform: string,
  androidApiLevel: number,
  hasBlurTarget: boolean,
): ComposerGlassPolicy {
  const blur = platform === "ios" || platform === "web"
    || (platform === "android" && hasBlurTarget && Number.isFinite(androidApiLevel) && androidApiLevel >= 31);

  return {
    blur,
    backingColor: colors.surfaceRaised,
    shieldColor: colors.surfaceRaised,
  };
}
