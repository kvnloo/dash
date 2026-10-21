import { useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeIn,
  LinearTransition,
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { haptic } from "../../haptics";
import { SNAP } from "../../motion";
import { swipeDecision, type SwipeDecision, type TraceAction } from "../../trace/model";
import { fonts, radius, space, type } from "../../theme";
import { tc } from "./tokens";

export type ChipVariant = "card" | "pill" | "buttons";
type Decision = Exclude<SwipeDecision, null>;

const spring = { ...SNAP, reduceMotion: ReduceMotion.System };
const OUTCOME_COLOR: Record<TraceAction["outcome"], string> = { control: tc.live, ring: tc.ok, debt: tc.ask, burn: tc.cut };

/**
 * Swipe right = Do, left = Not now. A haptic marks the commit threshold; releasing past it
 * flies the chip out, then it settles back as a decided row (tap it to undo).
 */
export function ActionChip({ action, variant = "card", decision, onDecide }: {
  action: TraceAction;
  variant?: ChipVariant;
  decision?: string;
  onDecide(id: string, value: Decision | "undo"): void;
}) {
  const reduced = useReducedMotion();
  const [w, setW] = useState(320);
  const x = useSharedValue(0);
  const press = useSharedValue(1);
  const armed = useSharedValue(0);

  const commit = (d: Decision) => { haptic.success(); onDecide(action.id, d); };
  const arm = () => haptic.select();

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-14, 14])
    .onBegin(() => { press.value = withSpring(0.97, spring); })
    .onUpdate((e) => {
      x.value = e.translationX;
      const a = Math.abs(e.translationX) > w * 0.35 ? (e.translationX > 0 ? 1 : -1) : 0;
      if (a !== armed.value) { armed.value = a; if (a !== 0) runOnJS(arm)(); }
    })
    .onEnd((e) => {
      const d = swipeDecision(e.translationX, e.velocityX, w);
      if (d) {
        const out = d === "do" ? w * 1.1 : -w * 1.1;
        x.value = withTiming(out, { duration: reduced ? 0 : 160, reduceMotion: ReduceMotion.System }, (fin) => {
          if (fin) { runOnJS(commit)(d); x.value = withSpring(0, spring); }
        });
      } else {
        x.value = withSpring(0, { ...spring, velocity: e.velocityX });
      }
    })
    .onFinalize(() => { press.value = withSpring(1, spring); armed.value = 0; });


  const chipStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { scale: press.value }, { rotate: `${interpolate(x.value, [-w, 0, w], [-2.5, 0, 2.5])}deg` }],
  }));
  const doUnder = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, w * 0.35], [0, 1], "clamp") }));
  const notUnder = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-w * 0.35, 0], [1, 0], "clamp") }));
  const doLabel = useAnimatedStyle(() => ({ transform: [{ scale: armed.value === 1 ? withSpring(1.12, spring) : withSpring(1, spring) }] }));
  const notLabel = useAnimatedStyle(() => ({ transform: [{ scale: armed.value === -1 ? withSpring(1.12, spring) : withSpring(1, spring) }] }));

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const decided = decision === "do" || decision === "not_now";
  const tone = OUTCOME_COLOR[action.outcome];

  return (
    <Animated.View layout={reduced ? undefined : LinearTransition.springify().mass(SNAP.mass).stiffness(SNAP.stiffness).damping(SNAP.damping)} style={styles.outer} onLayout={onLayout} testID={`chip-${action.id}`}>
      <Animated.View style={[styles.under, styles.underDo, doUnder]}><Animated.Text style={[styles.underText, { color: tc.ok }, doLabel]}>Do</Animated.Text></Animated.View>
      <Animated.View style={[styles.under, styles.underNot, notUnder]}><Animated.Text style={[styles.underText, { color: tc.text2 }, notLabel]}>Not now</Animated.Text></Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[variant === "pill" ? styles.pill : styles.card, decided && decision === "not_now" && styles.dim, chipStyle]} accessibilityRole="adjustable" accessibilityLabel={`${action.title}. Swipe right for Do, left for Not now.`}
          accessibilityActions={[{ name: "increment", label: "Do" }, { name: "decrement", label: "Not now" }]}
          onAccessibilityAction={(e) => onDecide(action.id, e.nativeEvent.actionName === "increment" ? "do" : "not_now")}
        >
          <View style={styles.headRow}>
            <View style={[styles.outcome, { borderColor: tone }]}><Text style={[styles.outcomeText, { color: tone }]} numberOfLines={1}>{action.outcomeLabel}</Text></View>
            {decided ? (
              <Animated.View entering={reduced ? undefined : FadeIn.duration(160)}>
                <Pressable onPress={() => onDecide(action.id, "undo")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Undo">
                  <Text style={[styles.badge, { color: decision === "do" ? tc.ok : tc.text3 }]}>{decision === "do" ? "Do ✓" : "Not now"} · undo</Text>
                </Pressable>
              </Animated.View>
            ) : variant !== "buttons" ? <Text style={styles.hint}>⇠ swipe ⇢</Text> : null}
          </View>
          <Text style={styles.title} numberOfLines={variant === "pill" ? 1 : 2}>{action.title}</Text>
          {variant === "pill" ? null : <Text style={styles.why} numberOfLines={2}>{action.why}</Text>}
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
  under: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, borderRadius: radius.md, justifyContent: "center", paddingHorizontal: space.lg },
  underDo: { backgroundColor: "rgba(152,207,139,.14)", alignItems: "flex-start" },
  underNot: { backgroundColor: "rgba(236,232,223,.07)", alignItems: "flex-end" },
  underText: { ...type.heading },
  card: { backgroundColor: tc.raised, borderRadius: radius.md, borderWidth: 1, borderColor: tc.rule, padding: space.md, gap: 4, minHeight: 44 },
  pill: { backgroundColor: tc.raised, borderRadius: radius.pill, borderWidth: 1, borderColor: tc.rule, paddingVertical: 8, paddingHorizontal: space.md, gap: 2, minHeight: 44, justifyContent: "center" },
  dim: { opacity: 0.5 },
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
