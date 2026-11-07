import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  ZoomIn,
  ZoomOut,
  ReduceMotion,
} from "react-native-reanimated";
import { MOTION_MS, crossfade, entranceDelay } from "../motion";

export const enterUp = FadeInUp.duration(MOTION_MS.enter).reduceMotion(ReduceMotion.System);

export const enterDown = FadeInDown.duration(MOTION_MS.enter).reduceMotion(ReduceMotion.System);

export const popIn = ZoomIn.duration(MOTION_MS.enter).reduceMotion(ReduceMotion.System);

export const popOut = ZoomOut.duration(MOTION_MS.exit).reduceMotion(ReduceMotion.System);
export const fadeOut = FadeOut.duration(MOTION_MS.exit).reduceMotion(ReduceMotion.System);

/** Opacity-only status enter/exit. Reduce motion keeps the crossfade (REDUCED_MOTION.opacity). */
export const statusIn = FadeIn.duration(MOTION_MS.crossfade).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.Never);
export const statusOut = FadeOut.duration(MOTION_MS.crossfade).easing(Easing.out(Easing.cubic)).reduceMotion(ReduceMotion.Never);

/** withTiming config for translate/scale/height: reduce motion jumps to the end (REDUCED_MOTION.spatial). */
export function spatial<T extends { duration: number }>(token: T) {
  "worklet";
  return { ...token, reduceMotion: ReduceMotion.System };
}

/** withTiming config for opacity: reduce motion still crossfades. */
export function opacity(token: { duration: number } = crossfade) {
  "worklet";
  return { ...token, reduceMotion: ReduceMotion.Never };
}

export function staggerUp(index: number) {
  return enterUp.delay(entranceDelay(index));
}
