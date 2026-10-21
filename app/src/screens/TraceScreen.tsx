import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import Animated, { FadeInUp, FadeOutUp, useReducedMotion } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { DensityPicker } from "../components/Density";
import { ScreenHeader } from "../components/ScreenHeader";
import { ActionChip } from "../components/trace/ActionChip";
import { ReadStrip } from "../components/trace/ReadStrip";
import { StatTile } from "../components/trace/StatTile";
import { TraceDetail } from "../components/trace/TraceDetail";
import { TraceTimeline, type RowRect, type ScrubState } from "../components/trace/TraceTimeline";
import { tc } from "../components/trace/tokens";
import type { ScreenProps } from "../navigation";
import { activeSeries, clock, type TraceRow } from "../trace/model";
import { feedbackStore, latest, loadFeedback, record, traceStore } from "../trace/source";
import { colors, fonts, space } from "../theme";

/** Agent trace, native: READ strip, swipe chips, stat tiles and the gesture timeline. */
export function TraceScreen({ navigation }: ScreenProps<"Trace">) {
  const { snapshot, origin } = traceStore.use((s) => s);
  const records = feedbackStore.use((s) => s.records);
  const reduced = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const [open, setOpen] = useState<{ row: TraceRow; rect: RowRect } | null>(null);
  const [scrub, setScrub] = useState<ScrubState>(null);
  useEffect(() => { void loadFeedback(); }, []);

  const series = useMemo(() => activeSeries(snapshot.rows, snapshot.now), [snapshot]);
  const st = snapshot.stats;
  const onDecide = useCallback((id: string, v: "do" | "not_now" | "undo") => record("action", id, v), []);
  const onOpenRow = useCallback((row: TraceRow, rect: RowRect) => setOpen({ row, rect }), []);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScreenHeader title="Trace" compact onBack={() => navigation.goBack()} onAction={() => navigation.navigate("Lab")} action="Component lab" icon="layers" />
      <DensityPicker />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} testID="trace-scroll">
        <Text style={styles.sub}>
          {clock(snapshot.t0, 0)} to now {clock(snapshot.t0, snapshot.now)} · {st.workers} workers · {origin === "bundled" ? "bundled snapshot" : "live from bridge"}
        </Text>
        <ReadStrip text={snapshot.read} variant="slide" />
        <View style={styles.chips}>
          {snapshot.actions.map((a) => (
            <ActionChip key={a.id} action={a} variant="card" decision={latest(records, "action", a.id)} onDecide={onDecide} />
          ))}
        </View>
        <View style={styles.tiles}>
          <StatTile label="live" value={st.live} sub={`of ${st.workers}`} tone={tc.live} variant="number" />
          <StatTile label="cut" value={st.cut} sub={`${st.resumed} resumed`} tone={tc.cut} variant="meter"
            segments={[{ n: st.resumed, color: tc.ok, label: "resumed" }, { n: st.cut - st.resumed, color: tc.cut, label: "not resumed" }]} />
          <StatTile label="active" value={series[series.length - 1] ?? 0} sub={`peak ${Math.max(...series)}`} variant="spark" series={series} />
        </View>
        <Text style={styles.hint}>Pinch to zoom · drag to pan · hold to scrub · tap a row</Text>
        <TraceTimeline snapshot={snapshot} rows={snapshot.rows} onOpenRow={onOpenRow} onScrub={setScrub} scrollRef={scrollRef} selectedKey={open?.row.key ?? null} />
      </ScrollView>
      {scrub ? (
        <Animated.View entering={reduced ? undefined : FadeInUp.duration(120)} exiting={reduced ? undefined : FadeOutUp.duration(120)} style={styles.float} pointerEvents="none" testID="scrub-float">
          <Text style={styles.floatT}>{scrub.label}</Text>
          <Text style={styles.floatS}>{scrub.live} live then</Text>
        </Animated.View>
      ) : null}
      {open ? <TraceDetail snapshot={snapshot} row={open.row} origin={open.rect} onClose={() => setOpen(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 120, gap: space.md },
  sub: { fontFamily: fonts.mono, fontSize: 11, color: tc.text3, paddingHorizontal: space.lg },
  chips: { paddingHorizontal: space.lg },
  tiles: { flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg },
  hint: { fontFamily: fonts.mono, fontSize: 10, color: tc.faint, paddingHorizontal: space.lg, marginTop: space.sm },
  float: { position: "absolute", top: 112, alignSelf: "center", flexDirection: "row", gap: 10, alignItems: "baseline", backgroundColor: "rgba(21,22,17,.96)", borderRadius: 999, borderWidth: 1, borderColor: tc.rule, paddingHorizontal: 18, paddingVertical: 10 },
  floatT: { fontFamily: fonts.mono, fontSize: 18, color: tc.text, fontVariant: ["tabular-nums"] },
  floatS: { fontFamily: fonts.mono, fontSize: 12, color: tc.live },
});
