import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Circle, Line } from "react-native-svg";
import { haptic } from "../haptics";
import { colors, controlMin, radius, space, type } from "../theme";
import { mapPositions, matchesFilter, projectMap, type MapEdge, type MapFilter, type MapKind, type MapLayout, type MapNode, type MapRelation, type OrchestraMap, type Point } from "../lib/orchestra-map";
import { AgentOrb } from "./AgentOrb";
import { PressScale } from "./PressScale";

const ALine = Animated.createAnimatedComponent(Line);
const ACircle = Animated.createAnimatedComponent(Circle);
const spring = { damping: 22, stiffness: 160, reduceMotion: ReduceMotion.System };
const kindColor: Record<MapKind, string> = { chat: colors.gold, subagent: colors.orchestraSubagent, repo: colors.gold, host: colors.textMuted };
const stateColor = { idle: colors.textMuted, live: colors.information, "needs-you": colors.warn, failing: colors.danger };
const relationColor: Record<MapRelation, string> = { delegated: colors.gold, touched: colors.information, hosted: colors.textFaint, workspace: colors.provenance };
const layouts: MapLayout[] = ["spine", "constellation", "radial", "islands"];
const legend: (MapKind | MapRelation)[] = ["chat", "subagent", "repo", "host", "delegated", "touched", "hosted", "workspace"];
function legendColor(kind: MapKind | MapRelation): string {
  return kind === "chat" || kind === "subagent" || kind === "repo" || kind === "host" ? kindColor[kind] : relationColor[kind];
}

function MapLink({ edge, a, b, reduced, dim }: { edge: MapEdge; a: Point; b: Point; reduced: boolean; dim: boolean }) {
  const x1 = useDerivedValue(() => withSpring(a.x, spring), [a.x]);
  const y1 = useDerivedValue(() => withSpring(a.y, spring), [a.y]);
  const x2 = useDerivedValue(() => withSpring(b.x, spring), [b.x]);
  const y2 = useDerivedValue(() => withSpring(b.y, spring), [b.y]);
  const flow = useSharedValue(0);
  useEffect(() => {
    if (edge.active && edge.relation === "delegated" && !reduced) flow.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.linear, reduceMotion: ReduceMotion.System }), -1, false);
    else { cancelAnimation(flow); flow.value = 0; }
    return () => cancelAnimation(flow);
  }, [edge.active, edge.relation, reduced, flow]);
  const line = useAnimatedProps(() => ({ x1: x1.value, y1: y1.value, x2: x2.value, y2: y2.value }));
  const dot = useAnimatedProps(() => ({ cx: x1.value + (x2.value - x1.value) * flow.value, cy: y1.value + (y2.value - y1.value) * flow.value }));
  return <>
    <ALine animatedProps={line} stroke={relationColor[edge.relation]} strokeWidth={edge.relation === "hosted" ? 1 : 1.5} strokeDasharray={edge.relation === "hosted" ? "3 5" : undefined} opacity={dim ? 0.12 : 0.65} />
    {edge.active && edge.relation === "delegated" && !reduced ? <ACircle animatedProps={dot} r={3} fill={colors.gold} /> : null}
  </>;
}

function MapDot({ node, point, selected, dim, reduced, onPress }: { node: MapNode; point: Point; selected: boolean; dim: boolean; reduced: boolean; onPress(): void }) {
  const x = useSharedValue(point.x);
  const y = useSharedValue(point.y);
  const appear = useSharedValue(reduced ? 1 : 0.2);
  const pulse = useSharedValue(1);
  useEffect(() => {
    x.value = withSpring(point.x, spring);
    y.value = withSpring(point.y, spring);
    appear.value = withSpring(1, spring);
  }, [point.x, point.y, x, y, appear]);
  useEffect(() => {
    if (node.state === "live" && !reduced) pulse.value = withRepeat(withTiming(1.2, { duration: 1700, reduceMotion: ReduceMotion.System }), -1, true);
    else { cancelAnimation(pulse); pulse.value = 1; }
    return () => cancelAnimation(pulse);
  }, [node.state, reduced, pulse]);
  const position = useAnimatedStyle(() => ({ left: x.value - 22, top: y.value - 22, opacity: dim ? 0.2 : 1, transform: [{ scale: appear.value }] }));
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: 1.6 - pulse.value }));
  return <Animated.View style={[styles.node, position]}>
    <PressScale accessibilityRole="button" accessibilityLabel={`${node.kind}: ${node.label}, ${node.state}`} accessibilityState={{ selected }} onPress={onPress} style={styles.nodeHit}>
      <Animated.View style={[styles.stateRing, { borderColor: selected ? colors.goldHi : stateColor[node.state], borderWidth: selected || node.state !== "idle" ? 2 : 0 }, ring]} />
      <View style={[styles.glyph, { backgroundColor: node.kind === "host" ? "transparent" : kindColor[node.kind], borderColor: kindColor[node.kind], borderRadius: node.kind === "repo" ? 3 : 10, width: node.kind === "subagent" ? 10 : 14, height: node.kind === "subagent" ? 10 : 14 }]} />
      {node.kind === "host" ? <View style={styles.hostCenter} /> : null}
      {node.state === "live" || node.state === "needs-you" ? <View style={styles.orb} pointerEvents="none">{reduced ? <Text style={styles.liveLabel}>{node.state === "needs-you" ? "!" : "•"}</Text> : <AgentOrb thinking={node.thinking} size={20} />}</View> : null}
    </PressScale>
    <Text numberOfLines={1} style={styles.nodeLabel}>{node.label}</Text>
  </Animated.View>;
}

function Control({ label, selected = false, onPress, onLongPress }: { label: string; selected?: boolean; onPress(): void; onLongPress?(): void }) {
  return <PressScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => { haptic.select(); onPress(); }} onLongPress={onLongPress ? () => { haptic.select(); onLongPress(); } : undefined} style={[styles.control, selected && styles.controlOn]}><Text style={[styles.controlText, selected && { color: colors.goldHi }]}>{label}</Text></PressScale>;
}

export function OrchestraGraph({ graph, width, children, actions, fixture = false }: { graph: OrchestraMap; width: number; children?: ReactNode; actions?: ReactNode; fixture?: boolean }) {
  const [layout, setLayout] = useState<MapLayout>("spine");
  const [filter, setFilter] = useState<MapFilter | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusOnly, setFocusOnly] = useState(false);
  const [height, setHeight] = useState(280);
  const reduced = useReducedMotion();
  const projected = useMemo(() => projectMap(graph, filter, focusId, focusOnly), [graph, filter, focusId, focusOnly]);
  const positions = useMemo(() => mapPositions(projected.nodes, width, height, layout), [projected, width, height, layout]);
  const selected = projected.nodes.find(n => n.id === focusId);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const sheet = useSharedValue(200);
  useEffect(() => { sheet.value = withSpring(selected ? 0 : 200, spring); }, [selected, sheet]);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheet.value }] }));
  const pan = Gesture.Pan().minDistance(10).onStart(() => { savedX.value = tx.value; savedY.value = ty.value; }).onUpdate(e => { tx.value = Math.max(-width, Math.min(width, savedX.value + e.translationX)); ty.value = Math.max(-height, Math.min(height, savedY.value + e.translationY)); });
  const pinch = Gesture.Pinch().onStart(() => { savedScale.value = scale.value; }).onUpdate(e => { scale.value = Math.min(3, Math.max(0.7, savedScale.value * e.scale)); });
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
  function reset() { scale.value = withSpring(1, spring); tx.value = withSpring(0, spring); ty.value = withSpring(0, spring); setFocusId(null); }
  function focus(node: MapNode) {
    haptic.select();
    if (focusId === node.id) { reset(); return; }
    setFocusId(node.id);
    const point = positions.get(node.id);
    if (!point) return;
    scale.value = withSpring(1.35, spring);
    tx.value = withSpring((width / 2 - point.x) * 1.35, spring);
    ty.value = withSpring((height / 2 - point.y) * 1.35 - 35, spring);
  }
  return <View style={styles.root} testID="orchestra-graph">
    <View style={styles.status}><Text style={styles.hint}>{fixture ? "Fixture · not live" : "Tap to inspect · pinch & pan"}</Text><Text accessibilityLiveRegion="polite" style={styles.hint}>{projected.nodes.length} shown{filter && !filter.only ? ` · ${projected.nodes.filter(n => matchesFilter(n, graph, filter)).length} highlighted` : ""}</Text></View>
    <View style={styles.stateSummary} accessibilityLabel="Graph states">
      {(["live", "needs-you", "failing"] satisfies MapNode["state"][]).map(state => <Text key={state} style={[styles.hint, { color: stateColor[state] }]}>{graph.nodes.filter(node => node.state === state).length} {state === "needs-you" ? "needs you" : state}</Text>)}
    </View>
    <View style={styles.viewport} onLayout={e => setHeight(Math.max(160, e.nativeEvent.layout.height))}>
      <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
        <Animated.View testID="orchestra-map-transform" style={[{ width, height }, transform]}>
          <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
            {projected.edges.map(edge => { const a = positions.get(edge.from); const b = positions.get(edge.to); return a && b ? <MapLink key={edge.id} edge={edge} a={a} b={b} reduced={reduced} dim={Boolean(filter && filter.kind !== edge.relation)} /> : null; })}
          </Svg>
          {projected.nodes.map(node => { const point = positions.get(node.id); return point ? <MapDot key={node.id} node={node} point={point} reduced={reduced} selected={node.id === focusId} dim={!matchesFilter(node, graph, filter)} onPress={() => focus(node)} /> : null; })}
        </Animated.View>
      </GestureDetector>
      {projected.nodes.length === 0 ? <Text style={styles.empty}>{filter ? `No ${filter.kind} reported. Tap the legend again or Reset.` : "No sessions reported. Connect a host to see its graph."}</Text> : null}
      {selected ? <Animated.View style={[styles.sheet, sheetStyle]} accessibilityLabel="Node details">
        <View style={styles.sheetRow}><Text style={styles.sheetTitle} numberOfLines={1}>{selected.label}</Text><Control label="Close" onPress={reset} /></View>
        <Text style={styles.hint}>{selected.kind} · {selected.state}</Text>
        {selected.path ? <Text style={styles.path} numberOfLines={2}>{selected.path}</Text> : null}
      </Animated.View> : null}
    </View>
    {children}
    <View style={styles.dock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.legend} accessibilityLabel="Graph legend. Tap to highlight, hold to show only.">
        {legend.map(kind => <PressScale key={kind} accessibilityRole="button" accessibilityLabel={`Legend ${kind}`} accessibilityHint="Tap to highlight; long press to show only" accessibilityState={{ selected: filter?.kind === kind }} onPress={() => { haptic.select(); setFilter(filter?.kind === kind ? null : { kind, only: false }); }} onLongPress={() => { haptic.select(); setFilter({ kind, only: true }); reset(); }} style={[styles.legendItem, filter?.kind === kind && styles.controlOn]}>
          <Text style={[styles.legendGlyph, { color: legendColor(kind) }]}>{kind === "repo" ? "□" : kind === "host" ? "⊙" : kind === "chat" || kind === "subagent" ? "●" : "━"}</Text><Text style={styles.controlText}>{kind}</Text>
        </PressScale>)}
      </ScrollView>
      <View style={styles.controls}>{layouts.map(mode => <Control key={mode} label={mode[0]?.toUpperCase() + mode.slice(1)} selected={layout === mode} onPress={() => { reset(); setLayout(mode); }} />)}</View>
      <View style={styles.controls}><Control label={focusOnly ? "Focus" : "All"} selected={focusOnly} onPress={() => setFocusOnly(!focusOnly)} /><Control label="Reset" onPress={() => { reset(); setFilter(null); setFocusOnly(false); }} />{actions}</View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  status: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: space.xs },
  hint: { ...type.small, color: colors.textMuted },
  stateSummary: { flexDirection: "row", gap: 16, paddingHorizontal: space.lg, paddingBottom: space.xs },
  viewport: { flex: 1, minHeight: 160, overflow: "hidden" },
  node: { position: "absolute", width: 44, height: 44, alignItems: "center" },
  nodeHit: { width: 44, height: 44 },
  glyph: { borderWidth: 1.5 },
  hostCenter: { position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: colors.textMuted },
  stateRing: { position: "absolute", width: 30, height: 30, borderRadius: 15 },
  orb: { position: "absolute", left: 29, top: 0 },
  liveLabel: { color: colors.information, ...type.label },
  nodeLabel: { position: "absolute", top: 44, width: 84, textAlign: "center", color: colors.textMuted, ...type.small, fontSize: 10, lineHeight: 12 },
  dock: { paddingHorizontal: space.md, paddingTop: 4, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 2 },
  control: { minHeight: controlMin, minWidth: controlMin, paddingHorizontal: 10, borderRadius: radius.pill },
  controlOn: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.goldLo },
  controlText: { ...type.small, color: colors.textMuted },
  legend: { gap: 2 },
  legendItem: { minHeight: controlMin, paddingHorizontal: 9, borderRadius: radius.pill, flexDirection: "row", gap: 6, alignItems: "center" },
  legendGlyph: { fontSize: 15 },
  sheet: { position: "absolute", bottom: 8, left: 16, right: 16, padding: 12, backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.goldLo },
  sheetRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetTitle: { ...type.heading, color: colors.text, flex: 1 },
  path: { ...type.mono, color: colors.textMuted, marginTop: 4 },
  empty: { position: "absolute", top: 24, left: 0, right: 0, ...type.body, color: colors.textMuted, padding: 24 },
});
