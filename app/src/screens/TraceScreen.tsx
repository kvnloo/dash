import { fade } from "../motion";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated, { FadeInUp, FadeOutUp, useReducedMotion } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { TileGrid } from "../components/TileGrid";
import { DensityPicker } from "../components/Density";
import { InformationDensityPicker } from "../components/InformationDensityPicker";
import { ScreenHeader } from "../components/ScreenHeader";
import { ActionChip } from "../components/trace/ActionChip";
import { ReadStrip } from "../components/trace/ReadStrip";
import { StatTile } from "../components/trace/StatTile";
import { TraceDetail } from "../components/trace/TraceDetail";
import { TraceTimeline, type ScrubState } from "../components/trace/TraceTimeline";
import { tc } from "../components/trace/tokens";
import type { ScreenProps } from "../navigation";
import { CHIP_REORDER_MS, orderChips, restoreChip } from "../trace/chip-state";
import { activeSeries, clock, dur, GROUP_LABEL, summarizeRow, type TraceRow, type TraceSnapshot } from "../trace/model";
import { feedbackStore, latest, loadFeedback, record, traceStore, type TraceFeed } from "../trace/source";
import { colors, fonts, space } from "../theme";
import { store } from "../store/app";
import { useTraceFeed } from "../trace/useTraceFeed";
import { ago, feedStatus } from "../trace/feed-state";
import { useIsFocused } from "@react-navigation/native";
import { traceVerdict } from "../../../shared/trace-evidence";
import type { TraceRoute } from "../components/trace/TraceEvidenceCards";

/** Agent trace: live events from the paired bridge, or an explicit reason they are unavailable. */
export function TraceScreen({ navigation }: ScreenProps<"Trace">) {
  const feed = traceStore.use((s) => s.feed);
  const settings = store.use(s => s.settings);
  const focused = useIsFocused();
  useTraceFeed(settings, focused);
  const onNavigate = useCallback((route: TraceRoute) => navigation.navigate(route), [navigation]);
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScreenHeader title="Trace" compact onBack={() => navigation.goBack()} onAction={() => navigation.navigate("Lab")} action="Component lab" icon="layers" />
      <DensityPicker />
      <InformationDensityPicker />
      {feed.phase === "live" ? <LiveTrace snapshot={feed.snapshot} receivedAt={feed.receivedAt} arrived={feed.arrived} onNavigate={onNavigate} pairKey={`${settings?.address}|${settings?.token}`} />
        : <FeedState feed={feed} />}
    </SafeAreaView>
  );
}

function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function FeedState({ feed }: { feed: TraceFeed }) {
  const now = useNow(1000);
  const status = feedStatus(feed, now);
  return (
    <ScrollView contentContainerStyle={styles.scroll} testID="trace-scroll">
      <View style={styles.state} testID={`trace-feed-${feed.phase}`} accessibilityLiveRegion="polite">
        <Text style={styles.stateTitle}>{status.title}</Text>
        <Text style={styles.stateDetail}>{status.detail}</Text>
      </View>
    </ScrollView>
  );
}

function LiveTrace({ snapshot, receivedAt, arrived, onNavigate, pairKey }: { snapshot: TraceSnapshot; receivedAt: number; arrived: string[]; onNavigate(route: TraceRoute): void; pairKey: string }) {
  const records = feedbackStore.use((s) => s.records);
  const reduced = useReducedMotion();
  const now = useNow(1000);
  const scrollRef = useRef<ScrollView>(null);
  const [open, setOpen] = useState<TraceRow | null>(null);
  const [showPlot, setShowPlot] = useState(false);
  const [scrub, setScrub] = useState<ScrubState>(null);
  useEffect(() => { void loadFeedback(); }, []);
  useEffect(() => { setOpen(null); }, [pairKey]);

  const series = useMemo(() => activeSeries(snapshot.rows, snapshot.now), [snapshot]);
  const [orderTime, setOrderTime] = useState(Date.now);
  useEffect(() => {
    setOrderTime(Date.now());
    const timer = setTimeout(() => setOrderTime(Date.now()), CHIP_REORDER_MS + 10);
    return () => clearTimeout(timer);
  }, [records]);
  const actions = orderChips(snapshot.actions, id => {
    const response = records.find(r => r.kind === "action" && r.id === id);
    return restoreChip(response?.value, response ? Date.parse(response.at) : 0);
  }, orderTime);
  const st = snapshot.stats;
  const onDecide = useCallback((id: string, v: "do" | "not_now" | "undo") => record("action", id, v), []);
  const onOpenRow = useCallback((row: TraceRow) => setOpen(row), []);
  const closeRow = useCallback(() => setOpen(null), []);
  // The open detail follows its row by key across polls; a row that left the feed keeps its last copy, labelled.
  const current = open ? snapshot.rows.find(r => r.key === open.key) : undefined;
  const newest = arrived.map(key => snapshot.rows.find(r => r.key === key)).filter((r): r is TraceRow => Boolean(r));

  return (
    <>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} testID="trace-scroll">
        <Text style={styles.sub} testID="trace-feed-live">
          Live from bridge · updated {ago(now - receivedAt)} · {snapshot.rows.length} events · last {dur(snapshot.now)} to {clock(snapshot.t0, snapshot.now)}
        </Text>
        {newest.length ? <Text style={[styles.sub, { color: tc.live }]} numberOfLines={2} testID="trace-arrived">New since last update · {newest.map(r => r.goal).join(" · ")}</Text> : null}
        <View style={styles.timelineHeader}>
          <Text accessibilityRole="header" style={styles.timelineHeading}>Activity timeline</Text>
          <Pressable accessibilityRole="button" onPress={() => { setShowPlot(value => !value); setScrub(null); }}>
            <Text style={styles.switchView}>{showPlot ? "Show list" : "Show time chart"}</Text>
          </Pressable>
        </View>
        {showPlot ? <>
        <ReadStrip text={snapshot.read} variant="slide" />
        {actions.length ? <View style={styles.chips}>
          {actions.map((a) => (
            <ActionChip key={a.id} action={a} variant="card" decision={latest(records, "action", a.id)} decidedAt={records.find(r => r.kind === "action" && r.id === a.id)?.at} onDecide={onDecide} />
          ))}
        </View> : null}
        <TileGrid>
          <StatTile label="live" value={st.live} sub={`of ${st.workers}`} tone={tc.live} variant="number" />
          <StatTile label="cut" value={st.cut} sub={`${st.resumed} resumed`} tone={tc.cut} variant="meter"
            segments={[{ n: st.resumed, color: tc.ok, label: "resumed" }, { n: st.cut - st.resumed, color: tc.cut, label: "not resumed" }]} />
          <StatTile label="active" value={series[series.length - 1] ?? 0} sub={`peak ${Math.max(0, ...series)}`} variant="spark" series={series} />
        </TileGrid>
        <Text style={styles.hint}>Pinch to zoom · drag to pan · hold a row for its actions · tap a row</Text>
        <TraceTimeline snapshot={snapshot} rows={snapshot.rows} onOpenRow={onOpenRow} onScrub={setScrub} scrollRef={scrollRef} selectedKey={open?.key ?? null} freshKeys={arrived} />
        </> : <ActivityList snapshot={snapshot} arrived={arrived} onOpenRow={onOpenRow} />}
      </ScrollView>
      {scrub ? (
        <Animated.View entering={reduced ? undefined : FadeInUp.duration(fade.duration)} exiting={reduced ? undefined : FadeOutUp.duration(fade.duration)} style={styles.float} pointerEvents="none" testID="scrub-float">
          <Text style={styles.floatT}>{scrub.label}</Text>
          <Text style={styles.floatS}>{scrub.live} live then</Text>
        </Animated.View>
      ) : null}
      {open ? <TraceDetail key={open.key} snapshot={snapshot} row={current ?? open} stale={!current} onClose={closeRow} onNavigate={onNavigate} /> : null}
    </>
  );
}

const ActivityList = memo(function ActivityList({ snapshot, arrived, onOpenRow }: {
  snapshot: TraceSnapshot; arrived: string[]; onOpenRow(row: TraceRow): void;
}) {
  const ordered = snapshot.rows.map(row => ({ row, summary: summarizeRow(row) })).sort((a, b) => b.summary.e - a.summary.e);
  const groups = (["live", "recent", "earlier"] as const).map(group => ({ group, items: ordered.filter(item => item.row.group === group) }));
  return (
    <View testID="trace-timeline" style={styles.activity}>
      {groups.filter(({ items }) => items.length).map(({ group, items }) => (
        <View key={group} style={styles.activityGroup}>
          <Text accessibilityRole="header" style={styles.groupTitle}>{group === "earlier" ? "Earlier" : GROUP_LABEL[group]} · {items.length}</Text>
          {items.map(({ row, summary }) => {
            const status = summary.live ? "Running" : summary.cut ? "Interrupted" : row.workers.length > 0 && row.workers.every(w => w.status === "completed") ? "Completed" : "Status unknown";
            const verdict = traceVerdict(row.turns?.[0]?.evidence ?? row.evidence);
            return <Pressable key={row.key} accessibilityRole="button" testID={`row-${row.key}`} onPress={() => onOpenRow(row)}
              style={({ pressed }) => [styles.event, pressed && { backgroundColor: tc.raised }]}>
              <Text style={styles.eventMeta}>{row.project} · {Number.isFinite(summary.e) ? clock(snapshot.t0, summary.e) : "Time unknown"}</Text>
              <Text style={styles.eventTitle} numberOfLines={3}>{row.goal}</Text>
              <Text style={styles.eventMeta}>{status}{arrived.includes(row.key) ? " · New" : ""}{verdict === "unknown" ? "" : ` · Validation ${verdict}`}</Text>
            </Pressable>;
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 120, gap: space.md },
  sub: { fontFamily: fonts.mono, fontSize: 11, color: tc.text3, paddingHorizontal: space.lg },
  timelineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.lg },
  timelineHeading: { color: tc.text, fontSize: 20, fontWeight: "600" },
  switchView: { color: tc.live, paddingVertical: space.sm },
  activity: { paddingHorizontal: space.lg, gap: space.lg },
  activityGroup: { gap: space.xs },
  groupTitle: { color: tc.text2, fontSize: 14, fontWeight: "600", paddingBottom: space.xs },
  event: { borderTopWidth: 1, borderTopColor: tc.rule, paddingVertical: space.md, gap: space.xs },
  eventTitle: { color: tc.text, fontSize: 16, lineHeight: 22 },
  eventMeta: { color: tc.text3, fontSize: 12, lineHeight: 17 },
  chips: { paddingHorizontal: space.lg },
  hint: { fontFamily: fonts.mono, fontSize: 10, color: tc.faint, paddingHorizontal: space.lg, marginTop: space.sm },
  state: { marginHorizontal: space.lg, marginTop: space.lg, padding: space.lg, gap: space.sm, borderWidth: 1, borderColor: tc.rule, borderRadius: 12, backgroundColor: tc.raised },
  stateTitle: { fontFamily: fonts.mono, fontSize: 13, color: tc.text },
  stateDetail: { fontSize: 13, lineHeight: 19, color: tc.text3 },
  float: { position: "absolute", top: 112, alignSelf: "center", flexDirection: "row", gap: 10, alignItems: "baseline", backgroundColor: "rgba(21,22,17,.96)", borderRadius: 999, borderWidth: 1, borderColor: tc.rule, paddingHorizontal: 18, paddingVertical: 10 },
  floatT: { fontFamily: fonts.mono, fontSize: 18, color: tc.text, fontVariant: ["tabular-nums"] },
  floatS: { fontFamily: fonts.mono, fontSize: 12, color: tc.live },
});
