import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptic } from "../haptics";
import { railTarget, type PromptAnchor } from "../lib/prompt-navigation";
import { colors, type } from "../theme";

export function PromptRail({ anchors, following, live, onJump, onLatest }: {
  anchors: readonly PromptAnchor[]; following: boolean; live: boolean;
  onJump(prompt: number): void; onLatest(): void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const height = useSharedValue(240);
  const last = useSharedValue(-1);
  const count = useSharedValue(anchors.length);
  useEffect(() => { count.set(anchors.length); }, [anchors.length, count]);
  const actions = useRef({ count: anchors.length, onJump, onLatest });
  actions.current = { count: anchors.length, onJump, onLatest };
  const choose = useCallback((index: number) => {
    setSelected(index);
    haptic.select();
    const current = actions.current;
    if (index >= current.count) current.onLatest(); else current.onJump(index);
  }, []);
  const clear = useCallback(() => setSelected(null), []);
  const pan = useMemo(() => {
    const update = (y: number) => {
      "worklet";
      const size = height.get();
      const index = railTarget(y, size, count.get());
      if (index === last.get()) return;
      last.set(index);
      // Only cross runtimes when a prompt boundary changes, never every frame.
      scheduleOnRN(choose, index);
    };
    return Gesture.Pan().minDistance(0)
      .onBegin(event => { update(event.y); })
      .onUpdate(event => { update(event.y); })
      .onFinalize(() => { last.set(-1); scheduleOnRN(clear); });
  }, [choose, clear, count, height, last]);
  if (!anchors.length) return null;
  return <View style={styles.rail} pointerEvents="box-none">
    {selected !== null ? <View pointerEvents="none" style={styles.preview}>
      <Text style={styles.previewLabel}>{selected === anchors.length ? "Latest reply" : `Prompt ${selected + 1} of ${anchors.length}`}</Text>
      <Text style={styles.previewText} numberOfLines={3}>{anchors[selected]?.text ?? "Follow new output"}</Text>
    </View> : null}
    <GestureDetector gesture={pan}>
      <View onLayout={e => { height.set(e.nativeEvent.layout.height); }}
        accessibilityRole="adjustable" accessibilityLabel="Prompt navigator"
        accessibilityHint="Swipe up or down to select a prompt. Latest resumes following."
        accessibilityValue={{ min: 1, max: anchors.length + 1, now: (selected ?? 0) + 1 }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={e => {
          const next = Math.max(0, Math.min(anchors.length, (selected ?? 0) + (e.nativeEvent.actionName === "increment" ? 1 : -1)));
          choose(next);
        }} style={styles.ticks}>
        {anchors.map((anchor, i) => <View key={anchor.id} style={styles.slot}><View style={[styles.tick, selected === i && styles.selected]} /></View>)}
      </View>
    </GestureDetector>
    <Pressable accessibilityRole="button" accessibilityLabel={live ? "Latest live reply" : "Latest reply"}
      onPress={onLatest} style={styles.latest}>
      <Text style={[styles.arrow, following && styles.following]}>↓</Text>
      <Text style={styles.latestLabel}>{live ? "Live" : "Latest"}</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  rail: { position: "absolute", right: 0, top: "18%", bottom: "12%", width: 44, alignItems: "center" },
  ticks: { flex: 1, width: 44, paddingVertical: 8, justifyContent: "space-around" },
  slot: { flex: 1, justifyContent: "center", alignItems: "center" },
  tick: { width: 9, height: 2, backgroundColor: colors.textTertiary, borderRadius: 1 },
  selected: { width: 18, backgroundColor: colors.gold },
  latest: { minHeight: 44, width: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderRadius: 10 },
  arrow: { color: colors.text, fontSize: 22, lineHeight: 24 },
  following: { color: colors.gold },
  latestLabel: { color: colors.textMuted, fontSize: 9, lineHeight: 12 },
  preview: { position: "absolute", right: 48, top: "35%", width: 238, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.hair, backgroundColor: colors.surfaceRaised },
  previewLabel: { ...type.small, color: colors.textMuted, marginBottom: 4 },
  previewText: { ...type.body, color: colors.text },
});
