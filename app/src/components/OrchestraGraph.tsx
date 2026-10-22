import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, ReduceMotion, useAnimatedProps, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Circle, Line } from "react-native-svg";
import { ambient } from "../motion-ambient";
import { snappy } from "../motion";
import { haptic } from "../haptics";
import { useHandedness } from "../lib/useHandedness";
import { colors, controlMin, radius, space, type } from "../theme";
import { mapPositions, matchesFilter, projectMap, type MapEdge, type MapFilter, type MapKind, type MapLayout, type MapNode, type MapRelation, type OrchestraMap, type Point } from "../lib/orchestra-map";
import { AgentOrb } from "./AgentOrb";
import { PressScale } from "./PressScale";
import { useDensity } from "./Density";
import { shows } from "../lib/info-levels";
import type { InfoLevel } from "../lib/density";
import { usePageControls, type SettingRow } from "../lib/settings-registry";

const NodeInfo = createContext<InfoLevel>(3);

const ALine = Animated.createAnimatedComponent(Line);
const ACircle = Animated.createAnimatedComponent(Circle);
const spring = { ...snappy, reduceMotion: ReduceMotion.System };
const kindColor: Record<MapKind, string> = { chat: colors.gold, subagent: colors.orchestraSubagent, repo: colors.gold, host: colors.textMuted };
const stateColor = { idle: colors.textMuted, live: colors.information, "needs-you": colors.warn, failing: colors.danger };
const relationColor: Record<MapRelation, string> = { delegated: colors.gold, touched: colors.information, hosted: colors.textFaint, workspace: colors.provenance };
/** Orchestra's own view registry. The menu's view row is data-driven from this list, so renamed views (#98) render unchanged. */
export const ORCHESTRA_VIEWS: readonly MapLayout[] = ["spine", "constellation", "radial", "islands"];
const layouts = ORCHESTRA_VIEWS;
const legend: (MapKind | MapRelation)[] = ["chat", "subagent", "repo", "host", "delegated", "touched", "hosted", "workspace"];
function legendColor(kind: MapKind | MapRelation): string {
  return kind === "chat" || kind === "subagent" || kind === "repo" || kind === "host" ? kindColor[kind] : relationColor[kind];
}

function MapLink({ edge, a, b, reduced, dim }: { edge: MapEdge; a: Point; b: Point; reduced: boolean; dim: boolean }) {
  const x1 = useDerivedValue(() => withTiming(a.x, spring), [a.x]);
  const y1 = useDerivedValue(() => withTiming(a.y, spring), [a.y]);
  const x2 = useDerivedValue(() => withTiming(b.x, spring), [b.x]);
  const y2 = useDerivedValue(() => withTiming(b.y, spring), [b.y]);
  const flow = useSharedValue(0);
  useLayoutEffect(() => {
    if (edge.active && edge.relation === "delegated" && !reduced) flow.value = withRepeat(withTiming(1, ambient(2400, true)), -1, false);
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
  useLayoutEffect(() => {
    x.value = withTiming(point.x, spring);
    y.value = withTiming(point.y, spring);
    appear.value = withTiming(1, spring);
  }, [point.x, point.y, x, y, appear]);
  useLayoutEffect(() => {
    if (node.state === "live" && !reduced) pulse.value = withRepeat(withTiming(1.2, ambient(1700)), -1, true);
    else { cancelAnimation(pulse); pulse.value = 1; }
    return () => cancelAnimation(pulse);
  }, [node.state, reduced, pulse]);
  const position = useAnimatedStyle(() => ({ left: x.value - 22, top: y.value - 22, opacity: dim ? 0.2 : 1, transform: [{ scale: appear.value }] }));
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: 1.6 - pulse.value }));
  const info = useContext(NodeInfo);
  const stateOn = shows("orchestraNode", "state", info);
  return <Animated.View style={[styles.node, position]}>
    <PressScale accessibilityRole="button" accessibilityLabel={`${node.kind}: ${node.label}, ${node.state}`} accessibilityState={{ selected }} onPress={onPress} style={styles.nodeHit}>
      <Animated.View style={[styles.stateRing, { borderColor: selected ? colors.goldHi : stateColor[node.state], borderWidth: selected || (stateOn && node.state !== "idle") ? 2 : 0 }, ring]} />
      <View style={[styles.glyph, { backgroundColor: node.kind === "host" ? "transparent" : kindColor[node.kind], borderColor: kindColor[node.kind], borderRadius: node.kind === "repo" ? 3 : 10, width: node.kind === "subagent" ? 10 : 14, height: node.kind === "subagent" ? 10 : 14 }]} />
      {node.kind === "host" ? <View style={styles.hostCenter} /> : null}
      {stateOn && (node.state === "live" || node.state === "needs-you") ? <View style={styles.orb} pointerEvents="none">{reduced ? <Text style={styles.liveLabel}>{node.state === "needs-you" ? "!" : "•"}</Text> : <AgentOrb thinking={node.thinking} size={20} />}</View> : null}
    </PressScale>
    {shows("orchestraNode", "label", info) ? <Text numberOfLines={1} style={styles.nodeLabel}>{node.label}</Text> : null}
    {shows("orchestraNode", "caption", info) ? <Text numberOfLines={1} style={[styles.nodeLabel, styles.nodeMeta]}>{node.state === "needs-you" ? "needs you" : node.state}</Text> : null}
    {shows("orchestraNode", "path", info) && node.path ? <Text numberOfLines={1} style={[styles.nodeLabel, styles.nodePath]}>{node.path.split("/").slice(-2).join("/")}</Text> : null}
  </Animated.View>;
}

function Control({ label, selected = false, onPress, onLongPress }: { label: string; selected?: boolean; onPress(): void; onLongPress?(): void }) {
  return <PressScale accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={() => { haptic.select(); onPress(); }} onLongPress={onLongPress ? () => { haptic.select(); onLongPress(); } : undefined} style={[styles.control, selected && styles.controlOn]}><Text style={[styles.controlText, selected && { color: colors.goldHi }]}>{label}</Text></PressScale>;
}

export function OrchestraGraph({ graph, width, children, approvals, fixture = false }: { graph: OrchestraMap; width: number; children?: ReactNode; approvals?: { pending: number; open(): void }; fixture?: boolean }) {
  const { info } = useDensity();
  const thumb = useHandedness();
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
  useLayoutEffect(() => { sheet.value = withTiming(selected ? 0 : 200, spring); }, [selected, sheet]);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheet.value }] }));
  const pan = Gesture.Pan().minDistance(10).onStart(() => { cancelAnimation(tx); cancelAnimation(ty); savedX.value = tx.value; savedY.value = ty.value; }).onUpdate(e => { tx.value = Math.max(-width, Math.min(width, savedX.value + e.translationX)); ty.value = Math.max(-height, Math.min(height, savedY.value + e.translationY)); });
  const pinch = Gesture.Pinch().onStart(() => { cancelAnimation(scale); savedScale.value = scale.value; }).onUpdate(e => { scale.value = Math.min(3, Math.max(0.7, savedScale.value * e.scale)); });
  const transform = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
  function reset() { scale.value = withTiming(1, spring); tx.value = withTiming(0, spring); ty.value = withTiming(0, spring); setFocusId(null); }
  function focus(node: MapNode) {
    haptic.select();
    if (focusId === node.id) { reset(); return; }
    setFocusId(node.id);
    const point = positions.get(node.id);
    if (!point) return;
    scale.value = withTiming(1.35, spring);
    tx.value = withTiming((width / 2 - point.x) * 1.35, spring);
    ty.value = withTiming((height / 2 - point.y) * 1.35 - 35, spring);
  }
  const legendValues = ["none", ...legend];
  const rows: SettingRow[] = [
    { id: "orchestra-view", label: "View", kind: "scrub", home: "composer", values: layouts.map(mode => `${mode[0]?.toUpperCase() ?? ""}${mode.slice(1)}`), index: Math.max(0, layouts.indexOf(layout)), select: i => { const next = layouts[i]; if (next) { reset(); setLayout(next); } }, hint: "Graph layout" },
    { id: "orchestra-scope", label: "Show", kind: "toggle", home: "composer", values: ["All", "Focus"], index: focusOnly ? 1 : 0, select: i => setFocusOnly(i === 1) },
    { id: "orchestra-legend", label: "Highlight", kind: "scrub", home: "composer", values: legendValues, index: filter ? Math.max(0, legendValues.indexOf(filter.kind)) : 0, select: i => { const kind = legend[i - 1]; setFilter(kind ? { kind, only: false } : null); }, hint: "Highlight one kind" },
    { id: "orchestra-reset", label: "Reset", kind: "action", home: "composer", values: ["view"], index: 0, select: () => {}, run: () => { reset(); setFilter(null); setFocusOnly(false); } },
    ...(approvals ? [{ id: "orchestra-approvals", label: "Approvals", kind: "action" as const, home: "composer" as const, values: [`${approvals.pending} pending`], index: 0, select: () => {}, run: approvals.open }] : []),
  ];
  usePageControls("orchestra", rows);
  return <NodeInfo.Provider value={info}><View style={styles.root} testID="orchestra-graph">
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
    {shows("orchestraNode", "state", info) ? <View style={styles.dock} accessibilityLabel="Graph legend">
      {legend.map(kind => <View key={kind} style={[styles.legendItem, filter?.kind === kind && styles.controlOn]}>
        <Text style={[styles.legendGlyph, { color: legendColor(kind) }]}>{kind === "repo" ? "□" : kind === "host" ? "⊙" : kind === "chat" || kind === "subagent" ? "●" : "━"}</Text><Text style={styles.controlText}>{kind}</Text>
      </View>)}
    </View> : null}
  </View></NodeInfo.Provider>;
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
  dock: { flexDirection: "row", flexWrap: "wrap", columnGap: 4, paddingHorizontal: space.md, paddingVertical: 2 },
  nodeMeta: { top: 56, color: colors.textTertiary },
  nodePath: { top: 68, color: colors.textFaint },
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
