import { useEffect } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { ambient } from "../../motion-ambient";
import { useAmbientRunning } from "../OrbMotion";
import { colors, glass } from "../../theme";

/** Trace palette: one neutral base and three accents (round 3). */
export const tc = {
  live: colors.information,
  ask: colors.warn,
  cut: colors.danger,
  ok: colors.ok,
  bar: "rgba(236,232,223,.07)",
  barEdge: "rgba(236,232,223,.20)",
  barLive: "rgba(129,185,218,.12)",
  barLiveEdge: "rgba(129,185,218,.55)",
  tick: "rgba(236,232,223,.38)",
  grid: glass.quiet,
  rule: glass.hair,
  text: colors.text,
  text2: colors.textMuted,
  text3: colors.textTertiary,
  faint: colors.textFaint,
  raised: colors.surfaceRaised,
} as const;

/**
 * Subtle live pulse: opacity 0.55↔1 and scale 1↔1.35 on a 1.6 s loop.
 * Holds still under reduced motion.
 */
export function LivePulse({ size = 6, color = tc.live, style }: { size?: number; color?: string; style?: ViewStyle }) {
  const running = useAmbientRunning();
  const p = useSharedValue(0);
  useEffect(() => {
    if (!running) { cancelAnimation(p); p.value = 1; return; }
    p.value = withRepeat(withTiming(1, ambient(800)), -1, true);
    return () => cancelAnimation(p);
  }, [p, running]);
  const halo = useAnimatedStyle(() => ({ opacity: 0.35 * (1 - p.value), transform: [{ scale: 1 + p.value * 1.4 }] }));
  const dot = useAnimatedStyle(() => ({ opacity: 0.55 + 0.45 * p.value }));
  const box = { width: size, height: size, borderRadius: size / 2 };
  return (
    <Animated.View style={[{ width: size, height: size }, style]} accessibilityLabel="live" testID="live-pulse">
      <Animated.View style={[StyleSheet.absoluteFill, box, { backgroundColor: color }, halo]} />
      <Animated.View style={[StyleSheet.absoluteFill, box, { backgroundColor: color }, dot]} />
    </Animated.View>
  );
}
