// One app-wide dotted hero: pointer events pass through everywhere except the orb itself.
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { debugNavigationRef } from "../debug/nav";
import type { VoiceState } from "../lib/continuous-voice";
import { voiceOrbPhase } from "../lib/voice-orb";
import { annotate } from "../store/annotate";
import { createStore } from "../store/createStore";
import { colors, glass, radius, type } from "../theme";
import { AgentOrb } from "./AgentOrb";

/** A composer tap during an existing call brings attention to the already-live orb. */
const attention = createStore(0);
export function focusVoiceOrbOverlay(): void { attention.set(value => value + 1); }

const captions = {
  connecting: "Connecting", listening: "Listening", hearing: "Hearing",
  thinking: "Thinking", speaking: "Speaking",
};

export function VoiceOrbOverlay({ state, onMute }: { state: VoiceState; onMute(): void }) {
  const annotating = annotate.use(s => s.active);
  const [voiceScreen, setVoiceScreen] = useState(() => debugNavigationRef.getCurrentRoute()?.name === "Voice");
  const requested = attention.use(value => value);
  const [highlight, setHighlight] = useState(false);
  const live = state.phase !== "idle" && state.phase !== "error";
  const visible = live && !annotating && !voiceScreen;
  useEffect(() => {
    const sync = () => setVoiceScreen(debugNavigationRef.getCurrentRoute()?.name === "Voice");
    const unsubscribe = debugNavigationRef.addListener("state", sync);
    sync();
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!requested || !visible) return;
    setHighlight(true);
    if (Platform.OS !== "web") AccessibilityInfo.announceForAccessibility("Live voice orb. Tap to mute or unmute.");
    const timeout = setTimeout(() => setHighlight(false), 1200);
    return () => clearTimeout(timeout);
  }, [requested, visible]);

  if (state.phase === "idle" || state.phase === "error" || !visible) return null;
  const phase = state.phase === "connecting" ? "connecting" : voiceOrbPhase(state.phase, true);
  const caption = captions[state.phase];
  return <View pointerEvents="box-none" style={styles.layer}>
    <Pressable
      testID="voice-orb-overlay"
      accessibilityRole="button"
      accessibilityLabel={`${state.muted ? "Unmute" : "Mute"} voice · ${caption}`}
      accessibilityHint="Tap the large orb to toggle the live microphone."
      accessibilityState={{ selected: state.muted }}
      onPress={onMute}
      style={[styles.hit, highlight && styles.focused]}
    >
      <AgentOrb size="hero" thinking={{ phase }} label={`Dash voice ${caption}`} />
      <Text testID="voice-orb-caption" accessibilityLiveRegion="polite" style={styles.caption}>
        {caption}{state.muted ? " · Muted" : ""}
      </Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 950 },
  hit: {
    width: 256, minHeight: 270, justifyContent: "center", alignItems: "center", gap: 8,
    borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.hair2, backgroundColor: "rgba(0,0,0,0.90)",
  },
  focused: { borderColor: colors.text, borderWidth: 2 },
  caption: { ...type.body, color: colors.text, textAlign: "center" },
});
