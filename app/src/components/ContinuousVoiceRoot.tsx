import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { executionToken, voiceAccessToken } from "../lib/bridge-auth";
import { ContinuousVoice, object, VoiceAccessDenied, type VoiceState } from "../lib/continuous-voice";
import { createVoicePeer } from "../lib/voice-peer";
import { addSegment, annotate, registerSink } from "../store/annotate";
import type { Conversation } from "../model";
import { sendVoiceAnnotation } from "../lib/voice-annotation";
import { store } from "../store/app";
import { colors } from "../theme";
import AsyncStorage from "@react-native-async-storage/async-storage";

const initial: VoiceState = { phase: "idle", muted: false, lines: [] };
interface VoiceContext { state: VoiceState; start(): Promise<void>; stop(): Promise<void>; mute(): void }
const Context = createContext<VoiceContext | null>(null);
export function useContinuousVoice(): VoiceContext {
  const value = useContext(Context); if (!value) throw new Error("Voice root not mounted"); return value;
}

export function ContinuousVoiceRoot({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState(initial);
  const [bindingGeneration, setBindingGeneration] = useState(0);
  const call = useRef<ContinuousVoice | null>(null);
  const attached = useRef<Conversation | null>(null);
  const epoch = useRef(0);
  const starting = useRef(false);
  const insets = useSafeAreaInsets();
  const start = async () => {
    if (starting.current || annotate.get().recording) return;
    if (call.current && !["idle", "error"].includes(call.current.state.phase)) return;
    const settings = store.get().settings;
    const conversation = store.get().conversations.find(c => c.id === store.get().activeId);
    if (!settings?.identity || conversation?.harness !== "hermes" || !conversation.sessionId || !conversation.profileId) {
      setState({ ...initial, phase: "error", note: "Attach the intended Hermes conversation and pair Dash through z0bridge before starting voice." }); return;
    }
    const target = { profile: conversation.profileId, session: conversation.sessionId };
    attached.current = conversation;
    const generation = ++epoch.current;
    setBindingGeneration(generation);
    starting.current = true;
    // Frozen for the call: navigating/switching chats never retargets spoken requests.
    const request = async (path: string, body?: unknown): Promise<unknown> => {
      if (path === "provider:answer") {
        if (!object(body) || typeof body.sdp !== "string" || typeof body.secret !== "string") throw new Error("Invalid offer");
        const response = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { authorization: `Bearer ${body.secret}`, "content-type": "application/sdp" }, body: body.sdp, signal: AbortSignal.timeout(20_000), redirect: "error" });
        if (!response.ok) throw new Error("Realtime signaling unavailable"); return response.text();
      }
      let token: string;
      try { token = await voiceAccessToken(settings); } catch { throw new VoiceAccessDenied("Voice identity unavailable"); }
      const response = await fetch(`https://0.taila30dc.ts.net:8791${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), redirect: "error" });
      if (response.status === 401 || response.status === 403) throw new VoiceAccessDenied("Voice authorization refused");
      if (!response.ok) throw new Error("Voice broker request refused"); return response.json();
    };
    // Bootstrap is authenticated independently using the existing Dash identity, not an owner bearer.
    try {
      setState({ ...initial, phase: "connecting" });
      const response = await fetch(`http://${settings.address}/voice/bootstrap`, { method: "POST", headers: { authorization: `Bearer ${await executionToken(settings)}`, "content-type": "application/json" }, body: JSON.stringify(target), signal: AbortSignal.timeout(8000), redirect: "error" });
      const bootstrap: unknown = await response.json();
      if (!response.ok || !object(bootstrap) || bootstrap.profile !== target.profile || bootstrap.session !== target.session || bootstrap.ready !== true) throw new Error("Voice bootstrap unavailable");
      if (generation !== epoch.current) return;
      if (AppState.currentState !== "active") throw new Error("Dash is backgrounded");
      const cursorKey = `dash.voice.inbox.${settings.identity.credentialId}`;
      const controller = new ContinuousVoice({ request, peer: createVoicePeer, changed: setState,
        holdIntent: () => annotate.get().active,
        cursor: { read: async () => { const raw = await AsyncStorage.getItem(cursorKey); return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null; }, write: value => AsyncStorage.setItem(cursorKey, String(value)) },
        transcript: (id, text, start, end) => { if (annotate.get().active) addSegment({ id, text, start, end, source: "voice" }); } });
      call.current = controller;
      await controller.start(target);
    } catch { if (generation === epoch.current) setState({ ...initial, phase: "error", note: "Native voice is not ready: bridge bootstrap, broker identity verification and explicit z0live:voice grant must be deployed. No external app opened." }); }
    finally { if (generation === epoch.current) starting.current = false; }
  };
  const stop = async () => { epoch.current++; starting.current = false; const cleanup = call.current?.stop(); setState(initial); await cleanup; };
  useEffect(() => {
    const subscription = AppState.addEventListener("change", next => { if (next === "background") { epoch.current++; starting.current = false; void call.current?.stop("Mic stopped because Dash left the foreground. Tap Start to resume."); setState(previous => ["idle", "error"].includes(previous.phase) ? previous : { ...previous, phase: "error", note: "Mic stopped because Dash left the foreground. Tap Start to resume." }); } });
    return () => { epoch.current++; subscription.remove(); void call.current?.stop(); };
  }, []);
  const active = !["idle", "error"].includes(state.phase);
  useEffect(() => {
    const target = attached.current;
    if (!active || !target) return;
    const generation = epoch.current;
    return registerSink({ label: "attached voice conversation", live: true, steerable: () => false,
      send: (text, attachments) => sendVoiceAnnotation(target, text, attachments, (id, reply) => { if (generation === epoch.current) call.current?.deliverFinal(`annotation:${id}`, reply); }),
    });
  }, [active, bindingGeneration]);
  return <Context.Provider value={{ state, start, stop, mute: () => call.current?.mute(!state.muted) }}>
    {children}
    {active ? <View style={[styles.bar, { top: insets.top }]} accessibilityLiveRegion="polite">
      <Text style={styles.text}>{state.muted ? "Mic muted" : state.phase === "connecting" ? "Voice connecting · mic muted" : `● Mic active · ${state.phase}`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={state.muted ? "Unmute microphone" : "Mute microphone"} onPress={() => call.current?.mute(!state.muted)} style={styles.button}><Text style={styles.text}>{state.muted ? "Unmute" : "Mute"}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Stop continuous voice" onPress={() => void stop()} style={styles.button}><Text style={styles.text}>Stop</Text></Pressable>
    </View> : null}
  </Context.Provider>;
}
const styles = StyleSheet.create({ bar: { position: "absolute", left: 8, right: 8, backgroundColor: colors.bg, borderColor: colors.accent, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 1000 }, text: { color: colors.text, fontSize: 12 }, button: { minHeight: 44, minWidth: 52, alignItems: "center", justifyContent: "center" } });
