import { useIsFocused } from "@react-navigation/native";
import { memo, useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import { faceDots, faceExpression, type FaceVariant } from "../lib/bot-identity";
import { orbDotCount, orbMotion, orbPixels, type OrbSize, type OrbState } from "../lib/orb-phase";
import { snappy } from "../motion";
import { colors, fonts } from "../theme";
import { useOrbMotion } from "./OrbMotion";

type Dot = { x: number; y: number; r: number; opacity: number };

/** Dots grouped into four opacity bands: four paths instead of one node per dot. */
function bandPaths(dots: readonly Dot[]): string[] {
  return [0, 1, 2, 3].map(band => dots.filter(dot => Math.min(3, Math.floor(dot.opacity * 4)) === band).map(dot => `M${dot.x - dot.r},${dot.y}a${dot.r},${dot.r} 0 1,0 ${dot.r * 2},0a${dot.r},${dot.r} 0 1,0 ${-dot.r * 2},0`).join(" "));
}

/** Mouth openings per clock cycle while the bot talks (about 2.7 a second at the 6 s clock). */
const TALK_BEATS = 16;

/**
 * Static dot geometry, compositor transforms only: no picture recording or React frame loop.
 * With `face`, the orb is a bot's face: the dots turn behind a still visor with two lit eyes,
 * and the eyes carry the phase (see faceExpression in lib/bot-identity).
 */
export const AgentOrb = memo(function AgentOrb({ thinking, size = 64, caption = false, label, animated = true, face }: {
  thinking: OrbState; size?: OrbSize; caption?: boolean; label?: string; animated?: boolean; face?: FaceVariant;
}) {
  const { clock, active } = useOrbMotion();
  const reduced = useReducedMotion();
  const focused = useIsFocused();
  const m = orbMotion(thinking.phase);
  const running = focused && active && animated && !reduced && m.animated;
  const waiting = thinking.phase === "waiting-approval";
  const color = waiting ? colors.warn : face ? face.dotColor : colors.text;
  const eyeColor = waiting ? colors.warn : face?.eyeColor ?? colors.text;
  const px = orbPixels(size);
  const n = Math.round(orbDotCount(size) * (face?.density ?? 1));
  const pattern = face?.pattern;
  const paths = useMemo(() => {
    // A face keeps a round head (in-plane spin must not turn its outline); the bare orb squashes per phase.
    if (pattern) return bandPaths(faceDots(pattern, n, 26));
    return bandPaths(Array.from({ length: n }, (_, i) => {
      // Fibonacci sphere: the original orb's monochrome, depth-weighted dotted silhouette.
      const y = 1 - 2 * (i + 0.5) / n;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.3999632297;
      const z = Math.sin(a) * r;
      const dot = n >= 160 ? 0.4 : 0.55;
      return { x: 32 + Math.cos(a) * r * m.radiusX, y: 32 + y * m.radiusY, r: dot + (z + 1) * 0.35, opacity: 0.2 + (z + 1) * 0.35 };
    }));
  }, [pattern, n, m.radiusX, m.radiusY]);
  const { base, amp, beats, wave } = m;
  // Each bot turns its own way and at its own rate.
  const spin = m.spin * (face ? face.spinDir * face.spinRate : 1);
  const motion = useAnimatedStyle(() => {
    const p = running && clock ? clock.value : 0;
    // Mirrors orbFrame() in lib/orb-phase.ts, which is unit-tested.
    const w = wave === "abs" ? Math.abs(Math.sin(p * Math.PI * beats)) : Math.cos(p * Math.PI * 2 * beats);
    return { transform: [{ perspective: 1000 }, { rotate: `${p * spin}deg` }, { scale: base + amp * w }] };
  });
  return <View accessibilityRole="image" accessibilityLabel={label ?? thinking.phase} testID="agent-orb" style={{ alignItems: "center", gap: 4, opacity: face ? 1 : m.opacity }}>
    <View style={{ width: px, height: px }}>
      <Animated.View renderToHardwareTextureAndroid shouldRasterizeIOS style={[{ width: px, height: px, borderRadius: px, borderWidth: waiting ? 1 : 0, borderColor: color, opacity: face ? Math.max(0.7, m.opacity) : 1 }, motion]}>
        <Svg width="100%" height="100%" viewBox="0 0 64 64">
          {paths.map((d, i) => <Path key={i} d={d} opacity={(i + 0.5) / 4} fill={color} />)}
          {face?.accessory === "satellite" ? <Circle cx={58.5} cy={12} r={2.4} fill={eyeColor} /> : null}
        </Svg>
      </Animated.View>
      {face ? <Face face={face} phase={thinking.phase} px={px} running={running} eyeColor={eyeColor} reduced={reduced} /> : null}
    </View>
    {caption ? <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted }}>{thinking.tool ?? thinking.phase}</Text> : null}
  </View>;
});

function Eyes({ style, color }: { style: FaceVariant["eyes"]; color: string }) {
  switch (style) {
    case "round": return <><Circle cx={25} cy={31} r={2.8} fill={color} /><Circle cx={39} cy={31} r={2.8} fill={color} /></>;
    case "bar": return <><Rect x={21} y={29.7} width={7} height={2.6} rx={1.3} fill={color} /><Rect x={36} y={29.7} width={7} height={2.6} rx={1.3} fill={color} /></>;
    case "tall": return <><Rect x={24} y={27.75} width={3} height={6.5} rx={1.5} fill={color} /><Rect x={37} y={27.75} width={3} height={6.5} rx={1.5} fill={color} /></>;
    case "wide": return <><Circle cx={21} cy={31} r={2.4} fill={color} /><Circle cx={43} cy={31} r={2.4} fill={color} /></>;
    case "single": return <Circle cx={32} cy={31} r={3.6} fill={color} />;
  }
}

function visorWidth(eyes: FaceVariant["eyes"]): number {
  return eyes === "single" ? 20 : eyes === "wide" ? 36 : 32;
}

/** The still face over the turning dots: visor, accessory, eyes (gaze, squint, blink), mouth. */
function Face({ face, phase, px, running, eyeColor, reduced }: { face: FaceVariant; phase: OrbState["phase"]; px: number; running: boolean; eyeColor: string; reduced: boolean }) {
  const { clock } = useOrbMotion();
  const look = faceExpression(phase);
  const unit = px / 64;
  const gx = useSharedValue(look.gx);
  const gy = useSharedValue(look.gy);
  const sy = useSharedValue(look.sy);
  const sc = useSharedValue(look.scale);
  useEffect(() => {
    // Expressions change in one quick step; with reduced motion they just change.
    const to = (v: number) => (reduced ? v : withTiming(v, { ...snappy, reduceMotion: ReduceMotion.System }));
    gx.value = to(look.gx); gy.value = to(look.gy); sy.value = to(look.sy); sc.value = to(look.scale);
  }, [look.gx, look.gy, look.sy, look.scale, reduced, gx, gy, sy, sc]);
  const eyes = useAnimatedStyle(() => {
    const p = running && clock ? clock.value : 0;
    // One blink per clock cycle while alive: a 6% window squeezes the eyes shut and open.
    const blink = running && p > 0.47 && p < 0.53 ? Math.max(0.1, Math.abs(p - 0.5) / 0.03) : 1;
    return { transform: [{ translateX: gx.value * unit }, { translateY: gy.value * unit }, { scale: sc.value }, { scaleY: sy.value * blink }] };
  });
  const mouth = useAnimatedStyle(() => {
    const p = running && clock ? clock.value : 0;
    return { transform: [{ scaleX: running ? 0.35 + 0.65 * Math.abs(Math.sin(p * Math.PI * TALK_BEATS)) : 0.6 }] };
  });
  const vw = visorWidth(face.eyes);
  return <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: px, height: px, opacity: look.opacity }}>
    <Svg width="100%" height="100%" viewBox="0 0 64 64" style={{ position: "absolute" }}>
      <Rect x={32 - vw / 2} y={24} width={vw} height={14} rx={7} fill={colors.bg} opacity={0.92} />
      {face.accessory === "antenna" ? <><Circle cx={32} cy={2.6} r={2.2} fill={eyeColor} /><Circle cx={32} cy={6.6} r={1} fill={eyeColor} /></> : null}
      {face.accessory === "halo" ? <Ellipse cx={32} cy={3.4} rx={11} ry={2.2} stroke={eyeColor} strokeWidth={1.3} fill="none" /> : null}
      {face.accessory === "ears" ? <><Rect x={0.5} y={26.5} width={3.4} height={9} rx={1.7} fill={eyeColor} /><Rect x={60.1} y={26.5} width={3.4} height={9} rx={1.7} fill={eyeColor} /></> : null}
    </Svg>
    <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: px, height: px }, eyes]}>
      <Svg width="100%" height="100%" viewBox="0 0 64 64"><Eyes style={face.eyes} color={eyeColor} /></Svg>
    </Animated.View>
    {look.mouth ? <Animated.View style={[{ position: "absolute", left: 28 * unit, top: 41 * unit, width: 8 * unit, height: Math.max(1, 2.4 * unit), borderRadius: 2 * unit, backgroundColor: eyeColor }, mouth]} /> : null}
  </View>;
}
