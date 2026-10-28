import { memo, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { orbDotCount, orbMotion, orbPixels, type OrbSize, type OrbState } from "../lib/orb-phase";
import { colors, fonts } from "../theme";
import { useAmbientRunning, useOrbMotion } from "./OrbMotion";

/** Static dot geometry, compositor transforms only: no picture recording or React frame loop. */
export const AgentOrb = memo(function AgentOrb({ thinking, size = 64, caption = false, label, animated = true }: {
  thinking: OrbState; size?: OrbSize; caption?: boolean; label?: string; animated?: boolean;
}) {
  const { clock } = useOrbMotion();
  // Root-mounted voice overlays have no screen navigation context; this hook is safe there.
  const ambientRunning = useAmbientRunning();
  const m = orbMotion(thinking.phase);
  const running = ambientRunning && animated && m.animated;
  const color = thinking.phase === "waiting-approval" ? colors.warn : colors.text;
  const px = orbPixels(size);
  const n = orbDotCount(size);
  const dots = useMemo(() => Array.from({ length: n }, (_, i) => {
    // Fibonacci sphere: the original orb's monochrome, depth-weighted dotted silhouette.
    const y = 1 - 2 * (i + 0.5) / n;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.3999632297;
    const z = Math.sin(a) * r;
    const dot = n >= 160 ? 0.4 : 0.55;
    return { x: 32 + Math.cos(a) * r * m.radiusX, y: 32 + y * m.radiusY, r: dot + (z + 1) * 0.35, opacity: 0.2 + (z + 1) * 0.35 };
  }), [n, m.radiusX, m.radiusY]);
  const paths = useMemo(() => [0, 1, 2, 3].map(band => dots.filter(dot => Math.min(3, Math.floor(dot.opacity * 4)) === band).map(dot => `M${dot.x - dot.r},${dot.y}a${dot.r},${dot.r} 0 1,0 ${dot.r * 2},0a${dot.r},${dot.r} 0 1,0 ${-dot.r * 2},0`).join(" ")), [dots]);
  const { spin, base, amp, beats, wave } = m;
  const motion = useAnimatedStyle(() => {
    const p = running && clock ? clock.value : 0;
    // Mirrors orbFrame() in lib/orb-phase.ts, which is unit-tested.
    const w = wave === "abs" ? Math.abs(Math.sin(p * Math.PI * beats)) : Math.cos(p * Math.PI * 2 * beats);
    return { transform: [{ perspective: 1000 }, { rotate: `${p * spin}deg` }, { scale: base + amp * w }] };
  });
  return <View accessibilityRole="image" accessibilityLabel={label ?? thinking.phase} testID="agent-orb" style={{ alignItems: "center", gap: 4, opacity: m.opacity }}>
    <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ width: px, height: px, borderRadius: px, borderWidth: thinking.phase === "waiting-approval" ? 1 : 0, borderColor: color }, motion]}>
      <Svg width="100%" height="100%" viewBox="0 0 64 64">{paths.map((d, i) => <Path key={i} d={d} opacity={(i + 0.5) / 4} fill={color} />)}</Svg>
    </Animated.View>
    {caption ? <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>{thinking.tool ?? thinking.phase}</Text> : null}
  </View>;
});
