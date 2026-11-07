import {
  FadeInDown,
  FadeInUp,
  FadeOut,
  ZoomIn,
  ZoomOut,
  ReduceMotion,
} from "react-native-reanimated";
import { MOTION_MS, entranceDelay } from "../motion";

export const enterUp = FadeInUp.duration(MOTION_MS.enter).reduceMotion(ReduceMotion.System);

export const enterDown = FadeInDown.duration(MOTION_MS.enter).reduceMotion(ReduceMotion.System);

export const popIn = ZoomIn.duration(MOTION_MS.enter).reduceMotion(ReduceMotion.System);

export const popOut = ZoomOut.duration(MOTION_MS.exit).reduceMotion(ReduceMotion.System);
export const fadeOut = FadeOut.duration(MOTION_MS.exit).reduceMotion(ReduceMotion.System);

export function staggerUp(index: number) {
  return enterUp.delay(entranceDelay(index));
}

