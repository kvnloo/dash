import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentOrb } from "../components/AgentOrb";
import { Canvas } from "../components/Canvas";
import { PrimaryButton } from "../components/PrimaryButton";
import { ScreenHeader } from "../components/ScreenHeader";
import { useContinuousVoice } from "../components/ContinuousVoiceRoot";
import { screenBack } from "../lib/screen-back";

import type { ScreenProps } from "../navigation";
import type { OrbState } from "../lib/orb-phase";
import { colors, radius, space, type } from "../theme";


/** Live conversation mode: the hero orb follows a live z0live call, else the chat's live phase. */
export function VoiceScreen(props: ScreenProps<"Voice">): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { state, start, stop, mute } = useContinuousVoice();
  const live = !["idle", "error"].includes(state.phase);
  const opening = state.phase === "connecting";
  const caption = state.note ?? (live ? `${state.phase}${state.muted ? " · muted" : ""}${state.delivery ? ` · ${state.delivery}` : ""}` : "Realtime voice inside Dash");
  const lines = state.lines;
  const orb: OrbState = { phase: state.phase === "hearing" ? "listening" : state.phase === "error" ? "idle" : state.phase };
  const autostart = props.route.params?.autostart === true;
  useEffect(() => { if (autostart && !live) void start(); }, [autostart]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
      <Canvas /><ScreenHeader title={live ? "Live call" : "Voice"} onBack={() => screenBack(props.navigation)} />
      <View style={styles.content}>
        <Text style={styles.title}>Dash voice</Text>
        <AgentOrb size="hero" thinking={orb} label={`Dash voice ${caption}`} />
        <Text accessibilityLiveRegion="polite" style={styles.caption} testID="voice-caption">
          {caption}
        </Text>
        <View style={styles.transcript} testID="voice-transcript">
          {lines.map((line, i) => (
            <Text key={`${i}:${line.role}`} numberOfLines={2} style={[styles.line, line.role === "user" ? styles.user : styles.assistant, i < lines.length - 1 && styles.older]}>
              <Text style={styles.who}>{line.role === "user" ? "you  " : "agent  "}</Text>{line.text}
            </Text>
          ))}
        </View>

      </View>
      <View style={styles.controls}>
        <PrimaryButton accessibilityLabel={live ? "Stop voice in Dash" : "Start voice in Dash"} onPress={() => void (live ? stop() : start())} label={opening ? "Cancel connection" : live ? "Stop voice" : "Start voice"} />
        {live ? (
          <>
            <Pressable accessibilityRole="button" onPress={() => screenBack(props.navigation)} style={styles.secondary}>
              <Text style={styles.secondaryText}>Back to chat · call keeps going</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={mute} style={styles.secondary}><Text style={styles.secondaryText}>{state.muted ? "Unmute" : "Mute"}</Text></Pressable>
            <Text style={styles.note}>Call stays active across Dash screens. Leaving Dash stops the mic; background capture is not enabled.</Text>
          </>
        ) : (
          <>
            <Text style={styles.note}>Requires the native Dash APK and explicit voice authorization. Expo Go/web voice is unavailable; no other app is opened.</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: space.xl, gap: space.md },
  title: { ...type.title, color: colors.text },
  caption: { ...type.body, color: colors.textMuted, textAlign: "center", minHeight: 22 },
  transcript: { alignSelf: "stretch", gap: space.sm, minHeight: 96, justifyContent: "flex-end", paddingHorizontal: space.sm, borderRadius: radius.md },
  line: { ...type.body },
  user: { color: colors.text, textAlign: "right" },
  assistant: { color: colors.text, textAlign: "left" },
  older: { opacity: 0.55 },
  who: { ...type.small, color: colors.textFaint },
  message: { ...type.body, color: colors.text, textAlign: "center" },
  error: { color: colors.danger },
  controls: { paddingHorizontal: space.xl, alignItems: "stretch", gap: space.xs },
  secondary: { minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: space.lg },
  secondaryText: { ...type.body, color: colors.textMuted },
  note: { ...type.small, color: colors.textFaint, textAlign: "center" },
});
