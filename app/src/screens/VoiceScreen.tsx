import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppNav } from "../components/AppNav";
import { haptic } from "../haptics";
import { ReplySpeaker } from "../lib/speak";
import { VoiceSession, type Recorder, type VoicePhase } from "../lib/voice-session";
import type { ScreenProps } from "../navigation";
import { sendVoiceBegin, sendVoiceChunk, sendVoiceCommit } from "../net/bridge";
import { beginTurn, createConversation, store } from "../store/app";
import { replyText } from "../store/text";
import { colors, radius, space, type } from "../theme";

const ORB = 190;

const CAPTION: Record<VoicePhase, string> = {
  idle: "Say something…",
  listening: "Say something…",
  hearing: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export function VoiceScreen({ navigation }: ScreenProps<"Voice">): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });

  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [error, setError] = useState<string | undefined>();

  const level = useSharedValue(0);
  const pulse = useSharedValue(0);
  const sessionRef = useRef<VoiceSession | null>(null);
  const speakerRef = useRef<ReplySpeaker | null>(null);
  const turnRef = useRef<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const conversationId = store.use((s) => s.activeId);
  const harness = store.use((s) => s.settings?.harness ?? "omp");
  /** The last thing the bridge heard, so the user can see they were understood. */
  const heard = store.use((s) => {
    const messages = s.conversations.find((c) => c.id === s.activeId)?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === "user" && message.text) return message.text;
    }
    return "";
  });

  /** Watch one reply as it streams and speak each finished sentence. */
  const followReply = useCallback((turnId: string) => {
    unsubscribeRef.current?.();
    const speaker = speakerRef.current;
    if (!speaker) return;
    const tick = (): void => speaker.feed(replyText.get(turnId));
    unsubscribeRef.current = replyText.subscribe(turnId, tick);
  }, []);

  const sendUtterance = useCallback(
    (chunks: string[], mime: string): boolean => {
      const active =
        store.get().conversations.find((c) => c.id === conversationId) ?? createConversation(harness);
      // The text is empty until the bridge tells us what it heard.
      const { turnId } = beginTurn(active.id, "");
      const current = store.get().conversations.find((c) => c.id === active.id) ?? active;
      const opened = sendVoiceBegin({
        turnId,
        harness: current.harness,
        mime,
        sessionId: current.sessionId,
        cwd: current.cwd,
      });
      if (!opened) {
        setError("Not connected to your computer.");
        return false;
      }
      for (const chunk of chunks) sendVoiceChunk(turnId, chunk);
      sendVoiceCommit(turnId);
      turnRef.current = turnId;
      followReply(turnId);
      haptic.tap();
      return true;
    },
    [conversationId, harness, followReply],
  );

  useEffect(() => {
    const speaker = new ReplySpeaker((speaking) => {
      sessionRef.current?.setReplyActive(speaking);
      if (!speaking) sessionRef.current?.turnSettled();
    });
    speakerRef.current = speaker;

    const adapter: Recorder = {
      get uri() {
        return recorder.uri;
      },
      prepareToRecordAsync: () => recorder.prepareToRecordAsync(),
      record: () => recorder.record(),
      stop: () => recorder.stop(),
      getStatus: () => recorder.getStatus(),
    };

    const session = new VoiceSession(adapter, {
      onPhase: setPhase,
      onLevel: (db) => {
        // -50dB is a quiet room, -10dB is loud speech.
        level.value = Math.max(0, Math.min(1, (db + 50) / 40));
      },
      onUtterance: sendUtterance,
      onBargeIn: () => {
        speaker.stop();
        haptic.tap();
      },
      onError: setError,
    });
    sessionRef.current = session;

    void (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError("Dash needs the microphone to hold a conversation.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await session.start();
    })();

    return () => {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      speaker.stop();
      void session.stop();
      sessionRef.current = null;
    };
  }, [recorder, level, sendUtterance]);

  // A slow breath while idle; a faster one while the agent works.
  useEffect(() => {
    cancelAnimation(pulse);
    const duration = phase === "thinking" ? 900 : 2600;
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [phase, pulse]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.05 + level.value * 0.16 }],
    opacity: 0.85 + pulse.value * 0.15,
  }));

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1.08 + level.value * 0.42 }],
    opacity: 0.05 + level.value * 0.3,
  }));

  const caption = useMemo(() => error ?? CAPTION[phase], [error, phase]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.xl }]}>
      <AppNav navigation={navigation} tab={1} />

      <View style={styles.stage}>
        <Animated.View style={[styles.halo, haloStyle]} />
        <Animated.View style={[styles.orb, orbStyle]}>
          <View style={styles.orbCore} />
          <View style={styles.orbHighlight} />
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Text style={[styles.caption, error ? styles.captionError : null]}>{caption}</Text>
        {heard ? <Text style={styles.heard}>{heard}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xl },
  halo: {
    position: "absolute",
    width: ORB,
    height: ORB,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: radius.pill,
    backgroundColor: "#8a8a8a",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  orbCore: {
    width: ORB * 0.72,
    height: ORB * 0.72,
    borderRadius: radius.pill,
    backgroundColor: "#d8d8d8",
  },
  orbHighlight: {
    position: "absolute",
    top: ORB * 0.16,
    left: ORB * 0.22,
    width: ORB * 0.38,
    height: ORB * 0.22,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  footer: { alignItems: "center", gap: space.md, minHeight: 96, paddingHorizontal: space.xl },
  caption: { ...type.body, color: colors.textMuted },
  captionError: { color: colors.danger, textAlign: "center" },
  heard: { ...type.small, color: colors.textFaint, textAlign: "center" },
});
