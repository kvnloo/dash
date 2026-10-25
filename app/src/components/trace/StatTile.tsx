import { DensityText as Text } from "../Density";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { InteractiveTile } from "../InteractiveTile";
import { NumberTicker } from "../NumberTicker";
import { useDensity } from "../Density";
import { useInformationDetail } from "../InformationDensityPicker";
import { projectStatInformation } from "../../lib/information-density";
import { haptic } from "../../haptics";
import { SNAP, fade, MOTION_MS } from "../../motion";
import { fonts, radius, space, type } from "../../theme";
import { tc } from "./tokens";

export type StatVariant = "number" | "meter" | "spark";
export type Segment = { n: number; color: string; label: string };


export function StatTile({ label, value, sub, tone = tc.text, variant = "number", segments, evidenceSegments, series, replay = 0 }: {
  label: string;
  value: number;
  sub?: string;
  tone?: string;
  variant?: StatVariant;
  /** meter: dot-grid segments that sum to the total. */
  segments?: Segment[];
  /** Independent source-backed counts for non-meter variants; does not add a segment gesture. */
  evidenceSegments?: Segment[];
  /** spark: values over time. */
  series?: number[];
  replay?: number;
}) {
  const reduced = useReducedMotion();
  const [focus, setFocus] = useState<number | null>(null);
  const shown = focus !== null && segments?.[focus] ? segments[focus].n : value;
  const { sizing } = useDensity();
  const { level } = useInformationDetail();
  const details = projectStatInformation(level, { value, segments: evidenceSegments ?? segments, series });
  const summary = [label + ": " + value, sub, ...details.map(line => line.label + ": " + line.value)].filter(Boolean).join(". ");
  return (
    <InteractiveTile
      key={replay}
      extraActions={segments?.length ? [{ id: "segment", label: "Segment", run: () => { haptic.select(); setFocus(f => f === null ? 0 : f + 1 >= segments.length ? null : f + 1); } }] : []}
      title={label}
      summary={summary}
      style={[styles.tile, { minHeight: sizing.tileMin }]}
      testID={`stat-${variant}-${label}`}
    >
      <View style={[styles.inner, { padding: sizing.padding }]}>
        <Text style={styles.label} numberOfLines={1}>{focus !== null && segments?.[focus] ? segments[focus].label : label}</Text>
        <NumberTicker value={shown} style={[styles.value, { color: focus !== null && segments?.[focus] ? segments[focus].color : tone }]} />
        {variant === "meter" && segments ? <DotMeter segments={segments} focus={focus} reduced={reduced} /> : null}
        {variant === "spark" && series ? <Spark series={series} tone={tone} /> : null}
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
        {details.map(line => <Text key={line.label} style={styles.detail} testID={"stat-detail-" + line.label.toLowerCase()}>{line.label}: {line.value}</Text>)}
        {segments?.length ? <Text style={styles.sub}>Hold → Segment</Text> : null}
      </View>
    </InteractiveTile>
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
  detail: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: tc.text2, flexShrink: 1, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, marginTop: 4 },
  dot: { width: 6, height: 6, borderRadius: 1.5 },
});
