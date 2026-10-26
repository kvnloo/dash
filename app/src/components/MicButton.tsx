import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type ReactNode, memo, useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { haptic } from "../haptics";
import { MIC_DEFAULT_KEY, type MicChoice, parseMicChoice } from "../lib/mic-gesture";
import { snappy } from "../motion";
import { spatial } from "./motion-enter";
import { colors, glass } from "../theme";

interface Props {
  onDictate(): void;
  onLive(): void;
  /** Kept for API compatibility; the pill always grows straight up from the mic. */
  side: "left" | "right";
  /** Optional glyph override (the live-call orb). */
  children?: ReactNode;
  /** Overrides tap (e.g. reopen the voice screen during a live call). */
  onTap?(): void;
  accessibilityLabel?: string;
}

const HOLD_MS = 220;
const SLOT = 44;
const TRAVEL = SLOT + 4;
const PILL = SLOT + TRAVEL;

/**
 * Composer mic with a Telegram-style mode switch.
 * Tap: use the active mode (Dictate or Live voice).
 * Press and hold: a pill grows up around the mic with the Live voice icon above it. Slide up to move the knob onto
 * Live voice (or down onto Dictate); release and the pill folds back down and that mode becomes the mic's icon.
 * Release only switches the mode; tap to use it.
 */
export const MicButton = memo(function MicButton({ onDictate, onLive, children, onTap, accessibilityLabel }: Props) {
  const [mode, setMode] = useState<MicChoice>("dictate");
  const open = useSharedValue(0);
  /** Knob: 0 = bottom slot (Dictate), 1 = top slot (Live voice). */
  const knob = useSharedValue(0);
  const startKnob = useSharedValue(0);
  const lastSlot = useSharedValue(0);
  const live = useSharedValue(0);

  useEffect(() => { void AsyncStorage.getItem(MIC_DEFAULT_KEY).then(v => setMode(parseMicChoice(v)), () => {}); }, []);
  useEffect(() => { const v = mode === "live" ? 1 : 0; knob.value = v; live.value = withTiming(v, spatial(snappy)); }, [knob, live, mode]);

  const tapNow = useCallback(() => {
    haptic.tap();
    if (__DEV__) console.log("[mic] tap", onTap ? "onTap" : mode);
    if (onTap) onTap();
    else if (mode === "live") onLive();
    else onDictate();
  }, [mode, onDictate, onLive, onTap]);
  const commit = useCallback((slot: number) => {
    const next: MicChoice = slot === 1 ? "live" : "dictate";
    if (next === mode) return;
    haptic.success();
    setMode(next);
    void AsyncStorage.setItem(MIC_DEFAULT_KEY, next).catch(() => {});
  }, [mode]);
  const tick = useCallback(() => haptic.select(), []);
  const opened = useCallback(() => haptic.tap(), []);

  const hold = Gesture.Pan()
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      startKnob.value = knob.value;
      lastSlot.value = Math.round(knob.value);
      open.value = withTiming(1, spatial(snappy));
      runOnJS(opened)();
    })
    .onUpdate(e => {
      const k = Math.min(1, Math.max(0, startKnob.value - e.translationY / TRAVEL));
      knob.value = k;
      const slot = Math.round(k);
      if (slot !== lastSlot.value) { lastSlot.value = slot; runOnJS(tick)(); }
    })
    .onEnd(() => {
      const slot = Math.round(knob.value);
      knob.value = withTiming(slot, spatial(snappy));
      runOnJS(commit)(slot);
    })
    .onFinalize(() => { open.value = withTiming(0, spatial(snappy)); });
  const tap = Gesture.Tap().maxDuration(HOLD_MS).onEnd((_e, ok) => { if (ok) runOnJS(tapNow)(); });
  const gesture = Gesture.Exclusive(hold, tap);

  const pill = useAnimatedStyle(() => ({ height: interpolate(open.value, [0, 1], [SLOT, PILL]), opacity: open.value }));
  const knobStyle = useAnimatedStyle(() => ({ opacity: open.value, transform: [{ translateY: -knob.value * TRAVEL }] }));
  const upper = useAnimatedStyle(() => ({ opacity: open.value, transform: [{ translateY: (1 - open.value) * TRAVEL * 0.5 }] }));
  // Closed, the button shows the active mode. Open, the bottom slot is always Dictate (mic) and the top is Live voice.
  const micIcon = useAnimatedStyle(() => ({ opacity: Math.max(open.value, 1 - live.value) }));
  const liveIcon = useAnimatedStyle(() => ({ opacity: live.value * (1 - open.value), transform: [{ translateY: (1 - live.value) * -10 }] }));

  return <GestureDetector gesture={gesture}>
    <View accessible accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (mode === "live" ? "Live voice" : "Dictate")}
      accessibilityHint="Tap to use. Hold and slide up for Live voice, down for Dictate."
      accessibilityActions={[{ name: "activate" }, { name: "longpress", label: mode === "live" ? "Switch to Dictate" : "Switch to Live voice" }]}
      onAccessibilityAction={e => { if (e.nativeEvent.actionName === "activate") tapNow(); else commit(mode === "live" ? 0 : 1); }}
      style={styles.hit}>
      <Animated.View pointerEvents="none" style={[styles.pill, pill]} />
      <Animated.View pointerEvents="none" style={[styles.knob, knobStyle]} />
      <Animated.View pointerEvents="none" style={[styles.upper, upper]}><Feather name="radio" size={18} color={colors.gold} /></Animated.View>
      {children ?? <>
        <Animated.View pointerEvents="none" style={micIcon}><Feather name="mic" size={18} color={colors.textMuted} /></Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, liveIcon]}><Feather name="radio" size={18} color={colors.gold} /></Animated.View>
      </>}
    </View>
  </GestureDetector>;
});

const styles = StyleSheet.create({
  hit: { width: SLOT, height: SLOT, alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  pill: { position: "absolute", bottom: 0, left: 0, width: SLOT, borderRadius: SLOT / 2, backgroundColor: "rgba(22,22,20,0.97)", borderWidth: 1, borderColor: glass.hair },
  knob: { position: "absolute", bottom: 4, left: 4, width: SLOT - 8, height: SLOT - 8, borderRadius: (SLOT - 8) / 2, backgroundColor: "rgba(236,232,223,0.14)" },
  upper: { position: "absolute", bottom: TRAVEL, left: 0, width: SLOT, height: SLOT, alignItems: "center", justifyContent: "center" },
});
