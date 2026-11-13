import { useIsFocused } from "@react-navigation/native";
import { memo, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { orbAdvance, orbDotCount, orbMotion, orbPixels, orbPulse, orbTarget, type OrbSize, type OrbState } from "../lib/orb-phase";
import { colors, fonts } from "../theme";
import { useOrbMotion } from "./OrbMotion";

/** Static dot geometry, compositor transforms only: no picture recording or React frame loop. */
export const AgentOrb = memo(function AgentOrb({ thinking, size = 64, caption = false, label, animated = true }: {
  thinking: OrbState; size?: OrbSize; caption?: boolean; label?: string; animated?: boolean;
}) {
  const { clock, active } = useOrbMotion();
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const m = orbMotion(thinking.phase);
  const running = focused && active && animated && !reduced && m.animated;
  const target = useSharedValue(orbTarget(thinking.phase));
  const pose = useSharedValue({ rotate: 0, beat: 0 });
  const previous = useSharedValue(-1);
  useEffect(() => {
    const next = orbTarget(thinking.phase);
    target.value = reduced || !animated ? next : withTiming(next, { duration: 240, easing: Easing.inOut(Easing.quad) });
  }, [thinking.phase, reduced, animated, target]);
  useAnimatedReaction(() => ({ time: running ? clock?.value ?? 0 : -1, spin: target.value.spin, beats: target.value.beats }), (now) => {
    const elapsed = previous.value < 0 || now.time < 0 ? 0 : Math.max(0, now.time - previous.value);
    previous.value = now.time;
    if (elapsed > 0) pose.value = orbAdvance(pose.value.rotate, pose.value.beat, elapsed, now.spin, now.beats);
  }, [clock, running]);
  const px = orbPixels(size);
  const n = orbDotCount(size);
  const dots = useMemo(() => Array.from({ length: n }, (_, i) => {
    // Fibonacci sphere: the original orb's monochrome, depth-weighted dotted silhouette.
    const y = 1 - 2 * (i + 0.5) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.3999632297;
    const z = Math.sin(a) * r;
    const dot = n >= 160 ? 0.4 : 0.55;
    return { x: 32 + Math.cos(a) * r * 26, y: 32 + y * 26, r: dot + (z + 1) * 0.35, opacity: 0.2 + (z + 1) * 0.35 };
  }), [n]);
  const paths = useMemo(() => [0, 1, 2, 3].map(band => dots.filter(dot => Math.min(3, Math.floor(dot.opacity * 4)) === band).map(dot => `M${dot.x - dot.r},${dot.y}a${dot.r},${dot.r} 0 1,0 ${dot.r * 2},0a${dot.r},${dot.r} 0 1,0 ${-dot.r * 2},0`).join(" ")), [dots]);
  const motion = useAnimatedStyle(() => {
    const t = target.value;
    const scale = orbPulse(pose.value.beat, t.base, t.amp, t.abs);
    return { opacity: t.opacity, transform: [{ rotate: `${pose.value.rotate}deg` }, { scale }, { scaleX: t.radiusX / 26 }, { scaleY: t.radiusY / 26 }] };
  });
  const warning = useAnimatedStyle(() => ({ opacity: target.value.warning }));
  const monochrome = useAnimatedStyle(() => ({ opacity: 1 - target.value.warning }));
  return <View accessibilityRole="image" accessibilityLabel={label ?? thinking.phase} testID="agent-orb" style={{ alignItems: "center", gap: 4 }}>
    <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ width: px, height: px }, motion]}>
      <Animated.View style={[{ width: "100%", height: "100%" }, monochrome]}><OrbDots paths={paths} color={colors.text} /></Animated.View>
      <Animated.View style={[{ position: "absolute", inset: 0, borderRadius: px, borderWidth: 1, borderColor: colors.warn }, warning]}><OrbDots paths={paths} color={colors.warn} /></Animated.View>
    </Animated.View>
    {caption ? <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>{thinking.tool ?? thinking.phase}</Text> : null}
  </View>;
});

const OrbDots = memo(function OrbDots({ paths, color }: { paths: string[]; color: string }) {
  return <Svg width="100%" height="100%" viewBox="0 0 64 64">{paths.map((d, i) => <Path key={i} d={d} opacity={(i + 0.5) / 4} fill={color} />)}</Svg>;
});
