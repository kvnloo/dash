import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View, type PointerEvent, type ViewStyle } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { ZoomIn, ReduceMotion } from "react-native-reanimated";
import { debugNavigate, debugNavigationRef } from "../debug/nav";
import type { VoiceState } from "../lib/continuous-voice";
import { useVoiceApprovals } from "../lib/voice-approval-actions";
import { voiceApprovalKey } from "../lib/voice-approvals";
import { annotate } from "../store/annotate";
import { surfaceMode } from "../store/ephemeral-mode";
import { createStore } from "../store/createStore";
import { colors, glass, radius, type } from "../theme";
import { AgentOrb } from "./AgentOrb";

const webPointerStyle: ViewStyle & { touchAction: "none" } = { touchAction: "none" };
const preference = "dash.voice.bubble-edge";
const edge = createStore<"left" | "right">("right");
let edgeChanged = false;
void AsyncStorage.getItem(preference).then(saved => {
  if (!edgeChanged && (saved === "left" || saved === "right")) edge.set(saved);
}).catch(() => {});

export function focusVoiceOrbOverlay(): void { debugNavigate("Voice"); }

export function useVoiceRoute(): string | undefined {
  const [route, setRoute] = useState<string>();
  useEffect(() => {
    const sync = () => {
      if (debugNavigationRef.isReady()) setRoute(debugNavigationRef.getCurrentRoute()?.name);
    };
    const onReady = debugNavigationRef.addListener("ready", sync);
    const onState = debugNavigationRef.addListener("state", sync);
    sync();
    return () => { onReady(); onState(); };
  }, []);
  return route;
}

export function VoiceOrbOverlay({ state, onMute, onEnd }: { state: VoiceState; onMute(): void; onEnd(): void }) {
  const annotating = annotate.use(s => s.active);
  const learning = surfaceMode.use(s => s === "learn");
  const visible = state.phase !== "idle" && state.phase !== "error" && !annotating && !learning;
  return visible ? <VoiceBubble state={state} onMute={onMute} onEnd={onEnd} /> : null;
}

function VoiceBubble({ state, onMute, onEnd }: { state: VoiceState; onMute(): void; onEnd(): void }) {
  const side = edge.use(value => value);
  const approvals = useVoiceApprovals();
  const approval = approvals[0];
  const key = approval ? voiceApprovalKey(approval) : null;
  const [collapsed, setCollapsed] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [width, setWidth] = useState(0);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!key) { setCollapsed(null); return; }
    const timer = setTimeout(() => setCollapsed(key), 5000);
    return () => clearTimeout(timer);
  }, [key]);
  const pointer = useRef<{ id: number; startX: number; moved: boolean } | null>(null);
  const travel = Math.max(0, width - 58);
  const start = side === "left" ? 0 : travel;
  const drag = useMemo(() => {
    const move = (dx: number) => setOffset(Math.min(travel, Math.max(0, start + dx)) - start);
    const snap = (dx: number) => {
      const next = start + dx < travel / 2 ? "left" : "right";
      edgeChanged = true;
      edge.set(next);
      void AsyncStorage.setItem(preference, next).catch(() => {});
      AccessibilityInfo.announceForAccessibility(`Voice bubble docked ${next}`);
    };
    const native = Gesture.Pan().activeOffsetX([-8, 8]).failOffsetY([-12, 12]).runOnJS(true)
      .onStart(() => setMenu(false))
      .onUpdate(({ translationX }) => move(translationX))
      .onEnd(({ translationX }) => snap(translationX))
      .onFinalize(() => setOffset(0));
    const web = {
      onPointerDown(event: PointerEvent) {
        const { button, clientX, pointerId } = event.nativeEvent;
        if (button !== 0) return;
        pointer.current = { id: pointerId, startX: clientX, moved: false };
        if (event.target instanceof HTMLElement) event.target.setPointerCapture(pointerId);
      },
      onPointerMove(event: PointerEvent) {
        const input = pointer.current;
        if (!input || input.id !== event.nativeEvent.pointerId) return;
        const dx = event.nativeEvent.clientX - input.startX;
        if (!input.moved && Math.abs(dx) < 8) return;
        if (!input.moved) setMenu(false);
        input.moved = true;
        move(dx);
      },
      onPointerUp(event: PointerEvent) {
        const input = pointer.current;
        if (!input || input.id !== event.nativeEvent.pointerId) return;
        if (input.moved) snap(event.nativeEvent.clientX - input.startX);
        requestAnimationFrame(() => { if (pointer.current === input) pointer.current = null; });
        setOffset(0);
      },
      onPointerCancel() {
        pointer.current = null;
        setOffset(0);
      },
    };
    return { native, web };
  }, [start, travel]);
  const phase = state.phase === "hearing" ? "listening" : state.phase === "error" ? "idle" : state.phase;
  const label = state.muted ? "Muted" : state.phase[0]?.toUpperCase() + state.phase.slice(1);
  const ring = state.muted ? colors.textTertiary : phase === "thinking" ? colors.accent : phase === "speaking" ? colors.ok : colors.gold;
  const subject = approval?.kind === "sudo" ? `sudo · ${approval.request.command}` : approval ? `Needs OK · ${approval.title}` : "";
  const instruction = approval?.kind === "sudo" ? "tap or say open sudo" : approval?.allowOptionId ? "tap or say allow" : "tap to review";
  const bubble = <View collapsable={false} {...(Platform.OS === "web" ? drag.web : {})}
    style={[{ transform: [{ translateX: offset }], zIndex: 1 }, Platform.OS === "web" && webPointerStyle]}>
    <Pressable testID="voice-orb-overlay" accessibilityRole="button"
      accessibilityLabel={`Open voice focus · ${label}${approvals.length ? ` · ${approvals.length} pending` : ""}`}
      accessibilityHint="Hold for microphone and call controls"
      onPress={() => { if (!pointer.current?.moved) focusVoiceOrbOverlay(); }}
      onLongPress={() => { if (!pointer.current?.moved) setMenu(value => !value); }}
      style={[styles.bubble, { borderColor: ring, shadowColor: ring }]}>
      <View pointerEvents="none" style={styles.orbFace}>
        <LinearGradient colors={[state.muted ? colors.surfaceRaised : colors.goldLo, colors.bg]} style={StyleSheet.absoluteFill} />
        <AgentOrb size={52} thinking={{ phase }} animated={!state.muted} />
      </View>
      {approvals.length ? <Text testID="voice-orb-badge" style={styles.badge}>{approvals.length}</Text> : null}
    </Pressable>
  </View>;
  return <Animated.View entering={ZoomIn.duration(160).reduceMotion(ReduceMotion.System)} pointerEvents="box-none" style={styles.dock}>
    <View pointerEvents="box-none" onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[styles.row, side === "left" && styles.left]}>
      {Platform.OS === "web" ? bubble : <GestureDetector gesture={drag.native}>{bubble}</GestureDetector>}
      {menu ? <View testID="voice-bubble-menu" style={styles.menu}>
        <Pressable accessibilityRole="button" onPress={() => { onMute(); setMenu(false); }} style={styles.action}>
          <Text style={styles.text}>{state.muted ? "Unmute" : "Mute"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onEnd} style={styles.action}><Text style={styles.end}>End</Text></Pressable>
      </View> : key && key !== collapsed ? <Pressable testID="voice-orb-peek" accessibilityRole="button"
        accessibilityLabel={`${subject} · ${instruction}`} onPress={focusVoiceOrbOverlay} style={styles.peek}>
        <Text numberOfLines={1} style={[styles.text, styles.subject]}>{subject}</Text>
        <Text numberOfLines={1} style={styles.hint}> · {instruction}</Text>
      </Pressable> : null}
    </View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  dock: { marginHorizontal: 14, marginVertical: 6 },
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 10 },
  left: { flexDirection: "row" },
  bubble: { width: 58, height: 58, borderRadius: 29, borderWidth: 1.5, backgroundColor: colors.bg,
    alignItems: "center", justifyContent: "center", shadowOpacity: 0.45, shadowRadius: 8, elevation: 3 },
  orbFace: { borderRadius: 27, overflow: "hidden" },
  badge: { position: "absolute", top: -3, right: -4, minWidth: 22, height: 22, borderRadius: 11,
    overflow: "hidden", borderWidth: 2, borderColor: colors.bg, paddingHorizontal: 3, lineHeight: 18,
    textAlign: "center", backgroundColor: colors.danger, color: colors.bg, fontWeight: "700", fontSize: 12 },
  peek: { maxWidth: "76%", flexShrink: 1, minHeight: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 10,
    borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: glass.hair2 },
  menu: { flexDirection: "row", borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: 1, borderColor: glass.hair2 },
  action: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center" },
  text: { ...type.small, color: colors.text },
  subject: { flexShrink: 1, color: colors.gold },
  hint: { ...type.small, color: colors.textMuted, flexShrink: 0 },
  end: { ...type.small, color: colors.danger },
});
