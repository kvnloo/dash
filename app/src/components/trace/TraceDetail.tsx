import { useLayoutEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../../haptics";
import { askWord, clock, dur, rowMeta, summarizeRow, type TraceRow, type TraceSnapshot } from "../../trace/model";
import { fonts, radius, space, type } from "../../theme";
import { LivePulse, tc } from "./tokens";
import { TraceEvidenceCards, type TraceRoute } from "./TraceEvidenceCards";

const enter = FadeIn.duration(140).reduceMotion(ReduceMotion.System);

/** Keep the evidence mounted from the first frame; only opacity animates. */
export function TraceDetail({ snapshot, row, stale = false, onClose, onNavigate }: { snapshot: TraceSnapshot; row: TraceRow; stale?: boolean; onClose(): void; onNavigate?(route: TraceRoute): void }) {
  const insets = useSafeAreaInsets();
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [turnId, setTurnId] = useState<string>();
  const turn = row.turns?.find(item => item.id === turnId) ?? row.turns?.[0];
  const evidence = turn?.evidence ?? row.evidence;
  const close = () => { haptic.tap(); onClose(); };

  useLayoutEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const sum = summarizeRow(row);
  const live = row.workers.some((w) => w.status === "running");
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="trace-detail">
      <Pressable style={[StyleSheet.absoluteFill, styles.scrim]} onPress={close} accessibilityLabel="Close detail" />
      <Animated.View entering={enter} style={[styles.sheet, { paddingBottom: insets.bottom }]} accessibilityViewIsModal>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                {live ? <LivePulse size={7} /> : null}
                <Text style={styles.project} numberOfLines={1}>{row.project}</Text>
              </View>
              <Text style={styles.goal} numberOfLines={2}>{row.goal}</Text>
            </View>
            <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.scroll}>
              {row.turns && row.turns.length > 1 ? <View style={styles.turnControls}>
                <Pressable accessibilityRole="button" disabled={row.turns[0]?.id === turn?.id} onPress={() => {
                  const index = row.turns?.findIndex(item => item.id === turn?.id) ?? 0;
                  setTurnId(row.turns?.[index - 1]?.id);
                }}><Text style={styles.turnButton}>Newer turn</Text></Pressable>
                <Text style={styles.provText}>Turn · {turn ? clock(snapshot.t0, turn.at) : "Time unknown"}</Text>
                <Pressable accessibilityRole="button" disabled={row.turns.at(-1)?.id === turn?.id} onPress={() => {
                  const index = row.turns?.findIndex(item => item.id === turn?.id) ?? 0;
                  setTurnId(row.turns?.[index + 1]?.id);
                }}><Text style={styles.turnButton}>Older turn</Text></Pressable>
              </View> : null}
              <TraceEvidenceCards key={turn?.id} evidence={evidence} onNavigate={route => { onClose(); onNavigate?.(route); }} />
              <View style={styles.provenance} testID="trace-provenance">
                <Text style={styles.provText} selectable>Event · {row.key}</Text>
                <Text style={styles.provText} selectable numberOfLines={2}>Source · {evidence?.intent.provenance.source ?? row.provenance?.source ?? "unknown"}</Text>
                {evidence ? <Text style={styles.provText} selectable>Request hash · {evidence.intent.provenance.sourceHash.slice(0, 12)}</Text> : null}
                {stale ? <Text style={[styles.provText, { color: tc.cut }]}>No longer in the live feed · showing its last received copy</Text> : null}
              </View>
              <Pressable onPress={() => setMetricsOpen(v => !v)} accessibilityRole="button" accessibilityLabel="Worker metrics" accessibilityState={{ expanded: metricsOpen }} aria-expanded={metricsOpen}>
                <Text style={styles.section}>{metricsOpen ? "−" : "+"} WORKERS & METRICS · {sum.workers}</Text>
              </Pressable>
              {metricsOpen ? <>
              <View style={styles.metrics}>
                <Metric k="workers" v={String(sum.workers)} />
                <Metric k="calls" v={sum.calls.toLocaleString("en-US")} />
                <Metric k="failed" v={String(sum.errors)} tone={sum.errors >= 10 ? tc.cut : undefined} />
                <Metric k={sum.live ? "since" : "ended"} v={clock(snapshot.t0, sum.live ? sum.s : sum.e)} />
              </View>
              <Text style={styles.section}>{rowMeta(sum).toUpperCase()}</Text>
              {row.workers.map((w) => {
                const status = w.status === "unknown" ? "liveness unknown" : w.status === "running" ? `live ${dur(snapshot.now - w.s)}` : w.status === "interrupted" ? `cut ${clock(snapshot.t0, w.e)}${w.resumed ? ", resumed" : ""}` : `done ${clock(snapshot.t0, w.e)}`;
                const color = w.status === "running" ? tc.live : w.status === "interrupted" ? tc.cut : tc.text2;
                const stall = w.stalls.reduce((a, [s, e]) => a + e - s, 0);
                return (
                  <View key={w.id} style={styles.worker}>
                    <View style={styles.wTop}>
                      <Text style={styles.wId}>{w.id.replace("run-", "#")}</Text>
                      <Text style={[styles.wStatus, { color }]}>{status}</Text>
                    </View>
                    {w.status === "unknown" ? null : <MiniBar w={w} t0={sum.s} t1={Math.max(sum.e, sum.s + 60)} />}
                    <Text style={styles.wMeta}>
                      {w.status === "unknown" ? "Duration / error counts unavailable" : `${clock(snapshot.t0, w.s)} · ran ${dur(w.e - w.s)} · ${w.calls} calls · ${w.errors} failed${stall ? ` · stalled ${dur(stall)}` : ""}`}
                    </Text>
                    <Text style={styles.wModel} numberOfLines={1}>{w.model}</Text>
                    {w.asks.length ? <Text style={styles.wAsk}>needs your OK: {w.asks.map(askWord).join(", ")}</Text> : null}
                  </View>
                );
              })}
              </> : null}
              <Text style={styles.foot}>{evidence ? "Private authenticated evidence · unknown is not acceptance" : "No original request or validation recorded for this event"}</Text>
          </ScrollView>
      </Animated.View>
    </View>
  );
}

function Metric({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.mk}>{k}</Text>
      <Text style={[styles.mv, tone ? { color: tone } : null]} numberOfLines={1}>{v}</Text>
    </View>
  );
}

function MiniBar({ w, t0, t1 }: { w: TraceRow["workers"][number]; t0: number; t1: number }) {
  const span = t1 - t0;
  const max = Math.max(1, ...w.density);
  return (
    <View style={styles.miniTrack}>
      <View style={[styles.miniBar, { left: `${((w.s - t0) / span) * 100}%`, width: `${(Math.max(60, w.e - w.s) / span) * 100}%` }, w.status === "running" && { borderColor: tc.barLiveEdge }]}>
        {w.density.map((d, i) => d ? <View key={i} style={{ position: "absolute", bottom: 0, left: `${(i / w.density.length) * 100}%`, width: `${70 / w.density.length}%`, height: `${Math.max(12, (d / max) * 100)}%`, backgroundColor: tc.tick }} /> : null)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,.72)" },
  sheet: { position: "absolute", top: 56, bottom: 0, left: 0, right: 0, backgroundColor: "#121310", borderWidth: 1, borderColor: tc.rule, overflow: "hidden", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  turnControls: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" },
  turnButton: { color: tc.live, paddingVertical: space.sm },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: tc.rule },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  project: { ...type.heading, color: tc.text, fontSize: 18 },
  goal: { fontFamily: fonts.body, fontSize: 14, color: tc.text2 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(236,232,223,.06)" },
  closeText: { color: tc.text2, fontSize: 22, lineHeight: 24 },
  scroll: { padding: space.lg, gap: space.md, paddingBottom: 48 },
  metrics: { flexDirection: "row", gap: space.sm },
  metric: { flex: 1, backgroundColor: tc.raised, borderRadius: radius.sm, padding: space.sm, borderWidth: 1, borderColor: tc.rule },
  mk: { ...type.label, fontSize: 10, color: tc.text3, textTransform: "uppercase" },
  mv: { fontFamily: fonts.mono, fontSize: 14, color: tc.text, fontVariant: ["tabular-nums"] },
  section: { ...type.label, fontSize: 11, color: tc.text3, marginTop: space.sm },
  worker: { borderTopWidth: 1, borderTopColor: tc.grid, paddingTop: space.sm, gap: 4 },
  wTop: { flexDirection: "row", justifyContent: "space-between" },
  wId: { fontFamily: fonts.mono, fontSize: 13, color: tc.text },
  wStatus: { fontFamily: fonts.mono, fontSize: 12 },
  wMeta: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16, color: tc.text3 },
  wModel: { fontFamily: fonts.mono, fontSize: 10, color: tc.faint },
  wAsk: { fontFamily: fonts.mono, fontSize: 11, color: tc.ask },
  miniTrack: { height: 12, position: "relative" },
  miniBar: { position: "absolute", top: 1, height: 10, borderRadius: 2, borderWidth: 1, borderColor: tc.barEdge, backgroundColor: tc.bar, overflow: "hidden" },
  provenance: { gap: 2, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: tc.grid },
  provText: { fontFamily: fonts.mono, fontSize: 10, lineHeight: 15, color: tc.text3 },
  foot: { fontFamily: fonts.mono, fontSize: 10, color: tc.faint, marginTop: space.lg },
});
