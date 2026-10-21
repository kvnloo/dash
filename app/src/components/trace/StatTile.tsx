import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { PressScale } from "../PressScale";
import { haptic } from "../../haptics";
import { SNAP, fade, MOTION_MS } from "../../motion";
import { fonts, radius, space, type } from "../../theme";
import { tc } from "./tokens";

export type StatVariant = "number" | "meter" | "spark";
export type Segment = { n: number; color: string; label: string };

/** Ease-out count-up, ~600 ms. Shows the final value at once under reduced motion. */
export function useCountUp(target: number, reduced: boolean, ms = MOTION_MS.enter): number {
  const [v, setV] = useState(reduced ? target : 0);
  const from = useRef(reduced ? target : 0);
  useEffect(() => {
    if (reduced) { setV(target); from.current = target; return; }
    const start = Date.now(), a = from.current;
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setV(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced, ms]);
  return v;
}

export function StatTile({ label, value, sub, tone = tc.text, variant = "number", segments, series, replay = 0 }: {
  label: string;
  value: number;
  sub?: string;
  tone?: string;
  variant?: StatVariant;
  /** meter: dot-grid segments that sum to the total. */
  segments?: Segment[];
  /** spark: values over time. */
  series?: number[];
  replay?: number;
}) {
  const reduced = useReducedMotion();
  const [focus, setFocus] = useState<number | null>(null);
  const shown = focus !== null && segments?.[focus] ? segments[focus].n : value;
  const n = useCountUp(shown, reduced, MOTION_MS.enter);
  return (
    <PressScale
      key={replay}
      scaleTo={0.96}
      style={styles.tile}
      onPressIn={() => haptic.tap()}
      onLongPress={() => { if (segments?.length) { haptic.select(); setFocus((f) => (f === null ? 0 : (f + 1) % segments.length)); } }}
      onPress={() => setFocus(null)}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${value}${sub ? `, ${sub}` : ""}`}
      testID={`stat-${variant}-${label}`}
    >
      <View style={styles.inner}>
        <Text style={styles.label} numberOfLines={1}>{focus !== null && segments?.[focus] ? segments[focus].label : label}</Text>
        <Text style={[styles.value, { color: focus !== null && segments?.[focus] ? segments[focus].color : tone }]}>{Math.round(n).toLocaleString("en-US")}</Text>
        {variant === "meter" && segments ? <DotMeter segments={segments} focus={focus} reduced={reduced} /> : null}
        {variant === "spark" && series ? <Spark series={series} tone={tone} /> : null}
        {sub ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </PressScale>
  );
}

function Dot({ color, i, dim, reduced }: { color: string; i: number; dim: boolean; reduced: boolean }) {
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => { if (!reduced) p.value = withTiming(1, { ...SNAP, reduceMotion: ReduceMotion.System }); }, [i, p, reduced]);
  const st = useAnimatedStyle(() => ({ opacity: p.value * (dim ? 0.18 : 1), transform: [{ scale: 0.4 + 0.6 * p.value }] }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, st]} />;
}

/** Context-window style dot grid (Flo #1): long-press cycles a segment, the rest dim. */
function DotMeter({ segments, focus, reduced }: { segments: Segment[]; focus: number | null; reduced: boolean }) {
  const dots: { color: string; seg: number }[] = [];
  segments.forEach((s, seg) => { for (let i = 0; i < s.n; i += 1) dots.push({ color: s.color, seg }); });
  return (
    <View style={styles.grid}>
      {dots.map((d, i) => <Dot key={i} i={i} color={d.color} dim={focus !== null && focus !== d.seg} reduced={reduced} />)}
    </View>
  );
}

function Spark({ series, tone }: { series: number[]; tone: string }) {
  const w = 120, h = 28, max = Math.max(1, ...series);
  const pts = series.map((v, i) => `${((i / Math.max(1, series.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 2)).toFixed(1)}`);
  const d = `M${pts.join("L")}`;
  return (
    <Animated.View entering={FadeIn.duration(fade.duration).reduceMotion(ReduceMotion.System)} style={{ marginTop: 4 }}>
      <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <Path d={`${d}L${w},${h}L0,${h}Z`} fill="rgba(236,232,223,.08)" />
        <Path d={d} stroke={tone} strokeWidth={1.2} fill="none" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0, borderRadius: radius.md, alignItems: "stretch", justifyContent: "flex-start" },
  inner: { flex: 1, alignSelf: "stretch", backgroundColor: tc.raised, borderRadius: radius.md, borderWidth: 1, borderColor: tc.rule, padding: space.md, gap: 2 },
  label: { ...type.label, color: tc.text3, fontSize: 11, textTransform: "uppercase" },
  value: { fontFamily: fonts.mono, fontSize: 26, lineHeight: 32, fontVariant: ["tabular-nums"] },
  sub: { fontFamily: fonts.mono, fontSize: 11, color: tc.text3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 1.5 },
});
