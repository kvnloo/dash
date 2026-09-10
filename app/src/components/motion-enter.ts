import {
  FadeInDown,
  FadeInUp,
  FadeOut,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
import { MOTION_MS, SNAP } from "../motion";

export const enterUp = FadeInUp.springify()
  .mass(SNAP.mass)
  .stiffness(SNAP.stiffness)
  .damping(SNAP.damping);

export const enterDown = FadeInDown.springify()
  .mass(SNAP.mass)
  .stiffness(SNAP.stiffness)
  .damping(SNAP.damping);

export const popIn = ZoomIn.springify()
  .mass(SNAP.mass)
  .stiffness(SNAP.stiffness)
  .damping(SNAP.damping);

export const popOut = ZoomOut.duration(MOTION_MS.exit);
export const fadeOut = FadeOut.duration(MOTION_MS.exit);

export function staggerUp(index: number) {
  return enterUp.delay(index * MOTION_MS.stagger);
}

