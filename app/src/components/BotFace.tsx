import { useIsFocused } from "@react-navigation/native";
import { memo, useMemo } from "react";
import { View } from "react-native";
import Animated, { useAnimatedReaction, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { expressionForState, type BotFaceIdentity, type BotFaceState } from "../lib/moodie-identity";
import { colors } from "../theme";
import { BLOB_BODY_PATH, EXPRESSIONS, createEyePath, lidToScale, liveliness, type Expression } from "../vendor/moodie";
import { useOrbMotion } from "./OrbMotion";

/** Actual synergy.ai Moodie geometry + bloub motion; see vendor/moodie.ts for MIT attribution.
 * Paths are made only when expressions change. UI-thread VIEW transforms animate the small SVG;
 * no per-frame JS/React render, path tessellation, shader or WebView per roster row.
 *
 * The eyes are their own SVG layer inside an Animated.View, never Reanimated `animatedProps`
 * on an SVG element: under Fabric those SVG children have no SurfaceMountingManager entry,
 * so synchronous prop updates throw RetryableMountingLayerException on the UI thread.
 */
export const BotFace = memo(function BotFace({ identity, state = "idle", size = 32, animated = true }: {
  identity: BotFaceIdentity; state?: BotFaceState; size?: number; animated?: boolean;
}) {
  const expression = expressionForState(state, identity.rest);
  const preset: Expression = EXPRESSIONS[expression];
  const paths = useMemo(() => ({
    left: createEyePath({ ...preset.left, height: preset.left.height * preset.left.open }),
    right: createEyePath({ ...preset.right, height: preset.right.height * preset.right.open }),
  }), [preset]);
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const { clock, active } = useOrbMotion();
  const running = focused && active && animated && !reduced;
  const time = useSharedValue(identity.offset);
  // Unwrap the existing six-second app clock: continuous time, no per-avatar frame loop.
  // That clock already pauses in the background and with system reduced motion.
  useAnimatedReaction(() => clock?.value ?? 0, (now, previous) => {
    if (running && previous !== null) time.value += (now >= previous ? now - previous : 1 - previous + now) * 6;
  });
  const life = useDerivedValue(() => liveliness(time.value, { wander: running ? 1 : 0, blink: running, float: running }));
  const body = useAnimatedStyle(() => {
    return { transform: [
      { translateX: life.value.driftX * size },
      { translateY: ((preset.body?.y ?? 0) + life.value.driftY * 40) * size / 200 },
      { rotate: `${(preset.body?.rotate ?? 0) + life.value.dRoll * .15}deg` },
      { scaleX: (preset.body?.scaleX ?? 1) * life.value.breath },
      { scaleY: (preset.body?.scaleY ?? 1) * life.value.breath },
    ] };
  });
  // Same motion as the old SVG transform `translate(x y) translate(100 96) scale(1 b)
  // translate(-100 -96)`, as a view transform: viewBox units scaled to points, scaled about
  // the eye centre (100, 96) of the 200-unit viewBox.
  const gaze = useAnimatedStyle(() => {
    const x = life.value.dYaw / 28 * 14 + life.value.driftX * 80;
    const y = life.value.dPitch / 28 * 10 + life.value.driftY * 80;
    return { transform: [
      { translateX: x * size / 200 },
      { translateY: y * size / 200 },
      { scaleY: lidToScale(life.value.lid) },
    ] };
  });
  return <View accessibilityRole="image" accessibilityLabel={`${identity.key} · ${state} · ${expression} face`} testID={`bot-face-${identity.key}`} style={{ width: size, height: size }}>
    <Animated.View style={[{ width: size, height: size }, body]}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Path testID="moodie-body" d={BLOB_BODY_PATH} fill={identity.bodyColor} stroke={colors.border} strokeWidth={2} />
      </Svg>
      <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: size, height: size, transformOrigin: "50% 48%" }, gaze]}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Path testID="moodie-eye-left" d={paths.left} fill={identity.eyeColor} />
          <Path testID="moodie-eye-right" d={paths.right} fill={identity.eyeColor} />
        </Svg>
      </Animated.View>
    </Animated.View>
  </View>;
});
