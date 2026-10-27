import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas } from "../components/Canvas";
import { ScreenHeader } from "../components/ScreenHeader";
import { AgentOrb } from "../components/AgentOrb";
import { haptic } from "../haptics";
import { ReplySpeaker } from "../lib/speak";
import { VoiceSession, type Recorder, type VoicePhase } from "../lib/voice-session";
import { voiceOrbPhase } from "../lib/voice-orb";
import { onTurnSettled } from "../store/queue";
import type { ScreenProps } from "../navigation";
import { sendChat, sendVoiceBegin, sendVoiceChunk, sendVoiceCommit } from "../net/bridge";
import { addSegment, registerSink } from "../store/annotate";
import { canSteer } from "../lib/composer-mode";
import { beginTurn, createConversation, store } from "../store/app";
import { replyText } from "../store/text";
import { colors, radius, space, type, surfaces } from "../theme";
import { screenBack } from "../lib/screen-back";

const ORB = 190;

const CAPTION: Record<VoicePhase, string> = {
  idle: "Tap Start to use legacy voice.",
  listening: "Say something…",
  hearing: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

type Props = ScreenProps<"Voice"> & { onExit(): void };

export function LegacyVoiceScreen({ navigation, onExit }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });

  const [phase, setPhase] = useState<VoicePhase>("idle");
  const phaseRef = useRef<VoicePhase>("idle");
  phaseRef.current = phase;
  const [error, setError] = useState<string | undefined>();
  const [started, setStarted] = useState(false);

  const level = useSharedValue(0);
  const sessionRef = useRef<VoiceSession | null>(null);
  const speakerRef = useRef<ReplySpeaker | null>(null);
  const turnRef = useRef<string | null>(null);
  /** When the current utterance began, for aligning annotation strokes with speech. */
  const utteranceStart = useRef(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const conversationId = store.use((s) => s.activeId);
  const harness = store.use((s) => s.conversations.find(c => c.id === s.activeId)?.harness ?? s.settings?.harness ?? "omp");
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

  /** When the bridge reports what it heard, publish it as a timed transcript segment. */
  const followHeard = useCallback((conversationId: string, turnId: string, start: number, end: number) => {
    const userText = (): string | undefined => {
      const messages = store.get().conversations.find(c => c.id === conversationId)?.messages ?? [];
      const at = messages.findIndex(m => m.role === "assistant" && m.turnId === turnId);
      const user = at > 0 ? messages[at - 1] : undefined;
      return user?.role === "user" && user.text ? user.text : undefined;
    };
    const unsubscribe = store.subscribe(() => {
      const text = userText();
      if (!text) return;
      unsubscribe();
      addSegment({ id: `voice-${turnId}`, text, start, end, source: "voice" });
    });
    setTimeout(unsubscribe, 120_000);
  }, []);

  // Live mode: while legacy voice runs, an annotation Send goes into this voice conversation.
  useEffect(() => {
    if (!started) return;
    return registerSink({
      label: "voice session",
      live: true,
      steerable: () => {
        const c = store.get().conversations.find(x => x.id === conversationId);
        return canSteer(c?.harness ?? harness, c?.sessionId, phaseRef.current === "thinking" || phaseRef.current === "speaking" ? "thinking" : "idle");
      },
      send: (text, attachments, mode) => {
        const active = store.get().conversations.find(c => c.id === conversationId) ?? createConversation(harness);
        const { turnId } = beginTurn(active.id, text, { attachments, mode });
        const current = store.get().conversations.find(c => c.id === active.id) ?? active;
        sendChat({ turnId, harness: current.harness, mode, text, sessionId: current.sessionId, cwd: current.cwd, attachments });
        followReply(turnId);
        turnRef.current = turnId;
      },
    });
  }, [started, conversationId, harness, followReply]);

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
        const message = store.get().conversations.find((c) => c.id === active.id)?.messages.at(-1);
        setError(message?.role === "assistant" ? message.error ?? "Could not start voice." : "Could not start voice.");
        return false;
      }
      followHeard(active.id, turnId, utteranceStart.current || Date.now(), Date.now());
      for (const chunk of chunks) sendVoiceChunk(turnId, chunk);
      sendVoiceCommit(turnId);
      turnRef.current = turnId;
      followReply(turnId);
      haptic.tap();
      return true;
    },
    [conversationId, harness, followReply, followHeard],
  );

  useEffect(() => {
    if (!started) return;
    let active = true;
    const speaker = new ReplySpeaker((speaking) => {
      sessionRef.current?.setReplyActive(speaking);
      // Pauses between TTS sentences do not mean the bridge turn has finished.
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
      onPhase: next => {
        if (next === "hearing" && phaseRef.current !== "hearing") utteranceStart.current = Date.now();
        setPhase(next);
      },
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
    const unsubscribeSettled = onTurnSettled(id => {
      const conversation = store.get().conversations.find(c => c.id === id);
      if (!conversation?.messages.some(m => m.role === "assistant" && m.turnId === turnRef.current)) return;
      if (turnRef.current) speaker.feed(replyText.get(turnRef.current));
      speaker.flush();
      session.turnSettled();
    });

    void (async () => {
      try {
        const permission = await requestRecordingPermissionsAsync();
        if (!active) return;
        if (!permission.granted) {
          setError("Dash needs the microphone to hold a conversation.");
          setStarted(false);
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (active) await session.start();
      } catch (error) {
        if (active) {
          setError(error instanceof Error ? error.message : String(error));
          setStarted(false);
        }
      }
    })();

    return () => {
      active = false;
      unsubscribeSettled();
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      speaker.stop();
      void session.stop();
      sessionRef.current = null;
    };
  }, [recorder, level, sendUtterance, started]);

  const caption = useMemo(() => error ?? CAPTION[phase], [error, phase]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.xl }]}>
      <Canvas /><ScreenHeader title="Voice" onBack={() => screenBack(navigation)} />

      <View style={styles.stage}>
        <AgentOrb size="hero" thinking={{ phase: voiceOrbPhase(phase, started, error) }} label={`Legacy voice ${voiceOrbPhase(phase, started, error)}`} />
      </View>

      <View style={styles.footer}>
        <Text style={[styles.caption, error ? styles.captionError : null]}>{caption}</Text>
        {heard ? <Text style={styles.heard}>{heard}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(undefined);
            setStarted(!started);
          }}
          style={styles.back}
        >
          <Text style={styles.caption}>{started ? "Stop legacy voice" : "Start legacy voice"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onExit} style={styles.back}>
          <Text style={styles.caption}>Back to shared voice</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surfaces.scene },
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
  back: { minHeight: 44, justifyContent: "center", paddingHorizontal: space.lg },
});
