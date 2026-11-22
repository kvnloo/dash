import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AgentOrb } from "../components/AgentOrb";
import { Canvas } from "../components/Canvas";
import { PrimaryButton } from "../components/PrimaryButton";
import { ScreenHeader } from "../components/ScreenHeader";
import { useContinuousVoice } from "../components/ContinuousVoiceRoot";
import { LaneTimeline } from "../components/LaneTimeline";
import { useZ0LiveLanes } from "../lib/z0live-lanes";
import { store } from "../store/app";
import { screenBack } from "../lib/screen-back";
import { firstFailingVoiceProbe, runDeviceCheck } from "../lib/device-check";

import type { ScreenProps } from "../navigation";
import type { OrbState } from "../lib/orb-phase";
import { colors, radius, space, type } from "../theme";
import { setActive } from "../store/app";


/** Live conversation mode: the hero orb follows a live z0live call, else the chat's live phase. */
export function VoiceScreen(props: ScreenProps<"Voice">): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [firstFailure, setFirstFailure] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void runDeviceCheck().then(report => {
      const failed = firstFailingVoiceProbe(report);
      if (mounted) setFirstFailure(failed ? failed.label + ": " + failed.detail : null);
    }).catch(() => {
      if (mounted) setFirstFailure("Device self-check: unavailable");
    });
    return () => { mounted = false; };
  }, []);
  const { state, start, stop, mute, takeApprovalChat } = useContinuousVoice();
  const live = !["idle", "error"].includes(state.phase);
  const backToChat = () => {
    const conversationId = takeApprovalChat();
    if (!conversationId) { screenBack(props.navigation); return; }
    // Open the actual transcript even when Voice was launched from a workspace tab.
    setActive(conversationId);
    props.navigation.replace("Chat");
  };
  const opening = state.phase === "connecting";
  const caption = state.note ?? (live ? `${state.phase}${state.muted ? " · muted" : ""}${state.delivery ? ` · ${state.delivery}` : ""}` : "Realtime voice inside Dash");
  const lines = state.lines;
  const orb: OrbState = { phase: state.phase === "hearing" ? "listening" : state.phase === "error" ? "idle" : state.phase };
  const autostart = props.route.params?.autostart === true;
  const settings = store.use(s => s.settings);
  const laneSample = useZ0LiveLanes(settings, true);
  useEffect(() => { if (autostart && !live) void start(); }, [autostart]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
      <Canvas /><ScreenHeader title={live ? "Live call" : "Voice"} onBack={() => screenBack(props.navigation)} />
      <View testID="voice-content" style={styles.content}>
        <Text style={styles.title}>Dash voice</Text>
        <AgentOrb size="hero" thinking={orb} label={`Dash voice ${caption}`} />
        <Text accessibilityLiveRegion="polite" style={styles.caption} testID="voice-caption">
          {caption}
        </Text>
        <View style={styles.transcript} testID="voice-transcript">
          {lines.map((line, i) => (
            <Text key={`${i}:${line.role}`} numberOfLines={2} style={[styles.line, line.role === "user" ? styles.user : styles.assistant, i < lines.length - 1 && styles.older]}>
              <Text style={styles.who}>{line.role === "user" ? "you  " : line.lane ? `${line.lane}  ` : "agent  "}</Text>{line.text}
            </Text>
          ))}
        </View>
      </View>
      {state.routes?.length ? (
        <Text testID="voice-route" numberOfLines={1} accessibilityLabel={`Answered by: ${state.routes.map(route => `${route.lane} lane in ${voiceRouteTime(route.ms)}`).join(", ")}`} style={styles.route}>
          {state.routes.map((route, i) => <Text key={i} testID={`voice-route-${i}`}>{i ? "  ·  " : ""}{route.lane} {voiceRouteTime(route.ms)}</Text>)}
        </Text>
      ) : null}
      {laneSample?.lanes.lanes.length ? <View style={styles.lanes}><LaneTimeline lanes={laneSample.lanes.lanes} offset={laneSample.offset} /></View> : null}
      <View style={styles.controls}>
        <PrimaryButton accessibilityLabel={live ? "Stop voice in Dash" : "Start voice in Dash"} onPress={() => void (live ? stop() : start())} label={opening ? "Cancel connection" : live ? "Stop voice" : "Start voice"} />
        {!live && firstFailure ? (
          <Text testID="voice-first-failure" accessibilityLiveRegion="polite" style={styles.failure}>
            First failing voice check: {firstFailure}
          </Text>
        ) : null}
        {live ? (
          <>
            <Pressable accessibilityRole="button" onPress={backToChat} style={styles.secondary}>
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

/** "412 ms" under a second, "2.6 s" above. */
function voiceRouteTime(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // Clipped: a long call's transcript never spills over the header, the lanes or the controls.
  content: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: space.xl, gap: space.md, overflow: "hidden" },
  title: { ...type.title, color: colors.text },
  caption: { ...type.body, color: colors.textMuted, textAlign: "center", minHeight: 22 },
  // Shrinks (oldest lines clip at the top) when a long call and open lanes leave little room.
  transcript: { alignSelf: "stretch", gap: space.sm, minHeight: 0, flexShrink: 1, overflow: "hidden", justifyContent: "flex-end", paddingHorizontal: space.sm, borderRadius: radius.md },
  line: { ...type.body },
  user: { color: colors.text, textAlign: "right" },
  assistant: { color: colors.text, textAlign: "left" },
  older: { opacity: 0.55 },
  who: { ...type.small, color: colors.textFaint },
  route: { ...type.small, color: colors.textFaint, textAlign: "center", paddingHorizontal: space.xl, paddingBottom: space.xs },
  message: { ...type.body, color: colors.text, textAlign: "center" },
  error: { color: colors.danger },
  lanes: { paddingHorizontal: space.xl, paddingBottom: space.sm },
  controls: { paddingHorizontal: space.xl, alignItems: "stretch", gap: space.xs },
  secondary: { minHeight: 44, justifyContent: "center", alignItems: "center", paddingHorizontal: space.lg },
  secondaryText: { ...type.body, color: colors.textMuted },
  note: { ...type.small, color: colors.textFaint, textAlign: "center" },
  failure: { ...type.small, color: colors.warn, textAlign: "center" },
});
