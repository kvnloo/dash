import { useLayoutEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  cancelAnimation,
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { snappy, settleTiming, fade } from "../../motion";
import { haptic } from "../../haptics";
import { askWord, clock, dur, rowMeta, summarizeRow, type TraceRow, type TraceSnapshot } from "../../trace/model";
import { fonts, radius, space, type } from "../../theme";
import { LivePulse, tc } from "./tokens";
import type { RowRect } from "./TraceTimeline";

const open = { ...fade, easing: snappy.easing, reduceMotion: ReduceMotion.System };

/**
 * Shared-element-style expand: the sheet starts at the tapped row's window rect and springs
 * to the sheet rect; contents fade in once it is mostly open. Drag down, tap the scrim or press
 * back to close (reverse morph into the row). Reduced motion: a plain crossfade.
 */
export function TraceDetail({ snapshot, row, origin, onClose }: { snapshot: TraceSnapshot; row: TraceRow; origin: RowRect; onClose(): void }) {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  const [ready, setReady] = useState(reduced);
  const drag = useSharedValue(0);
  const top = insets.top + 56;
  const target = { x: 0, y: top, width: W, height: H - top + 24 }; // runs past the bottom edge: no gap, no bottom corners
  const from = origin.width > 0 ? origin : { x: target.x, y: target.y + 40, width: target.width, height: 80 };

  useLayoutEffect(() => {
    p.value = withTiming(1, open, finished => { if (finished) runOnJS(setReady)(true); });
  }, [p, reduced]);

  const close = () => {
    haptic.tap();
    p.value = reduced ? withTiming(0, { ...fade, reduceMotion: ReduceMotion.System }, (f) => { if (f) runOnJS(onClose)(); }) : withTiming(0, { ...open }, (f) => { if (f) runOnJS(onClose)(); });
  };

  useLayoutEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { close(); return true; });
    return () => sub.remove();
  });

  const pan = Gesture.Pan()
    .activeOffsetY(12)
    .failOffsetX([-20, 20])
    .onBegin(() => { cancelAnimation(drag); })
    .onUpdate((e) => { drag.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (drag.value > 120 || e.velocityY > 900) { drag.value = withTiming(0, open); runOnJS(close)(); }
      else drag.value = withTiming(0, { ...settleTiming(-drag.value, e.velocityY), reduceMotion: ReduceMotion.System });
    });

  // Transform-only morph: the sheet keeps its final size and is scaled/translated from the tapped row's rect.
  // Animating left/top/width/height re-ran layout for the whole sheet every frame, which made opening lag.
  const sx = from.width / target.width, sy = from.height / target.height;
  const dx = from.x - target.x, dy = from.y - target.y;
  const sheet = useAnimatedStyle(() => {
    const k = reduced ? 1 : p.value;
    const lerp = (a: number, b: number) => a + (b - a) * k;
    const scaleX = lerp(sx, 1), scaleY = lerp(sy, 1);
    const shrink = 1 - interpolate(drag.value, [0, 400], [0, 0.06], Extrapolation.CLAMP);
    return {
      opacity: reduced ? p.value : interpolate(k, [0, 0.15], [0.6, 1], Extrapolation.CLAMP),
      transform: [
        // scale about the top-left corner: shift by half the size change
        { translateX: lerp(dx, 0) - (target.width * (1 - scaleX)) / 2 },
        { translateY: lerp(dy, 0) - (target.height * (1 - scaleY)) / 2 + drag.value },
        { scaleX: scaleX * shrink },
        { scaleY: scaleY * shrink },
      ],
    };
  });
  const scrim = useAnimatedStyle(() => ({ opacity: p.value * 0.72 * (1 - Math.min(1, drag.value / 500)) }));
  const body = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.55, 1], [0, 1], Extrapolation.CLAMP), transform: [{ translateY: interpolate(p.value, [0.5, 1], [12, 0], Extrapolation.CLAMP) }] }));

  const sum = summarizeRow(row);
  const live = row.workers.some((w) => w.status === "running");
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="trace-detail">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close detail" />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.sheet, { left: target.x, top: target.y, width: target.width, height: target.height }, sheet]} accessibilityViewIsModal renderToHardwareTextureAndroid>
          <View style={styles.grab} />
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                {live ? <LivePulse size={7} /> : null}
                <Text style={styles.project} numberOfLines={1}>{row.project}</Text>
              </View>
              <Text style={styles.goal} numberOfLines={1}>{row.goal}</Text>
            </View>
            <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}><Text style={styles.closeText}>×</Text></Pressable>
          </View>
          <Animated.View style={[styles.flex, body]}>
            {ready ? <ScrollView contentContainerStyle={styles.scroll}>
              <View style={styles.metrics}>
                <Metric k="workers" v={String(sum.workers)} />
                <Metric k="calls" v={sum.calls.toLocaleString("en-US")} />
                <Metric k="failed" v={String(sum.errors)} tone={sum.errors >= 10 ? tc.cut : undefined} />
                <Metric k={sum.live ? "since" : "ended"} v={clock(snapshot.t0, sum.live ? sum.s : sum.e)} />
              </View>
              <Text style={styles.section}>{rowMeta(sum).toUpperCase()}</Text>
              {row.workers.map((w) => {
                const status = w.status === "running" ? `live ${dur(snapshot.now - w.s)}` : w.status === "interrupted" ? `cut ${clock(snapshot.t0, w.e)}${w.resumed ? ", resumed" : ""}` : `done ${clock(snapshot.t0, w.e)}`;
                const color = w.status === "running" ? tc.live : w.status === "interrupted" ? tc.cut : tc.text2;
                const stall = w.stalls.reduce((a, [s, e]) => a + e - s, 0);
                return (
                  <View key={w.id} style={styles.worker}>
                    <View style={styles.wTop}>
                      <Text style={styles.wId}>{w.id.replace("run-", "#")}</Text>
                      <Text style={[styles.wStatus, { color }]}>{status}</Text>
                    </View>
                    <MiniBar w={w} t0={sum.s} t1={Math.max(sum.e, sum.s + 60)} />
                    <Text style={styles.wMeta}>
                      {clock(snapshot.t0, w.s)} · ran {dur(w.e - w.s)} · {w.calls} calls · {w.errors} failed{stall ? ` · stalled ${dur(stall)}` : ""}
                    </Text>
                    <Text style={styles.wModel} numberOfLines={1}>{w.model}</Text>
                    {w.asks.length ? <Text style={styles.wAsk}>asked your OK: {w.asks.map(askWord).join(", ")}</Text> : null}
                  </View>
                );
              })}
              <Text style={styles.foot}>Bundled snapshot · labels are allowlisted, no goals or prompts.</Text>
            </ScrollView> : <View accessibilityLabel="Loading detail" style={styles.flex} />}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
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
  scrim: { backgroundColor: "#000" },
  sheet: { position: "absolute", backgroundColor: "#121310", borderWidth: 1, borderColor: tc.rule, overflow: "hidden", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  grab: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(236,232,223,.22)", marginTop: 8 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: tc.rule },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  project: { ...type.heading, color: tc.text, fontSize: 18 },
  goal: { fontFamily: fonts.body, fontSize: 14, color: tc.text2 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(236,232,223,.06)" },
  closeText: { color: tc.text2, fontSize: 22, lineHeight: 24 },
  flex: { flex: 1 },
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
  foot: { fontFamily: fonts.mono, fontSize: 10, color: tc.faint, marginTop: space.lg },
});
