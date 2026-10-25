import type { ViewStyle } from "react-native";
import type { ThumbSide } from "./handedness";

/**
 * Place the FIRST child in a horizontal control group on the chosen thumb edge.
 *
 * Composer keeps Send / Steer / Queue / Stop / Save queued as the first JSX child,
 * followed by secondary actions. A normal row places that child at the left;
 * row-reverse places it at the right. Mirroring layout does not change handlers,
 * reading direction, message order, or navigation order.
 *
 * This is distinct from thumbLayout().row, which places the LAST JSX child
 * on the thumb edge (for example, WindowDock's close X).
 */
export function primaryFirstReachRow(side: ThumbSide): ViewStyle {
  return {
    flexDirection: side === "left" ? "row" : "row-reverse",
    justifyContent: "flex-start",
  };
}
