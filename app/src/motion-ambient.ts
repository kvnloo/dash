import { Easing, ReduceMotion } from "react-native-reanimated";
import { turboMs } from "./turbo";

/** Ambient status loops are not interaction transitions; keep their readable cadence. */
export function ambient(duration: number, linear = false) {
  return { duration: turboMs(duration), easing: linear ? Easing.linear : Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System };
}
