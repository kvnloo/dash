import { Children, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import { tileColumns } from "../lib/tile-layout";
import { useDensity } from "./Density";

/** Reflow whole tiles before large type breaks words into unreadable character columns. */
export function TileGrid({ children, inset = 16, gap = 8 }: { children: ReactNode; inset?: number; gap?: number }) {
  const { width } = useWindowDimensions();
  const { density, fontScale } = useDensity();
  const available = Math.max(0, width - inset * 2);
  const columns = tileColumns(available, density, fontScale, gap);
  const cell = (available - gap * (columns - 1)) / columns;
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap, paddingHorizontal: inset, alignItems: "stretch" }}>
    {Children.toArray(children).map((child, index) => <View key={index} style={{ width: cell, minWidth: 0 }}>{child}</View>)}
  </View>;
}
