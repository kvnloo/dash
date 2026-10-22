import { useEffect, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { ReduceMotion, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { haptic } from "../haptics";
import { useUiFlag } from "../lib/density-store";
import { shows } from "../lib/info-levels";
import type { LiveProject } from "../lib/project-data";
import { LIP, traceNow, tuckProgress, tuckSnap, tuckTransform } from "../lib/zero-card";
import { settleTiming, snappy } from "../motion";
import { dur } from "../trace/model";
import { traceStore } from "../trace/source";
import { colors, fonts, glass, radius, space, type } from "../theme";
import { timeAgo } from "../util";
import { useDensity } from "./Density";
import { PressScale } from "./PressScale";
import { LivePulse, tc } from "./trace/tokens";

const timing = { ...snappy, reduceMotion: ReduceMotion.System };

/**
 * The Zero card: the project/host card with the agent trace as a sub-card, anchored directly above
 * the text bar. It is a physical card: drag it down (or tap its handle) and it slides down and
 * shrinks behind the bar until only a lip shows; drag the lip up (or tap it) to bring it back.
 * Shown/hidden persists per screen.
 */
export function ZeroCard({ screen, project, onOpenTrace }: { screen: string; project?: LiveProject; onOpenTrace(): void }) {
  const { info, sizing } = useDensity();
  const snapshot = traceStore.use(s => s.snapshot);
  const now = traceNow(snapshot);
  const st = snapshot.stats;
  const [shown, setShown] = useUiFlag(`zero-shown:${screen}`, true);
  const [cardH, setCardH] = useState(0);
  const p = useSharedValue(shown ? 1 : 0);
  const start = useSharedValue(0);
  const h = useSharedValue(0);
  useEffect(() => { p.value = withTiming(shown ? 1 : 0, timing); }, [shown, p]);

  const commit = (next: boolean) => { haptic.select(); setShown(next); };
  // Shown: only a downward drag moves the card (an upward swipe belongs to the trace sub-card).
  // Tucked: only an upward drag on the lip.
  const pan = Gesture.Pan()
    .activeOffsetY(shown ? [-10000, 8] : [-8, 10000])
    .failOffsetX([-16, 16])
    .onStart(() => { cancelAnimation(p); start.value = p.value; })
    .onUpdate(e => { p.value = tuckProgress(start.value, e.translationY, Math.max(1, h.value - LIP)); })
    .onEnd(e => {
      const next = tuckSnap(p.value, e.velocityY);
      const target = next ? 1 : 0;
      const travel = Math.max(1, h.value - LIP);
      p.value = withTiming(target, { ...settleTiming((target - p.value) * travel, -e.velocityY), reduceMotion: ReduceMotion.System });
      runOnJS(commit)(next);
    });

  const openTrace = () => { haptic.select(); onOpenTrace(); };
  const swipeUp = Gesture.Pan()
    .activeOffsetY([-12, 10000])
    .failOffsetY(12)
    .onEnd(e => { if (e.translationY < -40 || e.velocityY < -500) runOnJS(openTrace)(); });

  const wrap = useAnimatedStyle(() => ({ height: h.value === 0 ? LIP : LIP + (h.value - LIP) * p.value }));
  const card = useAnimatedStyle(() => {
    const t = tuckTransform(p.value, h.value);
    return { transform: [{ translateY: t.translateY }, { scale: t.scale }] };
  });
  const body = useAnimatedStyle(() => ({ opacity: p.value < 0.15 ? p.value / 0.15 : 1 }));
  const onLayout = (e: LayoutChangeEvent) => { const next = e.nativeEvent.layout.height; if (Math.abs(next - cardH) > 1) { setCardH(next); h.value = next; } };

  const name = project?.name ?? "zero";
  const running = now.live > 0;
  return <Animated.View style={[styles.wrap, wrap]} testID="zero-card-wrap">
    <GestureDetector gesture={pan}><View style={styles.fill}>
      <Animated.View onLayout={onLayout} style={[styles.card, { padding: sizing.padding, gap: Math.max(4, sizing.gap) }, card]} testID={shown ? "zero-card" : "zero-card-tucked"}>
        <PressScale accessibilityRole="button" accessibilityLabel={shown ? "Hide Zero card" : "Show Zero card"} onPress={() => commit(!shown)} style={styles.handleHit} hitSlop={8} testID="zero-handle">
          <View style={styles.handle} />
        </PressScale>
        <Animated.View style={[{ gap: Math.max(4, sizing.gap) }, body]} pointerEvents={shown ? "auto" : "none"}>
          <View style={styles.top}>
            <LivePulse size={7} color={running ? tc.live : tc.text3} />
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            {shows("zeroCard", "counts", info) && project ? <Text style={styles.meta} numberOfLines={1}>{project.agentRows.length} agents · {project.chatIds.length} chats</Text> : null}
            {shows("zeroCard", "age", info) && project ? <Text style={styles.meta}>{timeAgo(project.updatedAt)}</Text> : null}
          </View>
          {shows("zeroCard", "path", info) && project ? <Text style={styles.path} numberOfLines={1}>{project.hostName} · {project.cwd}</Text> : null}
          <GestureDetector gesture={swipeUp}><View>
          <PressScale accessibilityRole="button" accessibilityLabel={`Agent trace: ${now.step}, ${dur(now.elapsedS)}. Open trace.`} accessibilityHint="Swipe up or tap to open the full trace" onPress={openTrace} style={styles.sub} testID="zero-trace">
            <View style={styles.subRow}>
              <Text style={styles.subTitle}>Trace</Text>
              <Text style={styles.step} numberOfLines={1}>{now.step}</Text>
              {shows("traceCard", "elapsed", info) ? <Text style={styles.elapsed}>{dur(now.elapsedS)}</Text> : null}
              <Text style={styles.chev}>›</Text>
            </View>
            {shows("traceCard", "counts", info) ? <View style={styles.subRow}>
              <Text style={[styles.k, { color: tc.live }]}>{st.live} live</Text>
              <Text style={[styles.k, { color: tc.cut }]}>{st.cut} cut</Text>
              <Text style={[styles.k, { color: tc.ask }]}>{st.asks} ask</Text>
              {shows("traceCard", "workers", info) ? <Text style={styles.k}>{st.workers} workers{now.model ? ` · ${now.model}` : ""}</Text> : null}
            </View> : null}
            {shows("traceCard", "read", info) ? <Text style={styles.read} numberOfLines={2}>{snapshot.read}</Text> : null}
          </PressScale>
          </View></GestureDetector>
        </Animated.View>
      </Animated.View>
      {shown ? null : <PressScale accessibilityRole="button" accessibilityLabel="Show Zero card" onPress={() => commit(true)} hitSlop={{ top: 16, bottom: 0, left: 0, right: 0 }} style={styles.lip} testID="zero-lip" />}
    </View></GestureDetector>
  </Animated.View>;
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: space.md, zIndex: 0, justifyContent: "flex-end" },
  card: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: 0, borderRadius: radius.lg, backgroundColor: glass.fillRaised, borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight, transformOrigin: "top center" },
  fill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  lip: { position: "absolute", left: 0, right: 0, top: 0, height: LIP },
  handleHit: { alignSelf: "center", height: 18, width: 64, alignItems: "center", justifyContent: "center" },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.textTertiary },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { ...type.cardTitle, fontSize: 20, lineHeight: 24, color: colors.text, flexShrink: 1 },
  meta: { ...type.mono, color: colors.textTertiary, marginLeft: "auto" },
  path: { ...type.mono, color: colors.textTertiary },
  sub: { borderRadius: radius.md, backgroundColor: tc.raised, borderWidth: 1, borderColor: tc.rule, padding: 10, gap: 4, alignItems: "stretch" },
  subRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  subTitle: { ...type.label, color: tc.text3, textTransform: "uppercase" },
  step: { fontFamily: fonts.semibold, fontSize: 13, color: tc.text, flex: 1 },
  elapsed: { fontFamily: fonts.mono, fontSize: 11, color: tc.text2, fontVariant: ["tabular-nums"] },
  chev: { color: tc.text3, fontSize: 18, lineHeight: 18 },
  k: { fontFamily: fonts.mono, fontSize: 11, color: tc.text3 },
  read: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: tc.text2 },
});
