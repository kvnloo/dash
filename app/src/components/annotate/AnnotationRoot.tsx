// Annotation mode: draw over whatever screen is showing, talk, and send it to the
// agent as one message (composited screenshot + strokes JSON + marked transcript).
//
// Entry: Options → Annotate, the UI pill, or an S Pen side-button press. Pen contact alone never enters.
// No page-global long press: row holds keep their own actions. The tray, frame
// and preview are siblings outside it so a thumb on the mic never cancels the pen.

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BackHandler, Image, PixelRatio, Platform, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { requireOptionalNativeModule } from "expo-modules-core";
import Animated, { Easing, ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { debugNavigationRef } from "../../debug/nav";
import { haptic } from "../../haptics";
import { annotationDoc, annotationSendMode, attachmentNames, composeMessage } from "../../lib/annotate/compose";
import { uploadBytes } from "../../lib/annotate/io";
import { useRecordedSpeech } from "../../lib/useRecordedSpeech";
import { appendInkSample, pointerKind, pressureOf, routePointer } from "../../lib/annotate/pointer";
import { subscribeStylusButton, type StylusButtonSource } from "../../lib/stylus-mode";
import { recognizeShape, type InkColor, type PointerKind, type StrokePoint, type Tool } from "../../lib/annotate/strokes";
import { useHandedness } from "../../lib/useHandedness";
import {
  addSegment, annotate, clearStrokes, commitStroke, currentSink, enterAnnotation, eraseStrokes, exitAnnotation, finishSend,
  setAnnotationStatus, setColor, setPenMode, setRecording, setTool, undoStroke, stylusButton,
} from "../../store/annotate";
import { store } from "../../store/app";
import { colors, radius, space, type } from "../../theme";
import { PressScale } from "../PressScale";
import { targetsAt } from "./hit-test";
import { loadSkia } from "./skia-ready";
import { useContinuousVoice } from "../ContinuousVoiceRoot";

export const INK: Record<InkColor, string> = { accent: colors.accent, red: "#f0503c" };
/** Strokes whose extent is under this many points are taps (e.g. a pen double-tap). */
const MIN_EXTENT = 6;
// Queue preview can reach 192dp, plus 44dp controls, 8dp wrapper and 24dp
// closed keyboard pad. Leave another 12dp clear of the input, including on IME.
const COMPOSER_CLEARANCE = 280;

function composerAvoidance(keyboardLift: number): number {
  "worklet";
  return COMPOSER_CLEARANCE + Math.max(0, keyboardLift);
}

type InkModule = typeof import("./InkCanvas");
let inkModule: Promise<InkModule> | undefined;
function loadInk(): Promise<InkModule> {
  // Synchronous require keeps InkCanvas in the main bundle: Metro's lazy split-chunk URL 404s behind the turbo relay.
  inkModule ??= loadSkia().then(() => require("./InkCanvas") as InkModule).catch(error => { inkModule = undefined; throw error; });
  return inkModule;
}

class InkBoundary extends Component<{ children: ReactNode; onError(error: Error): void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { this.props.onError(error); }
  override render() { return this.state.failed ? null : this.props.children; }
}

export function AnnotationRoot({ children }: { children: ReactNode }): React.JSX.Element {
  const active = annotate.use(s => s.active);
  const penMode = annotate.use(s => s.penMode);
  const tool = annotate.use(s => s.tool);
  const color = annotate.use(s => s.color);
  const strokes = annotate.use(s => s.drawing.strokes);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const [ink, setInk] = useState<InkModule | null>(null);
  const [inkError, setInkError] = useState<string>();
  const captureTarget = useRef<View>(null);

  useEffect(() => {
    // DashStylus is unavailable in Expo Go and older APKs; manual mode still works.
    if (Platform.OS !== "android") return;
    try {
      return subscribeStylusButton(requireOptionalNativeModule<StylusButtonSource>("DashStylus"), stylusButton);
    } catch {
      // Optional native-module lookup can fail on incompatible dev clients.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" || !active) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // State can change before React removes the subscription.
      if (!annotate.get().active) return false;
      exitAnnotation();
      return true;
    });
    return () => subscription.remove();
  }, [active]);

  const live = useSharedValue<number[]>([]);
  const activeSv = useSharedValue(false);
  const penSv = useSharedValue(false);
  const kindSv = useSharedValue(0);
  const pointerSv = useSharedValue(-1);
  useEffect(() => { activeSv.value = active; }, [active, activeSv]);
  useEffect(() => { penSv.value = penMode; }, [penMode, penSv]);
  const inkFailed = useCallback((error: unknown) => {
    setInk(null); setInkError("Ink couldn't load. Annotation is paused; your drawing is kept.");
    if (__DEV__) console.warn("[dash-ink] unavailable", error instanceof Error ? error.message : "renderer failed");
  }, []);
  useEffect(() => { if ((active || penMode) && !ink && !inkError) void loadInk().then(setInk).catch(inkFailed); }, [active, penMode, ink, inkError, inkFailed]);

  const finish = useCallback((flat: number[], pointerType: number) => {
    const { width, height } = size;
    const s = annotate.get();
    if (!width || !height || flat.length < 8) return;
    const screenPoints: { x: number; y: number }[] = [];
    const points: StrokePoint[] = [];
    for (let i = 0; i + 3 < flat.length; i += 4) {
      const x = flat[i] ?? 0, y = flat[i + 1] ?? 0;
      screenPoints.push({ x, y });
      points.push({ x: x / width, y: y / height, p: flat[i + 2] ?? 0.5, t: flat[i + 3] ?? Date.now() });
    }
    const xs = screenPoints.map(p => p.x), ys = screenPoints.map(p => p.y);
    if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < MIN_EXTENT) return;
    if (s.tool === "eraser") { eraseStrokes(points); return; }
    const pointer: PointerKind = pointerKind(pointerType);
    const shape = s.tool === "pen" ? recognizeShape(points) : null;
    const first = points[0], last = points.at(-1);
    const shaped = shape && first && last ? [{ ...first, ...shape.from }, { ...last, ...shape.to }] : points;
    commitStroke({ tool: shape?.tool ?? s.tool, color: s.color, pointer, points: shaped, targets: targetsAt(screenPoints) });
    if (__DEV__) console.log("[dash-ink] committed", { pointer, points: shaped.length, width, height });
    haptic.select();
  }, [size]);

  const send = useCallback((keep: boolean) => { void sendAnnotation(keep, captureTarget, size); }, [size]);
  const tracePointer = useCallback((pointerType: number, touches: number) => {
    if (__DEV__) console.log("[dash-ink] raw-down", { pointer: pointerKind(pointerType), touches });
  }, []);

  const gesture = useMemo(() => {
    const draw = Gesture.Pan()
      .manualActivation(true)
      .enabled(active && !inkError)
      .onTouchesDown((e, manager) => {
        const point = e.changedTouches?.[0] ?? e.allTouches?.[0];
        // The dock rides the IME without resizing Expo Go: never swallow input touches.
        if (!point || point.y >= size.height - composerAvoidance(-keyboardHeight.value)) { manager.fail(); return; }
        const kind = pointerKind(e.pointerType);
        if (!activeSv.value || routePointer(kind, penSv.value, e.numberOfTouches) === "pass") { manager.fail(); return; }
        kindSv.value = e.pointerType; pointerSv.value = point.id;
        live.value = appendInkSample([], point.x, point.y, pressureOf(kind, undefined), Date.now());
        runOnJS(tracePointer)(e.pointerType, e.numberOfTouches);
        manager.activate();
      })
      .onTouchesMove(e => {
        const point = e.changedTouches?.find(touch => touch.id === pointerSv.value);
        if (!point || pointerSv.value < 0) return;
        live.value = appendInkSample(live.value, point.x, point.y, live.value.at(-2) ?? 0.5, Date.now());
      })
      .onUpdate(e => {
        const p = pressureOf(pointerKind(kindSv.value), e.stylusData?.pressure);
        live.value = appendInkSample(live.value, e.x, e.y, p, Date.now());
      })
      .onTouchesUp(e => {
        const point = e.changedTouches?.find(touch => touch.id === pointerSv.value);
        if (!point || pointerSv.value < 0) return;
        // Pan's final x/y may still be the last MOVE (or DOWN). Raw UP has the actual endpoint.
        const flat = appendInkSample(live.value, point.x, point.y, live.value.at(-2) ?? 0.5, Date.now());
        pointerSv.value = -1;
        runOnJS(finish)(flat, kindSv.value);
      })
      .onFinalize(() => { live.value = []; pointerSv.value = -1; });
    const penDoubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(280).enabled(active)
      .onEnd((e, success) => { if (success && e.y < size.height - composerAvoidance(-keyboardHeight.value) && pointerKind(e.pointerType) === "stylus") runOnJS(send)(false); });
    return Gesture.Simultaneous(draw, penDoubleTap);
  }, [active, penMode, inkError, finish, send, live, activeSv, penSv, kindSv, pointerSv, tracePointer, size.height, keyboardHeight]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(prev => (prev.width === width && prev.height === height ? prev : { width, height }));
    if (__DEV__) console.log("[dash-ink] bounds", { width, height, fontScale: PixelRatio.getFontScale() });
  }, []);

  // Use the same moving boundary for the frame and the finger-blocking overlay.
  const frameStyle = useAnimatedStyle(() => ({ bottom: composerAvoidance(-keyboardHeight.value) }));
  const Ink = ink?.InkCanvas;
  return (
    <View style={styles.root}>
      <GestureDetector gesture={gesture}>
        <View style={styles.root} collapsable={false} onLayout={onLayout}>
          <View ref={captureTarget} style={styles.root} collapsable={false}>{children}</View>
          {/* Freeze the app while one finger draws; in pen mode fingers must reach it to scroll. */}
          {active && !penMode && !inkError ? <Animated.View style={[StyleSheet.absoluteFill, frameStyle]} {...overlayProps} /> : null}
          {active && Ink ? <InkBoundary onError={inkFailed}><View style={StyleSheet.absoluteFill} pointerEvents="none" {...overlayProps}><Ink strokes={strokes} width={size.width} height={size.height} ink={INK} live={live} tool={tool} color={color} /></View></InkBoundary> : null}
        </View>
      </GestureDetector>
      {active ? <Animated.View pointerEvents="none" style={[styles.frame, frameStyle]} accessibilityLabel="Annotation mode on" {...overlayProps} /> : null}
      {active ? <Tray onSend={send} screenHeight={size.height} /> : <Toast screenHeight={size.height} />}
      {active && inkError ? <View style={styles.inkError}>
        <Text accessibilityRole="alert" style={styles.error}>{inkError}</Text>
        <View style={styles.row}>
          <Chip label="Retry ink" a11y="Retry ink renderer" onPress={() => setInkError(undefined)} />
          <Chip label="Exit" a11y="Exit annotation" onPress={exitAnnotation} />
        </View>
      </View> : null}
    </View>
  );
}

const overlayProps = { testID: "annotation-overlay" };

// Dev-only web hook so a browser harness can feed transcript segments when host STT is unavailable.
if (__DEV__ && typeof window !== "undefined") Reflect.set(window, "__dashAnnotate", { addSegment, annotate, enterAnnotation });

async function sendAnnotation(keep: boolean, target: React.RefObject<View | null>, size: { width: number; height: number }): Promise<void> {
  const s = annotate.get();
  if (s.status === "capturing" || s.status === "sending") return;
  const strokes = s.drawing.strokes;
  if (strokes.length === 0) { setAnnotationStatus("error", { error: "Draw something first." }); return; }
  const sink = currentSink();
  const settings = store.get().settings;
  if (!sink) { setAnnotationStatus("error", { error: "Open a chat or a voice session to send." }); return; }
  if (!settings) { setAnnotationStatus("error", { error: "Pair with your computer to send." }); return; }
  setAnnotationStatus("capturing");
  try {
    const route = debugNavigationRef.isReady() ? debugNavigationRef.getCurrentRoute() : undefined;
    const screen = { id: route?.key ?? "unknown", route: route?.name ?? "unknown", width: Math.round(size.width), height: Math.round(size.height) };
    const createdAt = Date.now();
    const { composite } = await loadInk();
    const { bytes, dataUri } = await composite(target, strokes, screen, INK, colors.bg);
    const text = composeMessage({ strokes, segments: s.segments, screen });
    setAnnotationStatus("sending", { preview: { image: dataUri, text, strokes: strokes.length } });
    const names = attachmentNames(createdAt);
    const doc = annotationDoc({ strokes, segments: s.segments, screen, createdAt });
    const [image, json] = await Promise.all([
      uploadBytes(settings, names.image, "image/png", bytes),
      uploadBytes(settings, names.json, "application/json", new TextEncoder().encode(JSON.stringify(doc, null, 1))),
    ]);
    await sink.send(text, [image, json], annotationSendMode(sink.steerable()));
    haptic.success();
    finishSend(keep, { strokes, segments: s.segments });
  } catch (error) {
    setAnnotationStatus("error", { error: error instanceof Error ? error.message : "Could not send the annotation." });
  }
}

const TOOLS: { id: Tool; label: string; a11y: string }[] = [
  { id: "pen", label: "Pen", a11y: "Pen" },
  { id: "highlighter", label: "Hi", a11y: "Highlighter" },
  { id: "arrow", label: "→", a11y: "Arrow" },
  { id: "box", label: "▢", a11y: "Box" },
  { id: "circle", label: "◯", a11y: "Circle" },
  { id: "eraser", label: "Erase", a11y: "Eraser" },
];

/** Clip every annotation surface to the area above the lifted composer.
 * The pane scrolls when 390/412dp wrapping or a preview exceeds that space.
 */
function TrayViewport({ children, atTop, screenHeight }: { children: ReactNode; atTop: boolean; screenHeight: number }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const progress = useSharedValue(atTop ? 0 : 1);
  const trayHeight = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(atTop ? 0 : 1, {
      duration: 110, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System,
    });
  }, [atTop, progress]);
  const clearDock = useAnimatedStyle(() => ({ bottom: composerAvoidance(-keyboardHeight.value) }));
  const placement = useAnimatedStyle(() => {
    const room = Math.max(0, screenHeight - insets.top - space.sm - composerAvoidance(-keyboardHeight.value));
    return { transform: [{ translateY: Math.max(0, room - trayHeight.value) * progress.value }] };
  });
  return (
    <Animated.View pointerEvents="box-none" style={[styles.trayViewport, { top: insets.top + space.sm }, clearDock]} {...overlayProps}>
      <Animated.ScrollView testID="annotation-tray" bounces={false} showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always" style={[styles.tray, placement]} contentContainerStyle={styles.trayContent}
        onLayout={e => { trayHeight.value = e.nativeEvent.layout.height; }}>
        {children}
      </Animated.ScrollView>
    </Animated.View>
  );
}

function Tray({ onSend, screenHeight }: { onSend(keep: boolean): void; screenHeight: number }): React.JSX.Element {
  const thumb = useHandedness();
  const s = annotate.use(x => x);
  const busy = s.status === "capturing" || s.status === "sending";
  const count = s.drawing.strokes.length;
  // The tray can hop to the top so it never hides the part of the screen being marked.
  const [top, setTop] = useState(true);
  return (
    <TrayViewport atTop={top} screenHeight={screenHeight}>
      {s.preview && busy ? <Preview image={s.preview.image} text={s.preview.text} label={s.status === "capturing" ? "Capturing…" : `Sending to ${s.sink ?? "chat"}…`} /> : null}
      {s.status === "error" && s.error ? <Text accessibilityRole="alert" style={styles.error}>{s.error}</Text> : null}
      <View style={[styles.row, thumb.row]}>
        {TOOLS.map(t => <Chip key={t.id} label={t.label} a11y={t.a11y} selected={s.tool === t.id} onPress={() => setTool(t.id)} />)}
        <Swatch color="accent" selected={s.color === "accent"} />
        <Swatch color="red" selected={s.color === "red"} />
      </View>
      <View style={[styles.row, thumb.row]}>
        <Chip label="Exit" a11y="Exit annotation" onPress={exitAnnotation} />
        <Chip label="Undo" a11y="Undo" disabled={s.drawing.past.length === 0} onPress={undoStroke} />
        <Chip label="Clear" a11y="Clear" disabled={count === 0} onPress={clearStrokes} />
        <Chip label={s.penMode ? "S Pen ✓" : "S Pen"} a11y="Pen mode: only the S Pen draws, fingers scroll" selected={s.penMode} onPress={() => setPenMode(!s.penMode)} />
        <HoldToTalk />
        <Chip label="⇅" a11y={top ? "Move tray to the bottom" : "Move tray to the top"} onPress={() => setTop(!top)} />
        <Chip label="Keep" a11y="Send and keep drawing" disabled={busy || count === 0} onPress={() => onSend(true)} />
        <Chip label={busy ? "…" : "Send"} a11y="Send annotation" primary disabled={busy || count === 0} onPress={() => onSend(false)} />
      </View>
      <Text style={styles.hint} numberOfLines={1}>{s.sink ? `→ ${s.sink}` : "Open a chat to send"} · {s.segments.length ? `${s.segments.length} spoken` : "hold Talk to speak"}{s.penMode ? " · fingers scroll" : ""}</Text>
    </TrayViewport>
  );
}

function Toast({ screenHeight }: { screenHeight: number }): React.JSX.Element | null {
  const s = annotate.use(x => x);
  useEffect(() => {
    if (s.status !== "sent") return;
    const id = setTimeout(() => setAnnotationStatus("idle"), 3500);
    return () => clearTimeout(id);
  }, [s.status]);
  if (s.status !== "sent" || !s.preview) return null;
  return <TrayViewport atTop screenHeight={screenHeight}><Preview image={s.preview.image} text={s.preview.text} label={`Sent to ${s.sink ?? "chat"} · ${s.preview.strokes} strokes`} /></TrayViewport>;
}

function Preview({ image, text, label }: { image: string; text: string; label: string }): React.JSX.Element {
  return (
    <View style={styles.preview} accessibilityLabel={`Annotation preview. ${label}`}>
      <Image source={{ uri: image }} style={styles.thumb} resizeMode="cover" />
      <View style={styles.previewBody}>
        <Text style={styles.previewLabel}>{label}</Text>
        <Text style={styles.previewText} numberOfLines={5}>{text}</Text>
      </View>
    </View>
  );
}

function Chip({ label, a11y, selected, primary, disabled, onPress }: { label: string; a11y: string; selected?: boolean; primary?: boolean; disabled?: boolean; onPress(): void }): React.JSX.Element {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ selected: selected === true, disabled: disabled === true }} disabled={disabled}
      onPress={() => { haptic.select(); onPress(); }} style={[styles.chip, selected && styles.chipOn, primary && styles.primary, disabled && styles.disabled]}>
      <Text style={[styles.chipText, (selected || primary) && styles.chipTextOn]}>{label}</Text>
    </PressScale>
  );
}

function Swatch({ color, selected }: { color: InkColor; selected: boolean }): React.JSX.Element {
  return (
    <PressScale accessibilityRole="radio" accessibilityLabel={color === "red" ? "Red ink" : "Accent ink"} accessibilityState={{ checked: selected }} onPress={() => setColor(color)} style={styles.chip}>
      <View style={[styles.swatch, { backgroundColor: INK[color] }, selected && styles.swatchOn]} />
    </PressScale>
  );
}

/** Hold to talk: the bridge transcribes the clip; the segment's time span aligns strokes. */
function HoldToTalk(): React.JSX.Element {
  const voice = useContinuousVoice();
  const liveVoice = !["idle", "error"].includes(voice.state.phase);
  const speech = useRecordedSpeech("annotation", (text, start, end) => addSegment({ id: `mic-${start}`, text, start, end, source: "mic" }));
  const recording = speech.state.phase === "recording";
  const busy = speech.state.phase === "transcribing";
  useEffect(() => { setRecording(recording); return () => setRecording(false); }, [recording]);
  return (
    <View>
    <PressScale accessibilityRole="button" accessibilityLabel={liveVoice ? "Continuous voice is active" : "Hold to talk"} disabled={liveVoice} accessibilityState={{ selected: recording, disabled: liveVoice }}
      onPressIn={() => { if (!busy) void speech.begin(); }} onPressOut={() => void speech.end()} style={[styles.chip, recording && styles.recording]}>
      <Text style={[styles.chipText, recording && styles.chipTextOn]}>{liveVoice ? "Live mic" : recording ? "● Talk" : busy ? "Transcribing…" : "Talk"}</Text>
    </PressScale>
    {speech.state.note && speech.state.phase === "error" ? <Text accessibilityRole="alert" style={styles.error}>{speech.state.note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inkError: { position: "absolute", top: 80, left: 12, right: 12, padding: 8, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm },
  frame: { position: "absolute", top: 0, left: 0, right: 0, borderWidth: 2, borderColor: colors.accent, borderRadius: 2 },
  trayViewport: { position: "absolute", left: space.xs, right: space.xs, overflow: "hidden" },
  tray: { flexGrow: 0, flexShrink: 1, maxHeight: "100%", borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.hair },
  trayContent: { padding: space.xs, gap: 2 },
  row: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 2 },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 6, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: colors.goldLo },
  primary: { backgroundColor: colors.accent, paddingHorizontal: space.sm },
  recording: { backgroundColor: "#f0503c" },
  disabled: { opacity: 0.4 },
  chipText: { ...type.mono, color: colors.textMuted },
  chipTextOn: { color: colors.bg },
  swatch: { width: 18, height: 18, borderRadius: 9 },
  swatchOn: { borderWidth: 2, borderColor: colors.text },
  hint: { ...type.mono, fontSize: 10, color: colors.textTertiary, paddingHorizontal: space.sm },
  error: { ...type.small, color: colors.danger, paddingHorizontal: space.sm },
  preview: { flexDirection: "row", gap: space.sm, padding: space.xs, marginBottom: space.xs, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised },
  thumb: { width: 72, height: 160, borderRadius: radius.sm, backgroundColor: colors.bg },
  previewBody: { flex: 1, gap: 2 },
  previewLabel: { ...type.label, color: colors.accent },
  previewText: { ...type.mono, fontSize: 10, color: colors.text },
});
