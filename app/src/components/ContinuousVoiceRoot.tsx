import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";
import { appInsets, VOICE_BAR_ROW, voiceBarPresentation, voiceBarVisible, voiceControlHome, voiceMuteAccessibilityLabel, voiceStatusAccessibilityLabel } from "../lib/voice-bar";
import { executionToken, voiceAccessToken } from "../lib/bridge-auth";
import { ContinuousVoice, object, VoiceAccessDenied, type VoiceState } from "../lib/continuous-voice";
import { protectVoicePeer, VoiceMicReleaseGate, voiceConnectionError, voiceConnectionErrorLine } from "../lib/voice-session";
import { createVoicePeer } from "../lib/voice-peer";
import { addSegment, annotate, registerSink } from "../store/annotate";
import type { Conversation } from "../model";
import { sendVoiceAnnotation } from "../lib/voice-annotation";
import { store } from "../store/app";
import { colors, glass, radius } from "../theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { microphone } from "../lib/recorded-speech";
import { createStore } from "../store/createStore";
import { debugUi } from "../debug/ui-store";
import { voiceTarget } from "../lib/voice-target";

/** One logcat line per failed voice stage (phone-watch turns these into incidents). Notes never carry secrets. */
function voiceTrace(stage: string, note: string | undefined): void { console.warn(`[voice] ${stage} failed: ${note ?? "unknown"}`); }

const initial: VoiceState = { phase: "idle", muted: false, lines: [] };
/** True while a full-screen chat window is open: its dock row is then the single home of voice Mute/End. */
export const voiceWindowOpen = createStore(false);
const DeviceInsets = createContext<EdgeInsets | null>(null);
/** Real device safe-area insets (the window's cut-out pill must hug the status band, not the voice bar). */
export function useDeviceInsets(): EdgeInsets {
  const device = useContext(DeviceInsets); const app = useSafeAreaInsets(); return device ?? app;
}
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
  const releaseMic = useRef<(() => void) | undefined>(undefined);
  const micRelease = useRef(new VoiceMicReleaseGate());
  const desiredMute = useRef(false);
  const insets = useSafeAreaInsets();
  const windowOpen = voiceWindowOpen.use(open => open);
  const [barRow, setBarRow] = useState(0);
  const [attempted, setAttempted] = useState(false);
  // SYNTHETIC debug-only state for rendered proofs (never set outside the debug controller).
  const fixture = debugUi.use(s => s.voiceStateFixture ?? null);
  const start = async () => {
    if (starting.current) return;
    if (call.current && !["idle", "error"].includes(call.current.state.phase)) return;
    starting.current = true;
    const beforeWait = epoch.current;
    // An error is published before ContinuousVoice finishes native teardown.
    await micRelease.current.wait();
    if (beforeWait !== epoch.current) return; // End/background already cancelled this attempt.
    setAttempted(true);
    desiredMute.current = false;
    const settings = store.get().settings;
    // Retry is pinned to the original conversation, even if the user navigated elsewhere.
    // Conversation mode is usually opened from the main screen, where the open chat is rarely an
    // attached Hermes chat: bind the most recent attached one instead of refusing before the mic.
    const conversation = (state.phase === "error" ? attached.current : null) ??
      voiceTarget(store.get().conversations, store.get().activeId);
    if (!settings?.identity || !conversation?.sessionId || !conversation.profileId) {
      const note = !settings?.identity ? "Pair Dash with z0bridge identity to use voice" : "Open a Hermes chat once, then start voice";
      voiceTrace("target", note);
      setState({ ...initial, phase: "error", note });
      starting.current = false;
      return;
    }
    const target = { profile: conversation.profileId, session: conversation.sessionId };
    const release = microphone.acquire("live");
    if (!release) {
      voiceTrace("mic-lease", `in use by ${microphone.owner}`);
      setState({ ...initial, phase: "error", note: `Microphone in use by ${microphone.owner}` });
      starting.current = false;
      return;
    }
    const releaseWhenStopped = micRelease.current.hold(release);
    releaseMic.current = releaseWhenStopped;
    call.current = null;
    attached.current = conversation;
    const generation = ++epoch.current;
    setBindingGeneration(generation);
    // Frozen for the call: navigating/switching chats never retargets spoken requests.
    const request = async (path: string, body?: unknown): Promise<unknown> => {
      if (path === "provider:answer") {
        if (!object(body) || typeof body.sdp !== "string" || typeof body.secret !== "string") {
          throw new VoiceAccessDenied(voiceConnectionError("sdp"));
        }
        let response: Response;
        try {
          response = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { authorization: `Bearer ${body.secret}`, "content-type": "application/sdp" }, body: body.sdp, signal: AbortSignal.timeout(20_000), redirect: "error" });
        } catch { throw new VoiceAccessDenied(voiceConnectionError("sdp")); }
        if (response.status === 401 || response.status === 403) throw new VoiceAccessDenied(voiceConnectionError("token"));
        if (!response.ok) throw new VoiceAccessDenied(voiceConnectionError("sdp"));
        let sdp: string;
        try { sdp = await response.text(); } catch { throw new VoiceAccessDenied(voiceConnectionError("sdp")); }
        if (!sdp.startsWith("v=0")) throw new VoiceAccessDenied(voiceConnectionError("sdp"));
        return sdp;
      }
      let token: string;
      try { token = await voiceAccessToken(settings); }
      catch { throw new VoiceAccessDenied(voiceConnectionError("token")); }
      const response = await fetch(`https://0.taila30dc.ts.net:8791${path}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000), redirect: "error" });
      if (response.status === 401 || response.status === 403) throw new VoiceAccessDenied(voiceConnectionError("token"));
      if (!response.ok) throw new Error("Voice broker request refused"); return response.json();
    };
    // Bootstrap is authenticated independently using the existing Dash identity, not an owner bearer.
    try {
      setState({ ...initial, phase: "connecting" });
      let bootstrapToken: string;
      try { bootstrapToken = await executionToken(settings); }
      catch { throw new VoiceAccessDenied(voiceConnectionError("token")); }
      const response = await fetch(`http://${settings.address}/voice/bootstrap`, { method: "POST", headers: { authorization: `Bearer ${bootstrapToken}`, "content-type": "application/json" }, body: JSON.stringify(target), signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!response.ok) {
        throw new Error(response.status === 401 || response.status === 403 ? voiceConnectionError("token") :
          response.status === 404 ? "Bridge lacks native voice" :
          response.status === 503 ? "Native voice disabled on bridge" : "Voice bootstrap failed");
      }
      const bootstrap: unknown = await response.json();
      if (!object(bootstrap) || bootstrap.profile !== target.profile || bootstrap.session !== target.session || bootstrap.ready !== true) throw new Error("Voice target not confirmed");
      if (generation !== epoch.current) return;
      if (AppState.currentState !== "active") throw new Error("Dash is backgrounded");
      const cursorKey = `dash.voice.inbox.${settings.identity.credentialId}`;
      const controller = new ContinuousVoice({ request, peer: async (event, ready, lost) => {
        try { return protectVoicePeer(await createVoicePeer(event, ready, lost)); }
        catch (error) {
          throw new VoiceAccessDenied(voiceConnectionError(
            error instanceof Error && /permission denied/i.test(error.message) ? "permission" : "webrtc",
          ));
        }
      }, changed: next => {
        if (generation !== epoch.current) return;
        if (next.phase === "error") voiceTrace("call", next.note);
        setState(next.phase === "error" ? { ...next, note: voiceConnectionErrorLine(next.note) } : next);
      },
        captureReleased: () => { releaseWhenStopped(); if (releaseMic.current === releaseWhenStopped) releaseMic.current = undefined; },
        holdIntent: () => annotate.get().active,
        cursor: { read: async () => { const raw = await AsyncStorage.getItem(cursorKey); return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null; }, write: value => AsyncStorage.setItem(cursorKey, String(value)) },
        transcript: (id, text, start, end) => { if (annotate.get().active) addSegment({ id, text, start, end, source: "voice" }); } });
      call.current = controller;
      // A Mute tap during authenticated bootstrap must also apply when the native peer arrives.
      const connecting = controller.start(target);
      if (desiredMute.current) controller.mute(true);
      await connecting;
    } catch (error) {
      releaseWhenStopped(); if (releaseMic.current === releaseWhenStopped) releaseMic.current = undefined;
      voiceTrace("bootstrap", error instanceof Error ? error.message : undefined);
      if (generation === epoch.current) setState({ ...initial, phase: "error", note: voiceConnectionErrorLine(error instanceof Error ? error.message : undefined) });
    }
    finally { if (generation === epoch.current) starting.current = false; }
  };
  const stop = async () => {
    epoch.current++; starting.current = false; desiredMute.current = false;
    const controller = call.current;
    call.current = null;
    attached.current = null;
    const cleanup = controller?.stop();
    if (!controller) { releaseMic.current?.(); releaseMic.current = undefined; }
    setState(initial); await cleanup;
  };
  const mute = () => {
    if (state.phase === "idle" || state.phase === "error") return;
    const next = !desiredMute.current;
    desiredMute.current = next;
    const controller = call.current;
    if (controller) controller.mute(next);
    else setState(previous => previous.phase === "connecting" ? { ...previous, muted: next } : previous);
  };
  useEffect(() => {
    const subscription = AppState.addEventListener("change", next => { if (next === "background") {
      epoch.current++; starting.current = false;
      const controller = call.current;
      void controller?.stop("Mic stopped because Dash left the foreground. Tap Start to resume.");
      if (!controller) { releaseMic.current?.(); releaseMic.current = undefined; }
      setState(previous => ["idle", "error"].includes(previous.phase) ? previous : { ...previous, phase: "error", note: "Mic stopped because Dash left the foreground. Tap Start to resume." });
    } });
    return () => {
      epoch.current++; subscription.remove(); const controller = call.current; void controller?.stop();
      if (!controller) { releaseMic.current?.(); releaseMic.current = undefined; }
    };
  }, []);
  const shown = fixture ?? state;
  const active = !["idle", "error"].includes(shown.phase);
  const visible = voiceBarVisible(shown.phase, attempted);
  const pill = voiceBarPresentation(shown);
  useEffect(() => {
    const target = attached.current;
    if (!active || !target) return;
    const generation = epoch.current;
    return registerSink({ label: "attached voice conversation", live: true, steerable: () => false,
      send: (text, attachments) => sendVoiceAnnotation(target, text, attachments, (id, reply) => { if (generation === epoch.current) call.current?.deliverFinal(`annotation:${id}`, reply); }),
    });
  }, [active, bindingGeneration]);
  // The bar owns a band under the status bar (screens inset below it); it never floats over AppNav or content.
  // Space stays allocated while a chat window covers the app, so the list underneath never jumps on close.
  const home = voiceControlHome(visible, windowOpen);
  return <Context.Provider value={{ state: shown, start, stop, mute }}>
    <DeviceInsets.Provider value={insets}>
      <SafeAreaInsetsContext.Provider value={appInsets(insets, visible, barRow)}>{children}</SafeAreaInsetsContext.Provider>
    </DeviceInsets.Provider>
    {home === "bar" ? <View testID="voice-mic-bar" style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row} onLayout={e => setBarRow(e.nativeEvent.layout.height)}>
        <View accessible={false} style={[styles.dot, { backgroundColor: pill.phase === "error" ? colors.danger : pill.phase === "connecting" || pill.phase === "muted" ? colors.warn : pill.phase === "live" ? colors.ok : colors.textFaint }]} />
        <View style={styles.status}>
          {pill.phase === "error"
            ? <Text testID="voice-error" accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.errorLabel} numberOfLines={1}>{pill.detail ?? "Voice unavailable"}</Text>
            : <Text testID="voice-phase" accessible accessibilityLabel={voiceStatusAccessibilityLabel(shown)} accessibilityLiveRegion="polite" style={styles.label} numberOfLines={1}>{pill.label}</Text>}
        </View>
        <View style={styles.actions}>
          {pill.action === "end" ? <Pressable
            testID="voice-mute"
            accessibilityRole="button"
            accessibilityLabel={voiceMuteAccessibilityLabel(shown.muted)}
            accessibilityState={{ selected: shown.muted }}
            onPress={mute}
            style={[styles.button, styles.muteButton]}
          ><Text style={styles.buttonText}>{pill.muteText}</Text></Pressable> : null}
          <Pressable
            testID={pill.phase === "error" ? "voice-retry" : pill.action === "start" ? "voice-start" : "voice-end"}
            accessibilityRole="button"
            accessibilityLabel={pill.primaryLabel}
            onPress={pill.action === "start" ? () => void start() : () => void stop()}
            style={styles.button}
          ><Text style={pill.action === "end" ? styles.endText : styles.buttonText}>{pill.primaryText}</Text></Pressable>
          {pill.phase === "error" ? <Pressable
            testID="voice-end"
            accessibilityRole="button"
            accessibilityLabel="End voice call and dismiss error"
            onPress={() => void stop()}
            style={styles.button}
          ><Text style={styles.endText}>End</Text></Pressable> : null}
        </View>
      </View>
    </View> : null}
  </Context.Provider>;
}
const styles = StyleSheet.create({
  bar: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: colors.bg, zIndex: 1000 },
  row: {
    minHeight: VOICE_BAR_ROW, marginHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 8,
    paddingLeft: 12, paddingRight: 3, borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: glass.hair2, backgroundColor: glass.fillRaised,
  },
  dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  status: { flex: 1, minWidth: 0, paddingVertical: 4 },
  label: { color: colors.text, fontSize: 12, fontWeight: "600" },
  errorLabel: { color: colors.danger, fontSize: 12, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  button: { minHeight: 44, minWidth: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  muteButton: { backgroundColor: glass.quiet },
  buttonText: { color: colors.text, fontSize: 12, fontWeight: "600" },
  endText: { color: colors.danger, fontSize: 12, fontWeight: "600" },
});
