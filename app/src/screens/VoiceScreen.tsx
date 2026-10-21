import { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas } from "../components/Canvas";
import { ScreenHeader } from "../components/ScreenHeader";
import { VoiceOrb } from "../components/VoiceOrb";
import { presetForHarness, type OrbPreset } from "../components/orb-html";
import { store } from "../store/app";
import { PrimaryButton } from "../components/PrimaryButton";
import { launchSharedVoice, type VoiceLaunchResult } from "../lib/voice-launch";
import type { ScreenProps } from "../navigation";
import { colors, radius, space, type } from "../theme";
import { LegacyVoiceScreen } from "./LegacyVoiceScreen";
import { screenBack } from "../lib/screen-back";

type VoiceView =
  | { kind: "shared"; result?: VoiceLaunchResult }
  | { kind: "opening" }
  | { kind: "legacy" };

export function VoiceScreen(props: ScreenProps<"Voice">): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const harness = store.use(s => s.conversations.find(c => c.id === s.activeId)?.harness ?? s.settings?.harness ?? "hermes");
  const harnessName = store.use(s => s.connection.harnesses.find(h => h.id === harness)?.name ?? harness);
  const [preset, setPreset] = useState<OrbPreset | null>(null);
  const [view, setView] = useState<VoiceView>({ kind: "shared" });

  const openVoice = async (): Promise<void> => {
    if (view.kind === "opening") return;
    setView({ kind: "opening" });
    const result = await launchSharedVoice(Platform.OS, Linking);
    setView({ kind: "shared", result });
  };

  if (view.kind === "legacy") {
    return <LegacyVoiceScreen {...props} onExit={() => setView({ kind: "shared" })} />;
  }

  const result = view.kind === "shared" ? view.result : undefined;
  const unavailable = result?.kind === "unavailable";
  const message = unavailable
    ? result.message
    : result?.kind === "opened"
      ? "z0live controls opened. Tap Start there when you are ready."
      : "Open the shared z0live controls, then tap Start there when you are ready.";

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.xl }]}>
      <Canvas /><ScreenHeader title="Voice" onBack={() => screenBack(props.navigation)} />
      <View style={styles.content}>
        <Text style={styles.title}>{harnessName}</Text>
        <VoiceOrb preset={preset ?? presetForHarness(harness)} phase="idle" size={190} />
        <Text style={styles.caption}>Say something…</Text>
        <Text style={styles.note}>Microphone off · Start in z0live</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 4 }}>{(["chatgpt", "gemini", "siri", "alexa", "elevenlabs"] satisfies OrbPreset[]).map((id, i) => <Pressable key={id} accessibilityRole="radio" accessibilityLabel={`Voice appearance: ${id}`} accessibilityState={{ checked: (preset ?? presetForHarness(harness)) === id }} aria-checked={(preset ?? presetForHarness(harness)) === id} onPress={() => setPreset(id)} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ ...type.small, color: (preset ?? presetForHarness(harness)) === id ? colors.gold : colors.textTertiary }}>{["Atmosphere", "Spectrum", "Perimeter", "Light ring", "ElevenLabs"][i]}</Text></Pressable>)}</View>
        <Text accessibilityLiveRegion="polite" style={[styles.message, unavailable && styles.error]}>
          {message}
        </Text>
        <View style={styles.action}><PrimaryButton accessibilityLabel="Open z0live voice" disabled={view.kind === "opening"} onPress={() => void openVoice()} label={view.kind === "opening" ? "Opening…" : "Open z0live"} /></View>
        <Pressable
          accessibilityRole="button"
          disabled={view.kind === "opening"}
          onPress={() => setView({ kind: "legacy" })}
          style={styles.legacy}
        >
          <Text style={styles.caption}>Use legacy voice</Text>
        </Pressable>
        <Text style={styles.note}>Legacy voice uses the Dash microphone and your paired bridge.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: space.xl, gap: space.md },
  title: { ...type.title, color: colors.text },
  caption: { ...type.body, color: colors.textMuted, textAlign: "center" },
  message: { ...type.body, color: colors.text, textAlign: "center" },
  error: { color: colors.danger },
  action: { alignSelf: "stretch" },
  actionContent: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  actionText: { ...type.heading, color: colors.text },
  pressed: { transform: [{ scale: 0.985 }] },
  legacy: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.lg },
  note: { ...type.small, color: colors.textFaint, textAlign: "center" },
});
