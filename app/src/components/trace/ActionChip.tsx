import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  LinearTransition,
  ReduceMotion,
  interpolate,
  interpolateColor,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { haptic } from "../../haptics";
import { useHandedness } from "../../lib/useHandedness";
import { canUndo, CHIP_UNDO_MS, restoreChip, transitionChip } from "../../trace/chip-state";
import { swipeDecision, type SwipeDecision, type TraceAction } from "../../trace/model";
import { fonts, radius, space } from "../../theme";
import { tc } from "./tokens";

export type ChipVariant = "card" | "pill" | "buttons";
type Decision = Exclude<SwipeDecision, null>;

const spring = { duration: 120, dampingRatio: 1, overshootClamping: true, reduceMotion: ReduceMotion.System };
const mutedDo = interpolateColor(0.18, [0, 1], [tc.raised, tc.ok], "RGB", { gamma: 1 });
const mutedNot = interpolateColor(0.12, [0, 1], [tc.raised, tc.text2], "RGB", { gamma: 1 });
const OUTCOME_COLOR: Record<TraceAction["outcome"], string> = { control: tc.live, ring: tc.ok, debt: tc.ask, burn: tc.cut };

/**
 * The full card resolves in place; the parent persists explicit decisions.
 * Coordinates are normalized for handedness before threshold/haptic evaluation.
 */
export function ActionChip({ action, variant = "card", decision, decidedAt, onDecide }: {
  action: TraceAction;
  variant?: ChipVariant;
  decision?: string;
  decidedAt?: string;
  onDecide(id: string, value: Decision | "undo"): void;
}) {
  const reduced = useReducedMotion();
  const { isLeft } = useHandedness();
  const direction = isLeft ? -1 : 1;
  const [w, setW] = useState(320);
  const [now, setNow] = useState(Date.now);
  const at = decidedAt ? Date.parse(decidedAt) : 0;
  const decided = decision === "do" || decision === "not_now";
  const state = useSharedValue(restoreChip(decision, at));
  const progress = useSharedValue(decision === "do" ? 1 : decision === "not_now" ? -1 : 0);
  const x = useSharedValue(0);
  const press = useSharedValue(1);
  const armed = useSharedValue<SwipeDecision>(null);
  const dragging = useSharedValue(0);
  const completion = useSharedValue(0);
  const undoVisible = canUndo(restoreChip(decision, at), now);
  useEffect(() => {
    state.value = restoreChip(decision, at);
    progress.value = withTiming(decision === "do" ? 1 : decision === "not_now" ? -1 : 0, { duration: reduced ? 0 : 120 });
    setNow(Date.now());
    if (!decided) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, at + CHIP_UNDO_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [decision, at, decided, reduced, state, progress]);

  const persist = (d: Decision) => { setNow(Date.now()); onDecide(action.id, d); };
  const success = () => haptic.success();
  const commit = (d: Decision) => {
    if (state.value.phase === "resolved") return;
    state.value = transitionChip(state.value, { type: "commit", decision: d, now: Date.now() });
    progress.value = withTiming(d === "do" ? 1 : -1, { duration: reduced ? 0 : 120 });
    completion.value = 0;
    completion.value = withTiming(1, { duration: reduced ? 0 : 180 }, fin => { if (fin) runOnJS(success)(); });
    persist(d);
  };
  const undo = () => {
    const next = transitionChip(state.value, { type: "undo", now: Date.now() });
    if (next.phase !== "idle") return;
    state.value = next;
    cancelAnimation(completion);
    progress.value = withTiming(0, { duration: reduced ? 0 : 120 });
    onDecide(action.id, "undo");
  };
  const arm = () => haptic.select();

  const pan = Gesture.Pan().enabled(!decided)
    .activeOffsetX([-10, 10]).failOffsetY([-14, 14])
    .onStart(() => {
      state.value = transitionChip(state.value, { type: "drag" });
      dragging.value = 1;
      press.value = withSpring(0.985, spring);
    })
    .onUpdate((e) => {
      const dx = e.translationX * direction;
      x.value = Math.max(-6, Math.min(6, e.translationX * 0.035));
      progress.value = Math.max(-1, Math.min(1, dx / (w * 0.4)));
      const a = swipeDecision(dx, e.velocityX * direction, w);
      if (a !== armed.value) { armed.value = a; if (a) runOnJS(arm)(); }
    })
    .onEnd((e) => {
      const next = transitionChip(state.value, { type: "release", dx: e.translationX * direction, vx: e.velocityX * direction, width: w, now: Date.now() });
      state.value = next;
      if (next.decision) {
        if (armed.value !== next.decision) runOnJS(arm)();
        runOnJS(persist)(next.decision);
        progress.value = withTiming(next.decision === "do" ? 1 : -1, { duration: reduced ? 0 : 120 });
        x.value = withSpring(0, spring);
        completion.value = 0;
        completion.value = withTiming(1, { duration: reduced ? 0 : 180 }, fin => { if (fin) runOnJS(success)(); });
      } else {
        progress.value = withTiming(0, { duration: reduced ? 0 : 120 });
        x.value = withSpring(0, spring);
      }
    })
    .onFinalize(() => {
      if (state.value.phase === "dragging") {
        state.value = transitionChip(state.value, { type: "cancel" });
        progress.value = withTiming(0, { duration: reduced ? 0 : 120 });
        x.value = withSpring(0, spring);
      }
      dragging.value = 0;
      press.value = withSpring(1, spring);
      armed.value = null;
    });

  const chipStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [-1, 0, 1], [mutedNot, tc.raised, mutedDo]),
    transform: [{ translateX: reduced ? 0 : x.value }, { scale: reduced ? 1 : press.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(progress.value), [0, 1], [1, 0.85]) }));
  const doLabel = useAnimatedStyle(() => ({ opacity: dragging.value * Math.max(0, progress.value) }));
  const notLabel = useAnimatedStyle(() => ({ opacity: dragging.value * Math.max(0, -progress.value) }));
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const tone = OUTCOME_COLOR[action.outcome];
  const hint = isLeft ? "Swipe left for Do, right for Not now." : "Swipe right for Do, left for Not now.";

  return (
    <Animated.View layout={reduced ? undefined : LinearTransition.duration(180)} style={styles.outer} onLayout={onLayout} testID={`chip-${action.id}`}>
      <GestureDetector gesture={pan}>
        <Animated.View testID={`chip-surface-${action.id}`} style={[variant === "pill" ? styles.pill : styles.card, chipStyle]} accessibilityRole={decided ? "text" : "adjustable"} accessibilityLabel={`${action.title}. ${decided ? decision === "do" ? "Done" : "Not now" : hint}`}
          accessibilityActions={decided ? [] : [{ name: "increment", label: "Do" }, { name: "decrement", label: "Not now" }]}
          onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === "increment") commit("do"); else if (e.nativeEvent.actionName === "decrement") commit("not_now"); }}
        >
          <View style={styles.headRow}>
            <View style={[styles.outcome, { borderColor: tone }]}><Text style={[styles.outcomeText, { color: tone }]} numberOfLines={1}>{action.outcomeLabel}</Text></View>
            <View style={styles.status}>
              {decided ? <Text accessibilityLiveRegion="polite" style={[styles.badge, { color: decision === "do" ? tc.ok : tc.text2 }]}>{decision === "do" ? "✓ Done" : "× Not now"}</Text> : <>
                <Text style={styles.hint}>⇠ swipe ⇢</Text>
                <Animated.Text style={[styles.preview, { color: tc.ok }, doLabel]}>✓ Do</Animated.Text>
                <Animated.Text style={[styles.preview, { color: tc.text2 }, notLabel]}>× Not now</Animated.Text>
              </>}
            </View>
            {undoVisible ? <Pressable onPress={undo} hitSlop={8} accessibilityRole="button" accessibilityLabel="Undo" style={styles.undo}>
              <Text style={[styles.badge, { color: tc.text2 }]}>Undo</Text>
            </Pressable> : null}
          </View>
          <Animated.View style={contentStyle}>
            <Text style={styles.title} numberOfLines={variant === "pill" ? 1 : 2}>{action.title}</Text>
            {variant === "pill" ? null : <Text style={styles.why} numberOfLines={2}>{action.why}</Text>}
          </Animated.View>
          {variant === "buttons" && !decided ? (
            <View style={styles.btnRow}>
              <ChipButton label="Do" tone={tc.ok} onPress={() => commit("do")} />
              <ChipButton label="Not now" tone={tc.text2} onPress={() => commit("not_now")} />
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function ChipButton({ label, tone, onPress }: { label: string; tone: string; onPress(): void }) {
  const s = useSharedValue(1);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      onPressIn={() => { s.value = withSpring(0.92, spring); haptic.tap(); }}
      onPressOut={() => { s.value = withSpring(1, spring); }} hitSlop={6}>
      <Animated.View style={[styles.btn, { borderColor: tone }, st]}><Text style={[styles.btnText, { color: tone }]}>{label}</Text></Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: { position: "relative", marginBottom: space.sm },
  status: { minWidth: 88, minHeight: 32, justifyContent: "center", alignItems: "flex-end" },
  preview: { position: "absolute", right: 0, fontFamily: fonts.mono, fontSize: 11, backgroundColor: tc.raised, padding: 2 },
  undo: { minHeight: 32, justifyContent: "center", paddingHorizontal: 4 },
  card: { backgroundColor: tc.raised, borderRadius: radius.md, borderWidth: 1, borderColor: tc.rule, padding: space.md, gap: 4, minHeight: 44 },
  pill: { backgroundColor: tc.raised, borderRadius: radius.pill, borderWidth: 1, borderColor: tc.rule, paddingVertical: 8, paddingHorizontal: space.md, gap: 2, minHeight: 44, justifyContent: "center" },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  outcome: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1, flexShrink: 1 },
  outcomeText: { fontFamily: fonts.mono, fontSize: 10, lineHeight: 14 },
  hint: { fontFamily: fonts.mono, fontSize: 10, color: tc.faint },
  badge: { fontFamily: fonts.mono, fontSize: 11 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: tc.text },
  why: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: tc.text2 },
  btnRow: { flexDirection: "row", gap: space.sm, marginTop: 6 },
  btn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 36, justifyContent: "center" },
  btnText: { fontFamily: fonts.semibold, fontSize: 13 },
});
