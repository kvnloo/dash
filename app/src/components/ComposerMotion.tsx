import { useIsFocused } from "@react-navigation/native";
import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { snappy } from "../motion";
import { colors } from "../theme";

/** Tern's busy-only composer streak, translated to a quiet Dash edge, never fake progress. */
export function ComposerMotion({ busy, focused }: { busy: boolean; focused: boolean }) {
  const visible = useIsFocused();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const width = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (busy && visible && !reduced) progress.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [busy, visible, reduced, progress]);
  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: (width.value + 72) * progress.value - 72 }] }));
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.edge, { opacity: busy ? 0.8 : focused ? 0.35 : 0 }]} onLayout={event => { width.value = event.nativeEvent.layout.width; }} testID={busy ? "composer-working-edge" : "composer-focus-edge"}>
    {busy && !reduced ? <Animated.View style={[styles.band, sweep]} /> : <View style={styles.still} />}
  </View>;
}

/** Readiness changes only on admission edges, not per character: never delays text input. */
export function SendReadiness({ ready, children }: { ready: boolean; children: ReactNode }) {
  const value = useSharedValue(ready ? 1 : 0);
  useEffect(() => { value.value = withTiming(ready ? 1 : 0, { ...snappy, reduceMotion: ReduceMotion.System }); }, [ready, value]);
  const style = useAnimatedStyle(() => ({ opacity: 0.55 + value.value * 0.45, transform: [{ scale: 0.94 + value.value * 0.06 }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  edge: { position: "absolute", top: 0, left: 14, right: 14, height: 2, overflow: "hidden", borderRadius: 1 },
  band: { width: 72, height: 2, borderRadius: 1, backgroundColor: colors.text },
  still: { height: 1, backgroundColor: colors.textMuted },
});
