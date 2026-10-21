import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import type { Thinking } from "../lib/thinking";
import { colors, fonts } from "../theme";
import { useOrbMotion } from "./OrbMotion";

/** Static dot geometry, compositor transforms only: no picture recording or React frame loop. */
export const AgentOrb = memo(function AgentOrb({ thinking, size = 64, caption = false, label, animated = true }: {
  thinking: Thinking; size?: number; caption?: boolean; label?: string; animated?: boolean;
}) {
  const { clock, active } = useOrbMotion();
  const reduced = useReducedMotion();
  const running = active && animated && !reduced && thinking.phase !== "idle" && thinking.phase !== "waiting-approval";
  const color = thinking.phase === "waiting-approval" ? colors.warn : colors.text;
  const dots = useMemo(() => Array.from({ length: size <= 20 ? 32 : 96 }, (_, i) => {
    // Fibonacci sphere: the original orb's monochrome, depth-weighted dotted silhouette.
    const n = size <= 20 ? 32 : 96;
    const y = 1 - 2 * (i + 0.5) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.3999632297;
    const z = Math.sin(a) * r;
    return { x: 32 + Math.cos(a) * r * 26, y: 32 + y * 26, r: 0.55 + (z + 1) * 0.35, opacity: 0.2 + (z + 1) * 0.35 };
  }), [size]);
  const motion = useAnimatedStyle(() => {
    const p = running && clock ? clock.value : 0;
    const direction = thinking.phase === "tool" ? -1 : 1;
    return { transform: [{ rotate: `${p * 360 * direction}deg` }, { scale: 0.96 + 0.04 * Math.cos(p * Math.PI * 4) }] };
  });
  return <View accessibilityRole="image" accessibilityLabel={label ?? thinking.phase} testID="agent-orb" style={{ alignItems: "center", gap: 4 }}>
    <Animated.View style={[{ width: size, height: size, borderRadius: size, borderWidth: thinking.phase === "waiting-approval" ? 1 : 0, borderColor: color }, motion]}>
      <Svg width="100%" height="100%" viewBox="0 0 64 64">{dots.map((d, i) => <Circle key={i} cx={d.x} cy={d.y} r={d.r} opacity={d.opacity} fill={color} />)}</Svg>
    </Animated.View>
    {caption ? <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>{thinking.tool ?? thinking.phase}</Text> : null}
  </View>;
});
