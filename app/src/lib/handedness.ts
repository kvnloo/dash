import type { ViewStyle } from "react-native";

export type Handedness = "right" | "left" | "auto";
export type ThumbSide = "right" | "left";

export function parseHandedness(value: unknown): Handedness {
  return value === "left" || value === "auto" ? value : "right";
}

export function resolveHandedness(preference: Handedness, system?: ThumbSide): ThumbSide {
  return preference === "auto" ? system ?? "right" : preference;
}

/** Placement only: never apply transforms or RTL to text, charts, or page order. */
export function thumbLayout(side: ThumbSide) {
  const isLeft = side === "left";
  const row: ViewStyle = { flexDirection: isLeft ? "row-reverse" : "row" };
  const align: ViewStyle = { alignSelf: isLeft ? "flex-start" : "flex-end" };
  return {
    side,
    opposite: isLeft ? "right" : "left",
    isLeft,
    row,
    align,
    edge(offset: number): ViewStyle {
      return isLeft ? { left: offset, right: undefined } : { right: offset, left: undefined };
    },
    railPadding(width: number): ViewStyle {
      return isLeft ? { paddingLeft: width, paddingRight: 0 } : { paddingRight: width, paddingLeft: 0 };
    },
    /** Signed horizontal offset/direction, expressed in right-handed coordinates. */
    offset(value: number): number { return isLeft ? -value : value; },
  };
}
