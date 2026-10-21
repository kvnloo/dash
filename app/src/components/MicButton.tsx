import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type ReactNode, memo, useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { haptic } from "../haptics";
import { MIC_DEFAULT_KEY, MIC_IDLE, type MicChoice, type MicEvent, type MicState, PICK_THRESHOLD, micStep, parseMicChoice } from "../lib/mic-gesture";
import { snappy } from "../motion";
import { colors, fonts, glass } from "../theme";

interface Props {
  onDictate(): void;
  onLive(): void;
  /** Left-handed mode mirrors the picker label side. */
  side: "left" | "right";
  /** Optional glyph override (the live-call orb). The gesture stays the same. */
  children?: ReactNode;
  /** Overrides the remembered tap default (e.g. reopen the voice screen during a live call). */
  onTap?(): void;
  accessibilityLabel?: string;
}

const HOLD_MS = 260;

/** Composer mic. Tap = remembered default. Hold → picker: slide up = Live voice, down = Dictate; release on the button cancels. */
export const MicButton = memo(function MicButton({ onDictate, onLive, side, children, onTap, accessibilityLabel }: Props) {
  const [preferred, setPreferred] = useState<MicChoice>("dictate");
  const [picker, setPicker] = useState<MicState>(MIC_IDLE);
  const state = useRef<MicState>(MIC_IDLE);
  useEffect(() => { void AsyncStorage.getItem(MIC_DEFAULT_KEY).then(v => setPreferred(parseMicChoice(v)), () => {}); }, []);

  const open = useSharedValue(0);
  const dyShared = useSharedValue(0);

  const run = useCallback((choice: MicChoice) => { choice === "live" ? onLive() : onDictate(); }, [onDictate, onLive]);

  const send = useCallback((event: MicEvent) => {
    const prev = state.current;
    const { state: next, outcome } = micStep(prev, event);
    state.current = next;
    if (next.phase !== prev.phase || next.hover !== prev.hover) setPicker(next);
    if (next.phase === "picker" && prev.phase !== "picker") haptic.tap();
    else if (next.phase === "picker" && next.hover !== prev.hover) haptic.select();
    if (!outcome) return;
    if (outcome.kind === "tap") onTap ? onTap() : run(preferred);
    else if (outcome.kind === "choose") {
      haptic.success();
      setPreferred(outcome.choice);
      void AsyncStorage.setItem(MIC_DEFAULT_KEY, outcome.choice).catch(() => {});
      run(outcome.choice);
    }
  }, [onTap, preferred, run]);

  const tapNow = useCallback(() => {
    state.current = MIC_IDLE; setPicker(MIC_IDLE);
    haptic.tap();
    if (__DEV__) console.log("[mic] tap", onTap ? "onTap" : preferred);
    onTap ? onTap() : run(preferred);
  }, [onTap, preferred, run]);

  const pan = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onBegin(() => { runOnJS(send)({ type: "down" }); })
    .onStart(() => { open.value = withTiming(1, snappy); runOnJS(send)({ type: "longPress" }); })
    .onUpdate(e => {
      const prevBand = dyShared.value <= -PICK_THRESHOLD ? -1 : dyShared.value >= PICK_THRESHOLD ? 1 : 0;
      const band = e.translationY <= -PICK_THRESHOLD ? -1 : e.translationY >= PICK_THRESHOLD ? 1 : 0;
      dyShared.value = e.translationY;
      if (band !== prevBand) runOnJS(send)({ type: "move", dy: e.translationY });
    })
    .onEnd(() => { runOnJS(send)({ type: "up" }); })
    .onFinalize((_e, success) => {
      open.value = withTiming(0, snappy);
      dyShared.value = 0;
      if (!success) runOnJS(send)({ type: "cancel" });
    });
  // A quick tap is its own gesture: relying on the long-press pan failing (onFinalize success=false) never fired
  // on device, so the mic did nothing. Exclusive: the hold-pan wins once it activates, otherwise the tap fires.
  const tap = Gesture.Tap().maxDuration(HOLD_MS).onEnd((_e, success) => { if (success) runOnJS(tapNow)(); });
  const gesture = Gesture.Exclusive(pan, tap);

  const bloom = useAnimatedStyle(() => ({ opacity: open.value, transform: [{ scale: 0.85 + open.value * 0.15 }] }));
  const hover = picker.hover;
  const labelSide = side === "left" ? styles.labelsRight : styles.labelsLeft;

  return <GestureDetector gesture={gesture}>
    <View accessible accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (preferred === "live" ? "Live voice" : "Dictate")} accessibilityHint="Hold and slide up for Live voice, down for Dictate" accessibilityActions={[{ name: "activate" }, { name: "dictate", label: "Dictate" }, { name: "live", label: "Live voice" }]} onAccessibilityAction={e => { const n = e.nativeEvent.actionName; if (n === "activate") onTap ? onTap() : run(preferred); else if (n === "dictate" || n === "live") run(n); }} style={styles.hit}>
      {children ?? <Feather name="mic" size={18} color={colors.textMuted} />}
      {!children && preferred === "live" ? <View style={styles.badge} /> : null}
      <Animated.View pointerEvents="none" style={[styles.picker, labelSide, bloom]}>
        <View style={[styles.option, hover === "live" && styles.optionOn]}><Feather name="radio" size={14} color={hover === "live" ? colors.onAccent : colors.text} /><Text style={[styles.optionText, hover === "live" && styles.optionTextOn]}>Live voice</Text></View>
        <View style={styles.gap} />
        <View style={[styles.option, hover === "dictate" && styles.optionOn]}><Feather name="type" size={14} color={hover === "dictate" ? colors.onAccent : colors.text} /><Text style={[styles.optionText, hover === "dictate" && styles.optionTextOn]}>Dictate</Text></View>
      </Animated.View>
    </View>
  </GestureDetector>;
});

const styles = StyleSheet.create({
  hit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 9, right: 9, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.gold },
  picker: { position: "absolute", top: -60, width: 116, height: 164, justifyContent: "space-between" },
  labelsLeft: { right: 0 },
  labelsRight: { left: 0 },
  gap: { height: 44 },
  option: { flexDirection: "row", alignItems: "center", gap: 6, height: 44, paddingHorizontal: 12, borderRadius: 22, backgroundColor: glass.fillChipOn, borderWidth: 1, borderColor: glass.hair },
  optionOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  optionText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
  optionTextOn: { color: colors.onAccent },
});
