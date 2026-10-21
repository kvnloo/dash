import { useIsFocused } from "@react-navigation/native";
import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import type { Thinking } from "../lib/thinking";
import { colors, fonts } from "../theme";
import { useOrbMotion } from "./OrbMotion";

/** Static dot geometry, compositor transforms only: no picture recording or React frame loop. */
export const AgentOrb = memo(function AgentOrb({ thinking, size = 64, caption = false, label, animated = true }: {
  thinking: Thinking; size?: number; caption?: boolean; label?: string; animated?: boolean;
}) {
  const { clock, active } = useOrbMotion();
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const running = focused && active && animated && !reduced && thinking.phase !== "idle" && thinking.phase !== "waiting-approval";
  const color = thinking.phase === "waiting-approval" ? colors.warn : colors.text;
  const dots = useMemo(() => Array.from({ length: size <= 20 ? 32 : 96 }, (_, i) => {
    // Fibonacci sphere: the original orb's monochrome, depth-weighted dotted silhouette.
    const n = size <= 20 ? 32 : 96;
    const y = 1 - 2 * (i + 0.5) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.3999632297;
    const z = Math.sin(a) * r;
    return { x: 32 + Math.cos(a) * r * 26, y: 32 + y * (thinking.phase === "streaming" ? 18 : 26), r: 0.55 + (z + 1) * 0.35, opacity: 0.2 + (z + 1) * 0.35 };
  }), [size, thinking.phase]);
  const paths = useMemo(() => [0, 1, 2, 3].map(band => dots.filter(dot => Math.min(3, Math.floor(dot.opacity * 4)) === band).map(dot => `M${dot.x - dot.r},${dot.y}a${dot.r},${dot.r} 0 1,0 ${dot.r * 2},0a${dot.r},${dot.r} 0 1,0 ${-dot.r * 2},0`).join(" ")), [dots]);
  const motion = useAnimatedStyle(() => {
    const p = running && clock ? clock.value : 0;
    const direction = thinking.phase === "tool" ? -1 : 1;
    return { transform: [{ perspective: 1000 }, { rotate: `${p * (thinking.phase === "streaming" ? 720 : 360) * direction}deg` }, { scale: 0.96 + 0.04 * Math.cos(p * Math.PI * 4) }] };
  });
  return <View accessibilityRole="image" accessibilityLabel={label ?? thinking.phase} testID="agent-orb" style={{ alignItems: "center", gap: 4, opacity: thinking.phase === "idle" ? 0.55 : 1 }}>
    <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ width: size, height: size, borderRadius: size, borderWidth: thinking.phase === "waiting-approval" ? 1 : 0, borderColor: color }, motion]}>
      <Svg width="100%" height="100%" viewBox="0 0 64 64">{paths.map((d, i) => <Path key={i} d={d} opacity={(i + 0.5) / 4} fill={color} />)}</Svg>
    </Animated.View>
    {caption ? <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>{thinking.tool ?? thinking.phase}</Text> : null}
  </View>;
});
