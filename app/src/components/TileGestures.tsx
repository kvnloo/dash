import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { haptic } from "../haptics";
import { useHandedness } from "../lib/useHandedness";
import { radialCenter, radialPosition, radialSector } from "../lib/tile-layout";
import { SNAP } from "../motion";
import { colors, fonts } from "../theme";

export type TileAction = { id: string; label: string; run(): void };
type WheelState = { x: SharedValue<number>; y: SharedValue<number>; selected: SharedValue<number>; bloom: SharedValue<number>; show(actions: TileAction[]): void; hide(): void };
const Wheel = createContext<WheelState | null>(null);

/** Root overlay, not a Modal: the original pointer stream stays on the tile throughout the hold. */
export function TileGestureProvider({ children }: { children: ReactNode }) {
  const x = useSharedValue(0), y = useSharedValue(0), selected = useSharedValue(-1), bloom = useSharedValue(0);
  const [actions, setActions] = useState<TileAction[]>([]);
  const thumb = useHandedness();
  useAnimatedReaction(() => selected.value, (next, prev) => { if (next >= 0 && next !== prev && bloom.value > 0) runOnJS(haptic.select)(); });
  const value = useMemo(() => ({ x, y, selected, bloom, show: setActions, hide: () => setActions([]) }), [x, y, selected, bloom]);
  const style = useAnimatedStyle(() => ({ opacity: bloom.value, transform: [{ translateX: x.value - 140 }, { translateY: y.value - 140 }, { scale: 0.6 + bloom.value * 0.4 }] }));
  return <Wheel.Provider value={value}><View style={styles.root}>{children}
    {actions.length ? <Animated.View pointerEvents="none" style={[styles.wheel, style]} testID="radial-wheel">
      <View style={styles.center}><Text style={styles.cancel}>Cancel</Text></View>
      {actions.map((action, index) => <WheelLabel key={action.id} action={action} index={index} count={actions.length} left={thumb.isLeft} selected={selected} />)}
    </Animated.View> : null}
  </View></Wheel.Provider>;
}

function WheelLabel({ action, index, count, left, selected }: { action: TileAction; index: number; count: number; left: boolean; selected: SharedValue<number> }) {
  const pos = radialPosition(index, count, left, 106);
  const style = useAnimatedStyle(() => ({ backgroundColor: selected.value === index ? colors.accent : colors.surfaceRaised, transform: [{ scale: withTiming(selected.value === index ? 1.1 : 1, SNAP) }] }));
  const text = useAnimatedStyle(() => ({ color: selected.value === index ? colors.bg : colors.text }));
  return <Animated.View style={[styles.action, { left: 140 + pos.x - 36, top: 140 + pos.y - 24 }, style]} testID={`radial-${action.id}`}><Animated.Text style={[styles.label, text]}>{action.label}</Animated.Text></Animated.View>;
}

type TileOptions = { onOpen(): void; onPrimary(): void; onSecondary(): void; actions: TileAction[] };

/** Triple/double/single arbitration has a 180 ms inter-tap window; movement fails taps, freeing scroll. */
export function useTileGestures({ onOpen, onPrimary, onSecondary, actions }: TileOptions) {
  const wheel = useContext(Wheel);
  if (!wheel) throw new Error("useTileGestures requires TileGestureProvider");
  const { width, height } = useWindowDimensions();
  const thumb = useHandedness();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1), tilt = useSharedValue(0), start = useSharedValue({ x: 0, y: 0 });
  const { x, y, selected, bloom, show, hide } = wheel;
  const actionCount = actions.length;
  const valid = actionCount >= 4 && actionCount <= 8;
  const showActions = () => show(actions);
  const commit = (index: number) => { hide(); if (index >= 0 && actions[index]) { haptic.success(); actions[index].run(); } };
  const armed = useSharedValue(false);
  useEffect(() => () => { if (armed.value) { bloom.value = 0; hide(); } }, [armed, bloom, hide]);
  const press = () => { "worklet"; scale.value = reduced ? 1 : withTiming(0.975, SNAP); };
  const release = () => { "worklet"; scale.value = reduced ? 1 : withTiming(1, SNAP); tilt.value = withTiming(0, { duration: reduced ? 0 : 120 }); };
  const tap = (count: number, action: () => void) => Gesture.Tap().numberOfTaps(count).maxDelay(180).maxDuration(220).maxDistance(10)
    .onBegin(press).onEnd((_event, success) => { if (success) runOnJS(action)(); }).onFinalize(release);
  const hold = Gesture.Pan().minPointers(1).maxPointers(1).activateAfterLongPress(350).enabled(valid)
    .onBegin(press)
    .onStart(event => {
      const center = radialCenter(event.absoluteX, event.absoluteY, width, height);
      armed.value = true;
      start.value = { x: event.absoluteX, y: event.absoluteY };
      x.value = center.x; y.value = center.y; selected.value = -1;
      bloom.value = reduced ? 1 : withTiming(1, SNAP);
      runOnJS(showActions)();
    })
    .onUpdate(event => {
      const moved = Math.hypot(event.absoluteX - start.value.x, event.absoluteY - start.value.y) > 20;
      selected.value = moved ? radialSector(event.absoluteX - x.value, event.absoluteY - y.value, actionCount, thumb.isLeft) : -1;
      tilt.value = reduced ? 0 : Math.max(-3, Math.min(3, (event.absoluteX - x.value) / 28));
    })
    .onEnd((_event, success) => { if (success) runOnJS(commit)(selected.value); })
    .onFinalize(() => { release(); if (armed.value) { armed.value = false; selected.value = -1; bloom.value = 0; runOnJS(hide)(); } });
  const gesture = Gesture.Race(hold, Gesture.Exclusive(tap(3, onSecondary), tap(2, onPrimary), tap(1, onOpen)));
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }, { rotate: `${tilt.value}deg` }], shadowOpacity: (1 - scale.value) * 8, shadowRadius: 12 }));
  return { gesture, animatedStyle, holding: armed };
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  wheel: { position: "absolute", left: 0, top: 0, width: 280, height: 280, borderRadius: 140, backgroundColor: "rgba(12,12,10,.96)", borderWidth: 1, borderColor: colors.border, zIndex: 10000, elevation: 30 },
  center: { position: "absolute", left: 104, top: 104, width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: colors.border, justifyContent: "center" },
  cancel: { color: colors.textMuted, textAlign: "center", fontFamily: fonts.mono, fontSize: 9 },
  action: { position: "absolute", width: 72, minHeight: 48, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", padding: 4 },
  label: { textAlign: "center", fontFamily: fonts.mono, fontSize: 10 },
});
