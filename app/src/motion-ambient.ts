import { Easing, ReduceMotion } from "react-native-reanimated";

/** Ambient status loops are not interaction transitions; keep their readable cadence. */
export function ambient(duration: number, linear = false) {
  return { duration, easing: linear ? Easing.linear : Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System };
}
