import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { ReduceMotion, ZoomIn } from "react-native-reanimated";
import { AgentOrb } from "../components/AgentOrb";
import { Canvas } from "../components/Canvas";
import { PrimaryButton } from "../components/PrimaryButton";
import { ScreenHeader } from "../components/ScreenHeader";
import { useContinuousVoice } from "../components/ContinuousVoiceRoot";
import { LaneTimeline } from "../components/LaneTimeline";
import { useZ0LiveLanes } from "../lib/z0live-lanes";
import { store } from "../store/app";
import { screenBack } from "../lib/screen-back";
import { openCouncil } from "../store/council";
import { firstFailingVoiceProbe, runDeviceCheck } from "../lib/device-check";

import type { ScreenProps } from "../navigation";
import type { OrbState } from "../lib/orb-phase";
import { colors, radius, space, type } from "../theme";
import { setActive } from "../store/app";
import { ApprovalLine, VoiceCaptionsToggle } from "../components/VoiceCaptionStrip";
import { CatalogEphemeralCard } from "../components/genui/CatalogEphemeralCard";
import { useVoiceApprovals } from "../lib/voice-approval-actions";
import { voiceApprovalKey } from "../lib/voice-approvals";
import { voiceStatusAccessibilityLabel } from "../lib/voice-bar";
import { captionText } from "../lib/voice-captions";
import { voiceCaption, voiceCaptionsEnabled } from "../store/voice-captions";
import { parseOpenUI, type OpenUINode } from "../lib/openui-catalog";

function ephemeralCards(node: OpenUINode): Extract<OpenUINode, { type: "EphemeralCard" }>[] {
  if (node.type === "EphemeralCard") return [node];
  return node.type === "Card" || node.type === "Stack" ? node.children.flatMap(ephemeralCards) : [];
}

function cardsInReply(text: string) {
  return Array.from(text.matchAll(/(?:^|\n)[ \t]*```openui-lang[^\S\n]*\n([\s\S]*?)\n[ \t]*```(?=\s|$)/g)).flatMap(match => {
    const parsed = parseOpenUI(match[1] ?? "", true);
    return parsed.state === "ready" ? ephemeralCards(parsed.tree) : [];
  });
}



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
  const { state, start, stop, mute, takeApprovalChat, binding, brokerCardReplies } = useContinuousVoice();
  const live = !["idle", "error"].includes(state.phase);
  const backToChat = () => {
    const conversationId = takeApprovalChat();
    if (!conversationId) { screenBack(props.navigation); return; }
    // Open the actual transcript even when Voice was launched from a workspace tab.
    setActive(conversationId);
    props.navigation.replace("Chat");
  };
  const opening = state.phase === "connecting";
  const caption = state.note ?? (live ? state.phase : "Realtime voice inside Dash");
  const lines = state.lines;
  const orb: OrbState = { phase: state.phase === "hearing" ? "listening" : state.phase === "error" ? "idle" : state.phase };
  const autostart = props.route.params?.autostart === true;
  const settings = store.use(s => s.settings);
  const laneSample = useZ0LiveLanes(settings, true);
  useEffect(() => { if (autostart && !live) void start(); }, [autostart]);

  const approvals = useVoiceApprovals();
  const latestCaption = voiceCaption.use(value => value);
  const captions = voiceCaptionsEnabled.use(value => value);
  const messages = store.use(s => s.conversations.find(chat => chat.id === binding?.id)?.messages);
  const cards = useMemo(() => {
    const replies = (messages ?? []).flatMap(message => message.role === "assistant" && binding &&
      (message.endedAt ?? message.at) >= binding.startedAt ? [{ id: message.id, text: message.text }] : []);
    return [...replies, ...brokerCardReplies].flatMap(reply => cardsInReply(reply.text).map((card, index) => ({
      ...card, key: `${typeof reply.id}:${reply.id}:${index}`,
    })));
  }, [binding, messages, brokerCardReplies]);
  if (live) {
    return <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.md }]}>
      <Canvas />
      <View style={styles.focusHeader}>
        <Pressable testID="voice-focus-back" accessibilityRole="button" accessibilityLabel="Back to chat · call keeps going"
          onPress={backToChat} style={styles.focusBack}>
          <Text style={styles.secondaryText}>‹ Back · call keeps going</Text>
        </Pressable>
        <Text style={styles.liveTag}>{opening ? "CONNECTING" : "● LIVE"}</Text>
      </View>
      <ScrollView testID="voice-content" contentContainerStyle={styles.focusBody}>
        <Animated.View entering={ZoomIn.duration(180).reduceMotion(ReduceMotion.System)} style={styles.focusOrb}>
          <View style={styles.focusOrbFace}>
            <LinearGradient colors={[colors.goldLo, colors.bg]} style={[StyleSheet.absoluteFill, styles.orbTint]} />
            <AgentOrb size={188} thinking={orb} label={`Dash voice ${caption}`} animated={!state.muted} />
          </View>
        </Animated.View>
        <Text testID="voice-caption" style={styles.caption} accessibilityLiveRegion="polite">
          <Text testID="voice-phase" accessible accessibilityLabel={voiceStatusAccessibilityLabel(state)}>
            {state.muted ? "Muted" : state.phase[0]?.toUpperCase() + state.phase.slice(1)}
          </Text>
        </Text>
        {state.note ? <Text style={styles.caption}>{state.note}</Text> : null}
        {state.turbo ? <Text testID="voice-turbo-status" style={styles.caption}>{state.turbo}</Text> : null}
        {captions ? <Text testID="voice-transcript" numberOfLines={4} style={styles.focusCaption} accessibilityLiveRegion="polite">
          {lines.at(-2)?.role === "user" && lines.at(-1)?.role === "assistant" ? <Text style={styles.previousCaption}>{lines.at(-2)?.text}{"\n"}</Text> : null}
          {captionText(latestCaption) || lines.at(-1)?.text || "Captions on"}
        </Text> : null}
        <View testID="voice-focus-cards" style={styles.stack}>
          {approvals.map(approval => <ApprovalLine key={voiceApprovalKey(approval)} approval={approval} focus />)}
          {cards.map(card => <CatalogEphemeralCard key={card.key} kind={card.kind} app={card.app} />)}
        </View>
        {state.routes?.length ? <Text testID="voice-route" numberOfLines={1} accessibilityLabel={`Answered by: ${state.routes.map(route => `${route.lane} lane in ${voiceRouteTime(route.ms)}`).join(", ")}`} style={styles.route}>
          {state.routes.map((route, i) => <Text key={i} testID={`voice-route-${i}`}>{i ? "  ·  " : ""}{route.lane} {voiceRouteTime(route.ms)}</Text>)}
        </Text> : null}
        {laneSample?.lanes.lanes.length ? <LaneTimeline lanes={laneSample.lanes.lanes} offset={laneSample.offset} /> : null}
        <Pressable testID="voice-open-council" accessibilityRole="button" accessibilityLabel="Open the council card"
          onPress={() => openCouncil("z0live")} style={styles.secondary}>
          <Text style={styles.secondaryText}>Council · brief and agent reports</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.focusControls}>
        <Pressable testID="voice-mute" accessibilityRole="button" onPress={mute} style={styles.focusControl}>
          <Text style={styles.secondaryText}>{state.muted ? "Unmute" : "Mute"}</Text>
        </Pressable>
        <VoiceCaptionsToggle style={styles.focusControl} />
        <Pressable testID="voice-end" accessibilityRole="button" accessibilityLabel="Stop voice in Dash" onPress={() => void stop()} style={[styles.focusControl, styles.endControl]}>
          <Text style={styles.endText}>{opening ? "Cancel" : "End"}</Text>
        </Pressable>
      </View>
    </View>;
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }]}>
      <Canvas /><ScreenHeader title="Voice" onBack={() => screenBack(props.navigation)} />
      <View testID="voice-content" style={styles.content}>
        <Text style={styles.title}>Dash voice</Text>
        <AgentOrb size="hero" thinking={orb} label={`Dash voice ${caption}`} />
        <Text accessibilityLiveRegion="polite" style={styles.caption} testID="voice-caption">
          {caption}
        </Text>
        {state.turbo ? <Text accessibilityLiveRegion="polite" style={styles.caption} testID="voice-turbo-status">{state.turbo}</Text> : null}
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
        <PrimaryButton accessibilityLabel="Start voice in Dash" onPress={() => void start()} label="Start voice" />
        <Pressable testID="voice-open-council" accessibilityRole="button" accessibilityLabel="Open the council card" accessibilityHint="Brief, agent reports, read aloud through the orb" onPress={() => openCouncil("z0live")} style={styles.secondary}>
          <Text style={styles.secondaryText}>Council · brief and agent reports</Text>
        </Pressable>
        {firstFailure ? (
          <Text testID="voice-first-failure" accessibilityLiveRegion="polite" style={styles.failure}>
            First failing voice check: {firstFailure}
          </Text>
        ) : null}
        <Text style={styles.note}>Requires the native Dash APK and explicit voice authorization. Expo Go/web voice is unavailable; no other app is opened.</Text>
      </View>
    </View>
  );
}

/** "412 ms" under a second, "2.6 s" above. */
function voiceRouteTime(ms: number): string {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const styles = StyleSheet.create({
  focusHeader: { paddingHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  focusBack: { minHeight: 48, justifyContent: "center" },
  liveTag: { ...type.mono, color: colors.gold, fontSize: 11 },
  focusBody: { paddingHorizontal: 14, paddingTop: 28, paddingBottom: 16, gap: 10 },
  focusOrb: { alignSelf: "center", borderRadius: 94, backgroundColor: colors.bubble,
    shadowColor: colors.gold, shadowOpacity: 0.28, shadowRadius: 36, elevation: 3 },
  focusOrbFace: { borderRadius: 94, overflow: "hidden" },
  orbTint: { opacity: 0.42 },
  endControl: { backgroundColor: colors.surfaceRaised, borderColor: colors.danger },
  previousCaption: { color: colors.textMuted, fontSize: 13 },
  focusCaption: { ...type.body, color: colors.text, fontSize: 17, lineHeight: 24, textAlign: "center", paddingHorizontal: 14 },
  stack: { gap: 10, paddingTop: 28 },
  focusControls: { flexDirection: "row", justifyContent: "center", gap: 18, paddingTop: 10 },
  focusControl: { width: 58, height: 58, borderWidth: 1, borderColor: colors.hair, borderRadius: 29,
    alignItems: "center", justifyContent: "center" },
  endText: { ...type.small, color: colors.danger },
  screen: { flex: 1, backgroundColor: colors.bg },
  // Clipped: a long call's transcript never spills over the header, the lanes or the controls.
  // Auto margins on the first and last child centre the stage while it fits; when the lanes, the
  // Council link and the controls leave too little room they collapse to 0, so the stage stays
  // anchored under the header and only its bottom (the shrinking transcript) gives way.
  content: { flex: 1, justifyContent: "flex-start", alignItems: "center", paddingHorizontal: space.xl, gap: space.md, overflow: "hidden" },
  title: { ...type.title, color: colors.text, marginTop: "auto" },
  caption: { ...type.body, color: colors.textMuted, textAlign: "center", minHeight: 22 },
  // Shrinks (oldest lines clip at the top) when a long call and open lanes leave little room.
  transcript: { alignSelf: "stretch", gap: space.sm, minHeight: 0, flexShrink: 1, overflow: "hidden", justifyContent: "flex-end", paddingHorizontal: space.sm, borderRadius: radius.md, marginBottom: "auto" },
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
