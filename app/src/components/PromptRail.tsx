import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptic } from "../haptics";
import { railTarget } from "../lib/prompt-navigation";
import { railColors, railWidth, type RailTurn } from "../lib/rail-turns";
import { colors, type } from "../theme";

export function PromptRail({ anchors, following, live, onJump, onLatest, onContinue }: {
  anchors: readonly RailTurn[]; following: boolean; live: boolean;
  onJump(prompt: number): void; onLatest(): void; onContinue(prompt: number): void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [copyState, setCopyState] = useState("");
  const [confirmContinue, setConfirmContinue] = useState(false);
  const height = useSharedValue(240);
  const last = useSharedValue(-1);
  const count = useSharedValue(anchors.length);
  useEffect(() => { count.set(anchors.length); setSelected(null); }, [anchors, count]);
  const actions = useRef({ anchors, onJump, onLatest });
  actions.current = { anchors, onJump, onLatest };
  const choose = useCallback((index: number) => {
    setSelected(index); setCopyState(""); setConfirmContinue(false);
    const state = actions.current.anchors[index]?.state;
    if (state === "error" || state === "needs-you") haptic.tap(); else haptic.select();
  }, []);
  const commit = useCallback((index: number) => {
    setSelected(index);
    const current = actions.current;
    if (index >= current.anchors.length) current.onLatest(); else current.onJump(index);
  }, []);
  const clear = useCallback(() => setSelected(null), []);
  const cursor = useAnimatedStyle(() => ({
    opacity: last.get() < 0 ? 0 : 1,
    transform: [{ translateY: Math.min(height.get() - 2, Math.max(0, (last.get() + 0.5) / Math.max(1, count.get()) * height.get())) }],
  }));
  const pan = useMemo(() => {
    const update = (y: number) => {
      "worklet";
      const index = railTarget(y, height.get(), count.get());
      if (index === last.get()) return;
      last.set(index);
      // Only preview on boundary changes. FlashList commits once, on release.
      scheduleOnRN(choose, index);
    };
    return Gesture.Pan().minDistance(0)
      .onBegin(event => { update(event.y); })
      .onUpdate(event => { update(event.y); })
      .onEnd(event => { scheduleOnRN(commit, railTarget(event.y, height.get(), count.get())); })
      .onFinalize((_event, success) => { last.set(-1); if (!success) scheduleOnRN(clear); });
  }, [choose, clear, commit, count, height, last]);
  const turn = selected === null ? undefined : anchors[selected];
  if (!anchors.length) return null;
  return <View style={styles.rail} pointerEvents="box-none">
    {selected !== null ? <View style={styles.preview} accessibilityLabel="Turn preview">
      <View style={styles.heading}>
        <Text style={styles.previewLabel}>{turn ? `Prompt ${selected + 1}/${anchors.length} · ${turn.state}${turn.question ? " · question" : ""}` : "Latest reply"}</Text>
        <Pressable accessibilityLabel="Close turn preview" accessibilityRole="button" onPress={clear} style={styles.close}><Text style={styles.previewLabel}>×</Text></Pressable>
      </View>
      <Text style={styles.previewText} numberOfLines={2}>{turn?.text.split("\n")[0] ?? "Follow new output"}</Text>
      {turn ? <>
        <Text style={styles.resultLabel}>RESULT · answer excerpt</Text>
        <Text style={styles.previewText} numberOfLines={3}>{turn.summary}</Text>
        <Text style={styles.facts}>{turn.characters.toLocaleString()} chars · {turn.activityUpdates} activity updates{turn.code ? " · diff" : ""}{turn.files.length ? ` · ${turn.files.length} file refs` : ""}</Text>
        <Text style={styles.facts}>Width = answer volume · colour = state · ◆ = diff/PR</Text>
        {confirmContinue ? <Text style={styles.facts}>Replace the composer draft with this reference? Nothing is sent; this does not rewind the session.</Text> : null}
        <View style={styles.buttons}>
          <Action label="Jump" onPress={() => commit(selected)} />
          <Action label={copyState || "Copy"} onPress={() => { void Clipboard.setStringAsync(`${turn.text}\n\n${turn.summary}`).then(() => setCopyState("Copied"), () => setCopyState("Copy failed")); }} />
          <Action label={confirmContinue ? "Replace draft" : "Continue"} onPress={() => { if (!confirmContinue) { setConfirmContinue(true); return; } onContinue(selected); clear(); }} />
          {turn.pr ? <Action label="Open PR" onPress={() => { if (turn.pr) void Linking.openURL(turn.pr).catch(() => setCopyState("Cannot open PR")); }} /> : null}
          {turn.files[0] ? <Action label="Copy file path" onPress={() => { void Clipboard.setStringAsync(turn.files[0] ?? "").then(() => setCopyState("Path copied"), () => setCopyState("Copy failed")); }} /> : null}
        </View>
      </> : <Action label="Jump to latest" onPress={() => { onLatest(); clear(); }} />}
    </View> : null}
    <GestureDetector gesture={pan}>
      <View onLayout={e => { height.set(e.nativeEvent.layout.height); }}
        onPointerMove={e => {
          if (e.nativeEvent.pointerType !== "mouse" || e.nativeEvent.buttons !== 0) return;
          const target = railTarget(e.nativeEvent.offsetY, height.get(), anchors.length);
          if (target !== selected) choose(target);
        }}
        accessibilityRole="adjustable" accessibilityLabel="Prompt navigator"
        accessibilityHint="Width shows answer volume. Colour shows state. Swipe to preview, release to jump. Latest resumes following."
        accessibilityValue={{ min: 1, max: anchors.length + 1, now: (selected ?? 0) + 1 }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={e => {
          const next = Math.max(0, Math.min(anchors.length, (selected ?? 0) + (e.nativeEvent.actionName === "increment" ? 1 : -1)));
          choose(next); commit(next);
        }} style={styles.ticks}>
        <RailTicks anchors={anchors} />
        <Animated.View pointerEvents="none" style={[styles.cursor, cursor]} />
      </View>
    </GestureDetector>
    <Pressable accessibilityRole="button" accessibilityLabel={live ? "Latest live reply" : "Latest reply"}
      onPress={() => { clear(); onLatest(); }} style={styles.latest}>
      <Text style={[styles.arrow, following && styles.following]}>↓</Text>
      <Text style={styles.latestLabel}>{live ? "Live" : "Latest"}</Text>
    </Pressable>
  </View>;
}
function Action({ label, onPress }: { label: string; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.action}><Text style={styles.actionText}>{label}</Text></Pressable>;
}
const RailTicks = memo(function RailTicks({ anchors }: { anchors: readonly RailTurn[] }) {
  return <View pointerEvents="none" style={styles.tickLayer}>{anchors.map(anchor => <View key={anchor.id} style={styles.slot}>
    <View style={[styles.tick, { width: railWidth(anchor.characters), backgroundColor: railColors[anchor.state] }]} />
    {anchor.code || anchor.pr ? <View style={styles.change} /> : null}
    {anchor.question ? <View style={styles.question} /> : null}
  </View>)}</View>;
});
const styles = StyleSheet.create({
  tickLayer: { flex: 1, alignSelf: "stretch" },
  cursor: { position: "absolute", top: 0, right: 6, width: 32, height: 2, backgroundColor: colors.gold },
  rail: { position: "absolute", right: 0, top: "18%", bottom: "12%", width: 44, alignItems: "center" },
  ticks: { flex: 1, width: 44 },
  slot: { flex: 1, justifyContent: "center", alignItems: "flex-end", paddingRight: 6 },
  tick: { height: 1, borderRadius: 1 },
  change: { position: "absolute", right: 1, width: 2, height: 2, backgroundColor: colors.textMuted, transform: [{ rotate: "45deg" }] },
  question: { position: "absolute", left: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: colors.textMuted },
  latest: { minHeight: 44, width: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderRadius: 10 },
  arrow: { color: colors.text, fontSize: 22, lineHeight: 24 },
  following: { color: colors.gold },
  latestLabel: { color: colors.textMuted, fontSize: 9, lineHeight: 12 },
  preview: { position: "absolute", right: 48, top: "10%", width: 276, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.hair, backgroundColor: colors.surfaceRaised },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  previewLabel: { ...type.small, color: colors.textMuted, flexShrink: 1 },
  previewText: { ...type.body, color: colors.text },
  resultLabel: { ...type.small, color: colors.textMuted, marginTop: 8 },
  facts: { ...type.small, color: colors.textMuted, marginTop: 6 },
  buttons: { flexDirection: "row", flexWrap: "wrap", marginTop: 4, gap: 4 },
  action: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: 8, borderRadius: 6, backgroundColor: colors.surface },
  actionText: { ...type.small, color: colors.text },
});
