import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { haptic } from "../haptics";
import { railTarget, type PromptAnchor } from "../lib/prompt-navigation";
import { colors, type } from "../theme";

export function PromptRail({ anchors, following, live, onJump, onLatest }: {
  anchors: readonly PromptAnchor[]; following: boolean; live: boolean;
  onJump(prompt: number): void; onLatest(): void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const height = useRef(240);
  const last = useRef(-1);
  const props = useRef({ anchors, onJump, onLatest });
  props.current = { anchors, onJump, onLatest };
  const pan = useMemo(() => {
    const choose = (y: number) => {
      const current = props.current;
      const index = railTarget(y, height.current, current.anchors.length);
      setSelected(index);
      if (last.current === index) return;
      last.current = index;
      haptic.select();
      if (index === current.anchors.length) current.onLatest();
      else current.onJump(index);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: event => choose(event.nativeEvent.locationY),
      onPanResponderMove: event => choose(event.nativeEvent.locationY),
      onPanResponderRelease: () => { setSelected(null); last.current = -1; },
      onPanResponderTerminate: () => { setSelected(null); last.current = -1; },
    });
  }, []);
  if (!anchors.length) return null;
  return <View style={styles.rail} pointerEvents="box-none">
    {selected !== null ? <View pointerEvents="none" style={styles.preview}>
      <Text style={styles.previewLabel}>{selected === anchors.length ? "Latest reply" : `Prompt ${selected + 1} of ${anchors.length}`}</Text>
      <Text style={styles.previewText} numberOfLines={3}>{anchors[selected]?.text ?? "Follow new output"}</Text>
    </View> : null}
    <View {...pan.panHandlers} onLayout={e => { height.current = e.nativeEvent.layout.height; }}
      accessibilityRole="adjustable" accessibilityLabel="Prompt navigator"
      accessibilityHint="Swipe up or down to select a prompt. Latest resumes following."
      accessibilityValue={{ min: 1, max: anchors.length, now: (selected ?? 0) + 1 }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={e => {
        const next = Math.max(0, Math.min(anchors.length - 1, (selected ?? 0) + (e.nativeEvent.actionName === "increment" ? 1 : -1)));
        setSelected(next); onJump(next); haptic.select();
      }} style={styles.ticks}>
      {anchors.map((anchor, i) => <View key={anchor.id} style={styles.slot}><View style={[styles.tick, selected === i && styles.selected]} /></View>)}
    </View>
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
