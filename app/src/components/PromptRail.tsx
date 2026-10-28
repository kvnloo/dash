import { useHandedness } from "../lib/useHandedness";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptic } from "../haptics";
import { railLayout, railTargetAt } from "../lib/prompt-navigation";
import { railBins, railColors, type RailTurn } from "../lib/rail-turns";
import { colors, type } from "../theme";

type RailSelection = { kind: "turn"; id: string } | { kind: "latest" };

export function PromptRail({ anchors, following, live, onJump, onLatest, onContinue }: {
  anchors: readonly RailTurn[]; following: boolean; live: boolean;
  onJump(prompt: number): void; onLatest(): void; onContinue(prompt: number): void;
}) {
  const thumb = useHandedness();
  const [selection, setSelection] = useState<RailSelection | null>(null);
  const selectedIndex = selection?.kind === "turn" ? anchors.findIndex(anchor => anchor.id === selection.id) : -1;
  const selected = selection?.kind === "latest" ? anchors.length : selectedIndex >= 0 ? selectedIndex : null;
  const [copyState, setCopyState] = useState("");
  const [confirmContinue, setConfirmContinue] = useState(false);
  const height = useSharedValue(240);
  const last = useSharedValue(-1);
  const [railHeight, setRailHeight] = useState(240);
  const positions = useMemo(() => railLayout(anchors.map(anchor => anchor.durationMs), railHeight), [anchors, railHeight]);
  const tickPositions = useSharedValue(positions);
  useEffect(() => { tickPositions.set(positions); }, [positions, tickPositions]);
  // Reply completion and history paging replace the anchors array. Keep the preview
  // attached to its prompt identity, not the array instance or its current index.
  useEffect(() => {
    setSelection(current => current?.kind === "turn" && !anchors.some(anchor => anchor.id === current.id) ? null : current);
  }, [anchors]);
  const actions = useRef({ anchors, onJump, onLatest });
  actions.current = { anchors, onJump, onLatest };
  const select = useCallback((index: number) => {
    const anchor = actions.current.anchors[index];
    setSelection(anchor ? { kind: "turn", id: anchor.id } : { kind: "latest" });
  }, []);
  const choose = useCallback((index: number) => {
    select(index); setCopyState(""); setConfirmContinue(false);
    const state = actions.current.anchors[index]?.state;
    if (state === "error" || state === "needs-you") haptic.tap(); else haptic.select();
  }, [select]);
  const commit = useCallback((index: number) => {
    select(index);
    const current = actions.current;
    if (index >= current.anchors.length) current.onLatest(); else current.onJump(index);
  }, [select]);
  const clear = useCallback(() => setSelection(null), []);
  const cursor = useAnimatedStyle(() => ({
    opacity: last.get() < 0 ? 0 : 1,
    transform: [{ translateY: Math.min(height.get() - 2, Math.max(0, tickPositions.get()[last.get()] ?? height.get())) }],
  }));
  const pan = useMemo(() => {
    const update = (y: number) => {
      "worklet";
      const index = railTargetAt(y, tickPositions.get(), height.get());
      if (index === last.get()) return;
      last.set(index);
      // Only preview on boundary changes. FlashList commits once, on release.
      scheduleOnRN(choose, index);
    };
    return Gesture.Pan().minDistance(0)
      .onBegin(event => { update(event.y); })
      .onUpdate(event => { update(event.y); })
      .onEnd(event => { scheduleOnRN(commit, railTargetAt(event.y, tickPositions.get(), height.get())); })
      .onFinalize((_event, success) => { last.set(-1); if (!success) scheduleOnRN(clear); });
  }, [choose, clear, commit, tickPositions, height, last]);
  const turn = selected === null ? undefined : anchors[selected];
  if (!anchors.length) return null;
  return <View style={[styles.rail, thumb.edge(0)]} pointerEvents="box-none">
    {selected !== null ? <View style={[styles.preview, thumb.edge(48)]} accessibilityLabel="Turn preview">
      <View style={styles.heading}>
        <Text style={styles.previewLabel}>{turn ? `Prompt ${selected + 1}/${anchors.length} · ${turn.state}${turn.question ? " · question" : ""}` : "Latest reply"}</Text>
        <Pressable accessibilityLabel="Close turn preview" accessibilityRole="button" onPress={clear} style={styles.close}><Text style={styles.previewLabel}>×</Text></Pressable>
      </View>
      <Text style={styles.previewText} numberOfLines={2}>{turn?.text.split("\n")[0] ?? "Follow new output"}</Text>
      {turn ? <>
        <Text style={styles.resultLabel}>RESULT · answer excerpt</Text>
        <Text style={styles.previewText} numberOfLines={3}>{turn.summary}</Text>
        <Text style={styles.facts}>ran {Math.max(1, Math.round(turn.durationMs / 60000))} min · {turn.characters.toLocaleString()} chars · {turn.activityUpdates} activity updates{turn.code ? " · diff" : ""}{turn.files.length ? ` · ${turn.files.length} file refs` : ""}</Text>
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
      <View onLayout={e => { height.set(e.nativeEvent.layout.height); setRailHeight(e.nativeEvent.layout.height); }}
        onPointerMove={e => {
          if (e.nativeEvent.pointerType !== "mouse" || e.nativeEvent.buttons !== 0) return;
          const target = railTargetAt(e.nativeEvent.offsetY, positions, railHeight);
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
        <RailTicks anchors={anchors} positions={positions} />
        <Animated.View pointerEvents="none" style={[styles.cursor, thumb.edge(6), cursor]} />
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
const RailTicks = memo(function RailTicks({ anchors, positions }: { anchors: readonly RailTurn[]; positions: readonly number[] }) {
  const bins = useMemo(() => railBins(anchors, positions), [anchors, positions]);
  return <View pointerEvents="none" style={styles.tickLayer}>{bins.map(bin => <View key={bin.key} style={[styles.slot, { top: bin.top }]}>
    <View testID="rail-tick" style={[styles.tick, { width: bin.width, backgroundColor: railColors[bin.state] }]} />
    {bin.change ? <View style={styles.change} /> : null}
    {bin.question ? <View style={styles.question} /> : null}
  </View>)}</View>;
});
const styles = StyleSheet.create({
  tickLayer: { flex: 1, alignSelf: "stretch" },
  cursor: { position: "absolute", top: 0, width: 32, height: 2, backgroundColor: colors.gold },
  rail: { position: "absolute", top: "18%", bottom: "12%", width: 44, alignItems: "center" },
  ticks: { flex: 1, width: 44 },
  slot: { position: "absolute", left: 0, right: 0, height: 2, marginTop: -1, justifyContent: "center", alignItems: "flex-end", paddingRight: 6 },
  tick: { height: 1, borderRadius: 1 },
  change: { position: "absolute", right: 1, width: 2, height: 2, backgroundColor: colors.textMuted, transform: [{ rotate: "45deg" }] },
  question: { position: "absolute", left: 1, width: 2, height: 2, borderRadius: 1, backgroundColor: colors.textMuted },
  latest: { minHeight: 44, width: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderRadius: 10 },
  arrow: { color: colors.text, fontSize: 22, lineHeight: 24 },
  following: { color: colors.gold },
  latestLabel: { color: colors.textMuted, fontSize: 9, lineHeight: 12 },
  preview: { position: "absolute", top: "10%", width: 276, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.hair, backgroundColor: colors.surfaceRaised },
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
