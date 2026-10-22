import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentOrb } from "../components/AgentOrb";
import { Canvas } from "../components/Canvas";
import { PrimaryButton } from "../components/PrimaryButton";
import { ScreenHeader } from "../components/ScreenHeader";
import { debugUi } from "../debug/ui-store";
import { useLiveThinking } from "../lib/live-thinking";
import { mergeVoicePhase, orbCaption, transcriptTail } from "../lib/orb-phase";
import { screenBack } from "../lib/screen-back";
import { launchSharedVoice, type VoiceLaunchResult } from "../lib/voice-launch";
import { useZ0LiveState } from "../lib/z0live-state";
import type { Message } from "../model";
import type { ScreenProps } from "../navigation";
import { store } from "../store/app";
import { colors, radius, space, type } from "../theme";
import { LegacyVoiceScreen } from "./LegacyVoiceScreen";

type VoiceView =
  | { kind: "shared"; result?: VoiceLaunchResult }
  | { kind: "opening" }
  | { kind: "legacy" };

const EMPTY: Message[] = [];

/** Live conversation mode: the hero orb follows a live z0live call, else the chat's live phase. */
export function VoiceScreen(props: ScreenProps<"Voice">): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const conversation = store.use(s => s.conversations.find(c => c.id === s.activeId));
  const settings = store.use(s => s.settings);
  const harness = conversation?.harness ?? settings?.harness ?? "hermes";
  const harnessName = store.use(s => s.connection.harnesses.find(h => h.id === harness)?.name ?? harness);
  const [view, setView] = useState<VoiceView>({ kind: "shared" });
  const chat = useLiveThinking(conversation);
  const fixture = debugUi.use(s => s.z0liveFixture ?? null);
  const polled = useZ0LiveState(settings, chat.online && fixture === null && view.kind !== "legacy");
  const call = fixture ?? polled;
  const live = call?.live === true;
  const orb = mergeVoicePhase(call, chat.thinking);
  const caption = live ? orbCaption(orb, "listening") : chat.caption;
  const lines = transcriptTail(call, conversation?.messages ?? EMPTY);

  const openVoice = async (): Promise<void> => {
    if (view.kind === "opening") return;
    setView({ kind: "opening" });
    const result = await launchSharedVoice(Platform.OS, Linking);
    setView({ kind: "shared", result });
  };

  // Chosen from the composer: report in-app availability without an external handoff.
  const autostart = props.route.params?.autostart === true;
  useEffect(() => { if (autostart && !live) void openVoice(); }, [autostart]); // eslint-disable-line react-hooks/exhaustive-deps

  if (view.kind === "legacy") {
    return <LegacyVoiceScreen {...props} onExit={() => setView({ kind: "shared" })} />;
  }

  const result = view.kind === "shared" ? view.result : undefined;
  const opening = view.kind === "opening";
  const launcherLabel = "In-app voice availability";

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
      <Canvas /><ScreenHeader title={live ? "Live call" : "Voice"} onBack={() => screenBack(props.navigation)} />
      <View style={styles.content}>
        <Text style={styles.title}>{live ? "z0live" : harnessName}</Text>
        <AgentOrb size="hero" thinking={orb} label={`${live ? "z0live call" : harnessName} ${caption}`} />
        <Text accessibilityLiveRegion="polite" style={styles.caption} testID="voice-caption">
          {caption}{live && call.muted ? " · muted" : ""}
        </Text>
        <View style={styles.transcript} testID="voice-transcript">
          {lines.map((line, i) => (
            <Text key={`${i}:${line.role}`} numberOfLines={2} style={[styles.line, line.role === "user" ? styles.user : styles.assistant, i < lines.length - 1 && styles.older]}>
              <Text style={styles.who}>{line.role === "user" ? "you  " : "agent  "}</Text>{line.text}
            </Text>
          ))}
        </View>
        {result?.kind === "unavailable" ? <Text accessibilityLiveRegion="polite" style={[styles.message, styles.error]}>{result.message}</Text> : null}
      </View>
      <View style={styles.controls}>
        <PrimaryButton accessibilityLabel="Check in-app voice availability" disabled={opening} onPress={() => void openVoice()} label={launcherLabel} />
        {live ? (
          <>
            <Pressable accessibilityRole="button" onPress={() => screenBack(props.navigation)} style={styles.secondary}>
              <Text style={styles.secondaryText}>Back to chat · call keeps going</Text>
            </Pressable>
            <Text style={styles.note}>Mute and end stay in z0live: the broker has no control API Dash can call for the phone's call.</Text>
          </>
        ) : (
          <>
            <Pressable accessibilityRole="button" disabled={opening} onPress={() => setView({ kind: "legacy" })} style={styles.secondary}>
              <Text style={styles.secondaryText}>Use legacy turn-based voice</Text>
            </Pressable>
            <Text style={styles.note}>{chat.online ? "No in-app media client. Dictate remains available in the composer." : "Offline: pair the bridge to follow a live call."}</Text>
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
