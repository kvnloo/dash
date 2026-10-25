import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { MOTION_MS } from "../motion";
import { colors, space, type } from "../theme";
import { matchesFilter, projectMap, type MapFilter, type MapKind, type MapNode, type MapRelation, type OrchestraMap } from "../lib/orchestra-map";
import { defaultView, ORCHESTRA_VIEWS, TRIAGE_LANES, viewGraph, type OrchestraView } from "../lib/orchestra-views";
import { PressScale } from "./PressScale";
import { useAmbientRunning } from "./OrbMotion";
import { InteractiveTile } from "./InteractiveTile";
import { Tree } from "./Tree";
import type { TreeNode } from "../lib/tree";

const kindColor = { chat: colors.gold, subagent: colors.orchestraSubagent, repo: colors.gold, host: colors.textMuted };
const stateColor = { idle: colors.textMuted, live: colors.information, "needs-you": colors.warn, failing: colors.danger, done: colors.textMuted };
const relationColor = { delegated: colors.gold, touched: colors.information, hosted: colors.textFaint, workspace: colors.provenance };
const legend: (MapKind | MapRelation)[] = ["chat", "subagent", "repo", "host", "delegated", "touched", "hosted", "workspace"];
function isKind(k: MapKind | MapRelation): k is MapKind { return k === "chat" || k === "subagent" || k === "repo" || k === "host"; }
function Glyph({ kind }: { kind: MapKind | MapRelation }) {
  return isKind(kind) ? <View style={{ width: 11, height: 11, borderRadius: kind === "repo" ? 1 : 6, borderWidth: 1.5, borderColor: kindColor[kind], backgroundColor: kind === "host" ? "transparent" : kindColor[kind] }} /> : <View style={{ width: 20, height: 0, borderTopWidth: kind === "hosted" ? 1 : 2, borderColor: relationColor[kind], borderStyle: kind === "workspace" ? "dotted" : "solid" }} />;
}
function Wire({ relation, active }: { relation: MapRelation; active: boolean }) {
  const running = useAmbientRunning(), opacity = useSharedValue(1);
  useEffect(() => {
    if (active && relation === "delegated" && running) opacity.value = withRepeat(withTiming(0.3, { duration: 650 }), -1, true);
    else { cancelAnimation(opacity); opacity.value = 1; }
    return () => cancelAnimation(opacity);
  }, [active, relation, running, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ width: 18, height: 24, borderLeftWidth: relation === "hosted" ? 1 : 2, borderBottomWidth: relation === "hosted" ? 1 : 2, borderColor: relationColor[relation], borderStyle: relation === "workspace" ? "dotted" : "solid", marginLeft: 10 }, animated]} />;
}
export function OrchestraGraph({ graph, width: _width, children, actions, fixture = false, error, warnings = [], onOpen, onFeedback, canOpen }: { graph: OrchestraMap; width: number; children?: ReactNode; actions?: ReactNode; fixture?: boolean; error?: string; warnings?: string[]; onOpen?(node: MapNode): void; onFeedback?(node: MapNode): void; canOpen?(node: MapNode): boolean }) {
  const [view, setView] = useState<OrchestraView>(() => defaultView(graph.nodes));
  const [chosen, setChosen] = useState(false);
  const [filter, setFilter] = useState<MapFilter | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusOnly, setFocusOnly] = useState(false);
  useEffect(() => { if (!chosen) setView(defaultView(graph.nodes)); }, [graph, chosen]);
  const current = useMemo(() => viewGraph(graph, view), [graph, view]);
  const projected = useMemo(() => projectMap(current, filter, focusId, focusOnly), [current, filter, focusId, focusOnly]);
  const selected = graph.nodes.find(n => n.id === focusId);
  const liveConnections = (id: string) => new Set(projected.edges.filter(e => (e.from === id || e.to === id) && projected.nodes.some(n => n.state === "live" && (n.id === e.from || n.id === e.to))).map(e => e.from === id ? e.to : e.from)).size;
  const fade = useSharedValue(1);
  const transition = useAnimatedStyle(() => ({ opacity: fade.value }));
  function switchView(next: OrchestraView) { fade.value = 0.5; setView(next); setChosen(true); setFilter(null); setFocusId(null); setFocusOnly(false); fade.value = withTiming(1, { duration: MOTION_MS.exit }); }
  function card(node: MapNode, compact = false) {
    const dim = !matchesFilter(node, current, filter) || node.online === false;
    return <InteractiveTile key={node.id} title={node.label} summary={`${node.kind}: ${node.label}, ${node.state}. ${node.reason || ""}`} onOpen={() => setFocusId(node.id)} extraActions={onFeedback ? [{ id: "feedback", label: "Feedback", run: () => onFeedback(node) }] : []} style={[styles.card, compact && styles.compact, { opacity: dim ? 0.4 : 1, borderColor: node.collision || node.state === "failing" ? colors.danger : focusId === node.id ? colors.gold : colors.border }, node.collision && styles.collision]}>
      <View style={styles.row}><Glyph kind={node.kind} /><Text style={styles.label} numberOfLines={2}>{node.label}</Text><Text style={[styles.state, { color: stateColor[node.state] }]}>{node.kind === "host" ? node.online === false ? "offline" : "online" : node.state === "needs-you" ? "needs you" : node.state}</Text></View>
      {node.kind === "repo" ? <Text style={styles.meta} numberOfLines={2}>{node.branch || "branch unknown"} · {node.dirty === undefined ? "dirty unknown" : `${node.dirty} dirty`} · {node.collision ? "W1 COLLISION" : node.reason}</Text> : null}
      {node.kind === "host" ? <Text style={styles.meta}>{node.health || "Health unavailable"}</Text> : null}
      {!compact && node.kind !== "host" && node.kind !== "repo" ? <><Text style={styles.meta} numberOfLines={2}>{node.reason || "No live state reported"}</Text><Text style={styles.action} numberOfLines={2}>→ {node.action || TRIAGE_LANES.find(l => l.state === node.state)?.action}</Text></> : null}
    </InteractiveTile>;
  }
  const lineageRoots = projected.nodes.filter(n => !projected.edges.some(e => e.to === n.id));
  const treeNode = (node: MapNode, seen = new Set<string>()): TreeNode => {
    const next = new Set(seen).add(node.id);
    const children = projected.edges.filter(e => e.from === node.id).flatMap(e => {
      const child = projected.nodes.find(n => n.id === e.to);
      return child && !next.has(child.id) ? [treeNode(child, next)] : [];
    });
    return { id: node.id, label: node.label, kind: node.kind === "repo" ? "repo" : node.kind === "host" ? "host" : "session",
      meta: node.state, detail: `${node.parentId ? "delegated · " : ""}${node.reason || "No live state reported"}`,
      shimmer: node.state === "live", dimmed: !matchesFilter(node, current, filter),
      onPress: () => setFocusId(node.id), children: children.length ? children : undefined };
  };
  return <View style={styles.root} testID="orchestra-graph">
    <Text style={styles.summary}>{graph.nodes.filter(n => n.state === "live" && n.kind !== "repo").length} live · {graph.nodes.filter(n => n.state === "needs-you").length} need you · {graph.nodes.filter(n => n.kind === "host").length} hosts</Text>
    <View style={styles.tabs}>{ORCHESTRA_VIEWS.map(mode => <PressScale key={mode.id} accessibilityRole="button" accessibilityLabel={mode.title} accessibilityState={{ selected: view === mode.id }} onPress={() => switchView(mode.id)} style={[styles.tab, view === mode.id && styles.tabOn]}><Text style={[styles.tabTitle, view === mode.id && { color: colors.gold }]}>{mode.title}</Text><Text style={styles.subtitle}>{mode.subtitle}</Text></PressScale>)}</View>
    <Text style={styles.hint}>{fixture ? "Fixture · not live" : "Read-only host evidence · last 24h"} · Tap a label to inspect</Text>
    {error ? <Text accessibilityRole="alert" style={styles.warning}>{error}</Text> : null}
    {warnings.length ? <Text style={styles.warning}>{warnings.join(" · ")}</Text> : null}
    {view === "work" ? <Text style={styles.hint}>{current.nodes.filter(n => n.collision).length} W1 collisions · {current.nodes.filter(n => n.kind !== "repo" && n.state === "live").length} live sessions changing worktrees</Text> : null}
    {view === "triage" ? <Text style={styles.hint}>{TRIAGE_LANES.map(l => `${l.title} ${current.nodes.filter(n => n.state === l.state).length}`).join(" → ")}</Text> : null}
    <Animated.View style={[styles.body, transition]}><ScrollView contentContainerStyle={styles.content}>
      {children}
      {view === "fleet" ? <View style={styles.telemetry}>{current.nodes.filter(n => n.kind === "host").map(host => <PressScale key={host.id} onPress={() => { setFocusId(host.id); setFocusOnly(true); }} style={[styles.telemetryRow, host.online === false && { opacity: 0.4, minHeight: 26 }]}><View style={styles.row}><Glyph kind="host" /><Text style={styles.label}>{host.label}</Text><Text style={styles.meta}>{host.online === false ? "offline · " : ""}{current.edges.filter(e => e.from === host.id && current.nodes.some(n => n.id === e.to && n.state === "live")).length} live</Text></View>{host.online !== false ? <Text style={styles.meta}>{host.health || host.reason}</Text> : null}</PressScale>)}</View> : null}
      {view === "triage" ? TRIAGE_LANES.map(lane => {
        const nodes = projected.nodes.filter(n => n.state === lane.state);
        return <View key={lane.state} style={[styles.lane, { borderLeftColor: stateColor[lane.state] }]}><Text style={[styles.heading, { color: stateColor[lane.state] }]}>{lane.title} · {nodes.length}</Text>{nodes.length ? nodes.map(n => card(n)) : <Text style={styles.meta}>Nothing here</Text>}</View>;
      }) : view === "lineage" ? <><Text style={styles.heading}>Delegation tree · {projected.edges.length} recorded links</Text><Tree inline label="Recorded delegation" nodes={lineageRoots.map(n => treeNode(n))} initialExpanded={projected.nodes.map(n => n.id)} /></> : projected.nodes.filter(n => n.kind === (view === "fleet" ? "host" : "repo")).sort((a, b) => Number(Boolean(b.collision)) - Number(Boolean(a.collision)) || liveConnections(b.id) - liveConnections(a.id)).map(hub => {
        const edges = projected.edges.filter(e => view === "fleet" ? e.from === hub.id : e.to === hub.id);
        const children = projected.nodes.filter(n => edges.some(e => e.from === n.id || e.to === n.id) && n.id !== hub.id).sort((a, b) => Number(b.state === "live") - Number(a.state === "live"));
        const live = children.filter(n => n.state === "live").length;
        return <View key={hub.id} style={styles.hub}>{card(hub)}<Text style={styles.meta}>{children.length} sessions · {live} live{hub.collision ? " · ONE OWNER PER WORKTREE" : ""}</Text><View style={styles.spokes}>{children.map(node => <View key={node.id} style={styles.spoke}><View style={styles.row}>{edges.filter(e => e.from === node.id || e.to === node.id).map(e => <Wire key={e.id} relation={e.relation} active={e.active} />)}</View>{card(node, true)}</View>)}</View>{!children.length ? <Text style={styles.meta}>No sessions reported on this host</Text> : null}</View>;
      })}
      {filter?.only && isKind(filter.kind) && ((view === "fleet" && filter.kind !== "host") || (view === "work" && filter.kind !== "repo")) ? projected.nodes.map(n => card(n)) : null}
      {!projected.nodes.length ? <Text style={styles.meta}>No {view === "lineage" ? "recorded delegation" : "matching evidence"} in this snapshot. No relationships inferred.</Text> : null}
      {graph.nodes.filter(n => n.grouped).map(n => <Text key={n.id} style={styles.hint}>{n.label} · {n.reason}</Text>)}
    </ScrollView></Animated.View>
    <View style={styles.legend} accessibilityLabel="Graph legend. Tap to highlight, hold to show only.">{legend.map(kind => {
      const items = isKind(kind) ? current.nodes.filter(n => n.kind === kind) : current.edges.filter(e => e.relation === kind);
      if (!items.length) return null;
      const live = isKind(kind) ? current.nodes.filter(n => n.kind === kind && n.state === "live").length : current.edges.filter(e => e.relation === kind && e.active).length;
      return <PressScale key={kind} accessibilityRole="button" accessibilityLabel={`Legend ${kind}`} accessibilityHint="Tap to highlight; long press to show only" onPress={() => setFilter(filter?.kind === kind ? null : { kind, only: false })} onLongPress={() => { setFilter({ kind, only: true }); setFocusOnly(false); }} style={[styles.legendItem, filter?.kind === kind && styles.tabOn]}><Glyph kind={kind} /><Text style={styles.meta}>{kind} {items.length} · {live} live</Text></PressScale>;
    })}</View>
    <View style={styles.footer}><PressScale onPress={() => { setFocusOnly(!focusOnly); }} style={styles.button}><Text style={styles.meta}>{focusOnly ? "All" : "Focus"}</Text></PressScale><PressScale onPress={() => { setFilter(null); setFocusOnly(false); setFocusId(null); }} style={styles.button}><Text style={styles.meta}>Reset</Text></PressScale>{actions}</View>
    {selected ? <View style={styles.sheet} accessibilityLabel="Node details"><ScrollView><Text style={styles.heading}>{selected.label}</Text><Text style={styles.meta}>{selected.kind} · {selected.state} · {selected.harness}{selected.model ? ` · ${selected.model}` : ""}</Text><Text style={styles.label}>{selected.reason || "No live state reported"}</Text><Text style={styles.action}>→ {selected.action || TRIAGE_LANES.find(l => l.state === selected.state)?.action}</Text><Text selectable style={styles.meta}>{selected.path}{selected.branch ? ` · ${selected.branch}` : ""}</Text><Text style={styles.meta}>Parent: {graph.nodes.find(n => n.id === selected.parentId)?.label || "None recorded"}</Text><Text style={styles.meta}>Children: {graph.edges.filter(e => e.from === selected.id && e.relation === "delegated").map(e => graph.nodes.find(n => n.id === e.to)?.label).join(", ") || "None recorded"}</Text><Text selectable style={styles.meta}>{selected.provenance?.join("\n")}</Text><View style={styles.row}>{onOpen && selected.sessionId && (!canOpen || canOpen(selected)) ? <PressScale onPress={() => onOpen(selected)} style={styles.button}><Text style={styles.action}>Open chat</Text></PressScale> : null}{selected.path?.startsWith("https://github.com/") ? <PressScale onPress={() => void Linking.openURL(selected.path!)} style={styles.button}><Text style={styles.action}>Open PR</Text></PressScale> : null}<PressScale onPress={() => setFocusId(null)} style={styles.button}><Text style={styles.action}>Close</Text></PressScale></View></ScrollView></View> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 }, summary: { color: colors.text, ...type.body, paddingHorizontal: 16, paddingVertical: 8 },
  tabs: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 6 }, tab: { width: "48%", minHeight: 60, alignItems: "flex-start", padding: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }, tabOn: { backgroundColor: colors.surfaceRaised, borderColor: colors.goldLo }, tabTitle: { color: colors.text, ...type.label }, subtitle: { color: colors.textMuted, fontSize: 10, marginTop: 3 },
  hint: { color: colors.textMuted, fontSize: 10, paddingHorizontal: 16, paddingVertical: 8 }, warning: { color: colors.warn, fontSize: 11, paddingHorizontal: 16, paddingBottom: 4 }, body: { flex: 1, minHeight: 100 }, content: { padding: 14, paddingBottom: 30, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 }, label: { color: colors.text, fontSize: 12, lineHeight: 17, flexShrink: 1, flex: 1 }, state: { fontSize: 10 }, meta: { color: colors.textMuted, fontSize: 10, lineHeight: 15 }, action: { color: colors.gold, fontSize: 11, lineHeight: 16 }, heading: { color: colors.text, ...type.label, marginBottom: 8 },
  card: { padding: 10, borderRadius: 8, borderWidth: 1, backgroundColor: colors.surface, gap: 5, alignItems: "stretch" }, compact: { minHeight: 64, flex: 1 }, collision: { backgroundColor: "#2b1015", shadowColor: colors.danger, shadowOpacity: 0.6, shadowRadius: 10 },
  telemetry: { gap: 4, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.border }, telemetryRow: { alignItems: "stretch", padding: 4, minHeight: 36 },
  lane: { borderLeftWidth: 2, paddingLeft: 10, gap: 8 }, hub: { gap: 6 }, spokes: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, spoke: { width: "48%" },
  legend: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, borderTopWidth: 1, borderColor: colors.border }, legendItem: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 38, paddingHorizontal: 6, borderRadius: 6 },
  footer: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.md, gap: 10 }, button: { minHeight: 44, paddingHorizontal: 10 },
  sheet: { position: "absolute", bottom: 70, left: 12, right: 12, maxHeight: "65%", padding: 16, backgroundColor: colors.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: colors.goldLo, gap: 8 },
});
