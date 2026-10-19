import { useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppNav } from "../components/AppNav";
import { GlassSurface } from "../components/GlassSurface";
import { launchSharedVoice, type VoiceLaunchResult } from "../lib/voice-launch";
import type { ScreenProps } from "../navigation";
import { colors, radius, space, type } from "../theme";
import { LegacyVoiceScreen } from "./LegacyVoiceScreen";

type VoiceView =
  | { kind: "shared"; result?: VoiceLaunchResult }
  | { kind: "opening" }
  | { kind: "legacy" };

export function VoiceScreen(props: ScreenProps<"Voice">): React.JSX.Element {
  const insets = useSafeAreaInsets();
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
      <AppNav navigation={props.navigation} tab={1} />
      <View style={styles.content}>
        <Text style={styles.title}>Voice</Text>
        <Text style={styles.caption}>Talk with z0live</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.message, unavailable && styles.error]}>
          {message}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open z0live voice"
          disabled={view.kind === "opening"}
          onPress={() => void openVoice()}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <GlassSurface variant="raised" borderRadius={radius.pill} contentStyle={styles.actionContent}>
            <Text style={styles.actionText}>{view.kind === "opening" ? "Opening…" : "Open z0live"}</Text>
          </GlassSurface>
        </Pressable>
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
  content: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: space.xl, gap: space.lg },
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
