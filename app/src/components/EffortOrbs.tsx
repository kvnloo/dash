import { memo, type ReactNode, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { VisualEffort, VisualRuntimeState } from "../catalog/visual";

const reduce = ReduceMotion.System;

function Orbit({
  angle,
  radius,
  size,
  color,
  spin,
}: {
  angle: number;
  radius: number;
  size: number;
  color: string;
  spin: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle + spin.value * 360}deg` }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, style]}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ translateY: -radius }],
        }}
      />
    </Animated.View>
  );
}

export const EffortOrbs = memo(function EffortOrbs({
  hue,
  size,
  effort,
  state,
  children,
  accessibilityLabel,
}: {
  hue: string;
  size: number;
  effort: VisualEffort;
  state: VisualRuntimeState;
  children?: ReactNode;
  accessibilityLabel?: string;
}) {
  const spin = useSharedValue(0);
  const pulse = useSharedValue(state.cadence.opacityMax);
  const { cadence } = state;
  const orbitCount = cadence.rotate ? effort.orbits : 0;
  const orbSize = Math.max(3, Math.round(size * (0.08 + 0.06 * effort.energy)));
  const color = effort.accent || hue;

  useEffect(() => {
    if (cadence.rotate) {
      const duration = Math.max(280, Math.round(cadence.periodMs * (1.15 - 0.55 * effort.energy)));
      spin.value = 0;
      spin.value = withRepeat(withTiming(1, { duration, easing: Easing.linear, reduceMotion: reduce }), -1, false);
    } else {
      cancelAnimation(spin);
      spin.value = 0;
    }
    if (cadence.periodMs > 0 && cadence.opacityMin !== cadence.opacityMax) {
      const half = cadence.periodMs / 2;
      pulse.value = cadence.opacityMin;
      pulse.value = withRepeat(
        withSequence(
          withTiming(cadence.opacityMax, { duration: half, easing: Easing.inOut(Easing.quad), reduceMotion: reduce }),
          withTiming(cadence.opacityMin, { duration: half, easing: Easing.inOut(Easing.quad), reduceMotion: reduce }),
        ),
        -1,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = cadence.opacityMax;
    }
  }, [cadence, effort.energy, pulse, spin]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      {Array.from({ length: orbitCount }, (_, i) => (
        <Orbit
          key={i}
          angle={(360 / orbitCount) * i}
          radius={size * (0.38 + (i % 2) * 0.07 * effort.energy)}
          size={orbSize}
          color={color}
          spin={spin}
        />
      ))}
      <Animated.View style={pulseStyle}>{children}</Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
});
