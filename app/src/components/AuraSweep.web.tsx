import { memo } from "react";
import { StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { colors } from "../theme";

/** Web working band: a translated gradient (no Fabric commits on web). Native: AuraSweep.tsx (Skia). */
export const AuraSweep = memo(function AuraSweep({ progress, width, band }: { progress: SharedValue<number>; width: number; band: number }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: -band + progress.value * (width + band) }] }));
  return <Animated.View testID="composer-aura-sweep" pointerEvents="none" style={[styles.band, { width: band }, style]}>
    <LinearGradient colors={["transparent", colors.accent, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.line} />
    <LinearGradient colors={["transparent", `${colors.accent}2e`, "transparent"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.glow} />
  </Animated.View>;
});

const styles = StyleSheet.create({
  band: { position: "absolute", left: 0, top: 0, height: 14 },
  line: { height: 2 },
  glow: { height: 12 },
});
