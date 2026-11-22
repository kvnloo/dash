import { memo } from "react";
import { StyleSheet } from "react-native";
import { Canvas, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";
import { colors } from "../theme";

/**
 * The working band on the composer rim, painted by Skia. A Skia redraw does not commit the React
 * Native tree, so this loop stays cheap inside the chat (where View-driven ambient loops are off:
 * they commit the whole transcript every frame). Web: AuraSweep.web.tsx.
 */
export const AuraSweep = memo(function AuraSweep({ progress, width, band }: { progress: SharedValue<number>; width: number; band: number }) {
  const start = useDerivedValue(() => vec(-band + progress.value * (width + band), 0));
  const end = useDerivedValue(() => vec(progress.value * (width + band), 0));
  return <Canvas pointerEvents="none" style={[styles.canvas, { width }]}>
    <Rect x={0} y={0} width={width} height={2}>
      <LinearGradient start={start} end={end} colors={["transparent", colors.accent, "transparent"]} />
    </Rect>
    <Rect x={0} y={2} width={width} height={12}>
      <LinearGradient start={start} end={end} colors={["transparent", `${colors.accent}2e`, "transparent"]} />
    </Rect>
  </Canvas>;
});

const styles = StyleSheet.create({ canvas: { position: "absolute", left: 0, top: 0, height: 14 } });
