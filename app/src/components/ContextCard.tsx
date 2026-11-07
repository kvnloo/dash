import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { compactionResult, compactionUnavailable, contextTone, parseContext, record, tokenLabel, type ContextSnapshot, type PlanUsage } from "../../../shared/context";
import { GRID_COLS, GRID_ROWS, gridSummary, peekSummary, percentLabel, planContextGrid, type ContextGridPlan, type GridKind } from "../../../shared/context-grid";
import type { Settings } from "../model";
import { haptic } from "../haptics";
import { dismissKeyboard } from "../lib/dismiss-keyboard";
import { followAnchor, measureAnchor, settledAnchor, type AnchorRect } from "../lib/anchor";
import { fetchContextView } from "../lib/context-api";
import { executionToken } from "../lib/bridge-auth";
import { colors, glass, radius, space, type } from "../theme";
import { PressScale } from "./PressScale";
import { GlassSurface } from "./GlassSurface";

export const CATEGORY_COLORS: Record<string, string> = { system: "#b396de", tools: "#64caa8", skills: "#e4ae62", memory: "#d583ad", messages: "#729cdd", reserved: "#686c79", free: "#292d37" };
function endpoint(settings: Settings, profile: string, session: string, compact = false, harness = "hermes"): string {
  return `http://${settings.address}/chat/context${compact ? "/compact" : ""}?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}&harness=${encodeURIComponent(harness)}`;
}
export function useContextView(settings: Settings | null, online: boolean, harness: string, profile?: string, session?: string, busy = false) {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [sample, setSample] = useState<{ key: string; snapshot?: ContextSnapshot; plans: PlanUsage[]; compactionSupported: boolean }>();
  const [phase, setPhase] = useState<"idle" | "waiting" | "summarizing">("idle");
  const [notice, setNotice] = useState("");
  /** Host answered that it does not carry compaction: the control stays visibly unavailable for this host. */
  const [unsupportedHost, setUnsupportedHost] = useState<string>();
  const key = `${settings?.address}\0${profile}\0${session}\0${harness}\0${settings?.identity?.credentialId}`;
  const identity = useRef(key);
  identity.current = key;
  const pending = useRef(false);
  /** The gauge view, so the peek and the open card can be placed on it. */
  const gaugeRef = useRef<View>(null);
  const snapshot = sample?.key === key ? sample.snapshot : undefined;
  const plans = sample?.key === key ? sample.plans : [];
  useEffect(() => { setOpen(false); setNotice(""); setPhase("idle"); pending.current = false; }, [key]);
  useEffect(() => {
    if (!settings || !online || !session) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const poll = async () => {
      if (disposed) return;
      if (AppState.currentState !== "background" && AppState.currentState !== "inactive") {
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 20_000);
        try {
          setReading(true);
          const value = await fetchContextView(settings, harness, profile ?? "default", session, controller.signal, usage && open);
          if (!disposed) { setSample({ key, snapshot: value.context, plans: value.plans, compactionSupported: value.compactionSupported }); setError(""); }
        } catch (cause) { if (!disposed) { setSample(undefined); setError(cause instanceof Error ? cause.message : "Context reading unavailable."); } }
        finally { clearTimeout(timeout); if (!disposed) setReading(false); }
      }
      if (!disposed) timer = setTimeout(poll, open ? 5000 : 30_000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [key, online, open, usage, settings?.token]);
  useEffect(() => { if (phase === "waiting" && !busy) setPhase("summarizing"); }, [busy, phase]);
  const compact = useCallback(async () => {
    if (!settings || !session || !snapshot || !online || harness !== "hermes" || pending.current || sample?.key !== key || !sample.compactionSupported || unsupportedHost === settings.address) return;
    pending.current = true;
    const startKey = key;
    setPhase(busy ? "waiting" : "summarizing");
    setNotice("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 260_000);
    try {
      const response = await fetch(endpoint(settings, profile ?? "default", session, true), { method: "POST", headers: { Authorization: `Bearer ${await executionToken(settings)}` }, signal: controller.signal });
      const value: unknown = await response.json();
      if (identity.current !== startKey) return;
      if (compactionUnavailable(response.status, value)) { setUnsupportedHost(settings.address); setNotice("Compaction is not available on this host"); return; }
      if (identity.current !== startKey) return;
      const after = record(value) ? parseContext(value.context) : undefined;
      if (after) setSample({ key, snapshot: after, plans, compactionSupported: true });
      if (!response.ok || !record(value) || value.ok !== true) throw new Error("Compaction not confirmed. Check the session before retrying.");
      const freed = after ? compactionResult(snapshot, after) : undefined;
      setNotice(freed !== undefined ? `Freed ~${tokenLabel(freed)} tokens` : value.code === "noop" ? "No messages needed compaction" : "Compaction finished; savings not yet verified");
    } catch (error) { if (identity.current === startKey) setNotice(error instanceof Error && error.message.startsWith("Compaction") ? error.message : "Outcome unknown. Check the session before retrying."); }
    finally { clearTimeout(timeout); if (identity.current === startKey) { pending.current = false; setPhase("idle"); } }
  }, [key, settings, session, profile, snapshot, online, harness, busy, plans, sample, unsupportedHost]);
  return { open, usage, gaugeRef, close: () => setOpen(false), showUsage: () => { Keyboard.dismiss(); setUsage(true); setOpen(true); }, toggle: () => { Keyboard.dismiss(); setUsage(false); setOpen(v => !v); }, snapshot, plans, phase, notice,
    reading, error: !online ? "Computer offline. Live usage is unknown." : !session ? "No attached session yet. Context usage is unknown." : error,
    compact, canCompact: online && harness === "hermes" && Boolean(snapshot) && phase === "idle" && sample?.key === key && sample.compactionSupported && unsupportedHost !== settings?.address,
    compactUnavailable: sample?.key !== key || !sample.compactionSupported || unsupportedHost === settings?.address };

}
export type ContextControl = ReturnType<typeof useContextView>;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const categoryColor = (id: string): string => CATEGORY_COLORS[id] ?? colors.gold;
/** The outline of a free cell: quiet, but still a cell on the dark card. */
const FREE_OUTLINE = colors.textFaint;

/** The "peek" grid: 7 px cells, 1 px apart. */
const PEEK_CELL = 7;
const PEEK_GAP = 1;
const PEEK_PAD = space.md;
const PEEK_GRID_W = GRID_COLS * PEEK_CELL + (GRID_COLS - 1) * PEEK_GAP;
const PEEK_GRID_H = GRID_ROWS * PEEK_CELL + (GRID_ROWS - 1) * PEEK_GAP;
const PEEK_LINE_H = 16;
const PEEK_W = PEEK_GRID_W + PEEK_PAD * 2;
const PEEK_H = PEEK_GRID_H + PEEK_LINE_H + space.sm + PEEK_PAD * 2;
/** Space kept between the gauge and the popup that sits on it. */
const ANCHOR_GAP = 8;
const EDGE = 12;

/** The gauge as the screen reader and the army know it. */
function gaugeState(s: ContextSnapshot | undefined): { label: string; percent: number; color: string } {
  const percent = s && s.maximum ? Math.min(1, s.used / s.maximum) : 0;
  const tone = s ? contextTone(s) : "normal";
  return { percent, color: tone === "red" ? colors.danger : tone === "amber" ? colors.warn : colors.gold, label: `Context window${s?.maximum ? `, approximately ${Math.round(percent * 100)} percent` : ", unavailable"}` };
}
function GaugeRing({ percent, color }: { percent: number; color: string }) {
  return <Svg width={22} height={22} viewBox="0 0 22 22"><Circle cx={11} cy={11} r={8} stroke={colors.hair} strokeWidth={2.5} fill="none" /><Circle cx={11} cy={11} r={8} stroke={color} strokeWidth={2.5} fill="none" strokeDasharray={`${percent * 50.265} 50.265`} transform="rotate(-90 11 11)" /></Svg>;
}

/**
 * One grid cell, drawn in an <Svg>: filled for a category, outlined for free space, an outlined
 * and crossed cell in the warning colour for the auto-compact buffer. The same shapes are the legend glyphs.
 */
function CellShape({ kind, color, x, y, width, height, dim }: { kind: GridKind; color: string; x: number; y: number; width: number; height: number; dim?: boolean }) {
  const rx = Math.min(2, Math.min(width, height) / 4);
  const opacity = dim ? .28 : 1;
  if (kind === "category") return <Rect x={x} y={y} width={width} height={height} rx={rx} fill={color} opacity={opacity} />;
  if (kind === "free") return <Rect x={x + .5} y={y + .5} width={width - 1} height={height - 1} rx={rx} fill="none" stroke={FREE_OUTLINE} strokeWidth={1} opacity={opacity} />;
  // Square corners and a thin cross: at 7 px a rounded outline plus a cross reads as a ring.
  const inset = Math.max(1.25, Math.min(width, height) * .22);
  return <>
    <Rect x={x + .5} y={y + .5} width={width - 1} height={height - 1} rx={Math.min(rx, 1)} fill="none" stroke={colors.warn} strokeWidth={1} opacity={opacity} />
    <Path d={`M${x + inset} ${y + inset}L${x + width - inset} ${y + height - inset}M${x + width - inset} ${y + inset}L${x + inset} ${y + height - inset}`} stroke={colors.warn} strokeWidth={1} opacity={opacity} />
  </>;
}
/** The legend swatch: the cell the row is drawn with on the grid. */
function CellGlyph({ kind, color, size = 10 }: { kind: GridKind; color: string; size?: number }) {
  return <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}><CellShape kind={kind} color={color} x={0} y={0} width={size} height={size} /></Svg>;
}
/** The 20 x 10 grid. Cells are `cellWidth` wide and `cellHeight` tall; `dimExcept` fades every other category. */
function ContextGrid({ plan, cellWidth, cellHeight, gap, dimExcept, label }: { plan: ContextGridPlan; cellWidth: number; cellHeight: number; gap: number; dimExcept?: string; label: string }) {
  const width = GRID_COLS * cellWidth + (GRID_COLS - 1) * gap;
  const height = GRID_ROWS * cellHeight + (GRID_ROWS - 1) * gap;
  return <View accessibilityRole="image" accessibilityLabel={label} aria-valuetext={gridSummary(plan)} style={{ width, height }}>
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {plan.cells.map((cell, index) => <CellShape key={index} kind={cell.kind} color={categoryColor(cell.id)} x={index % GRID_COLS * (cellWidth + gap)} y={Math.floor(index / GRID_COLS) * (cellHeight + gap)} width={cellWidth} height={cellHeight} dim={dimExcept !== undefined && !(cell.kind === "category" && cell.id === dimExcept)} />)}
    </Svg>
  </View>;
}
/** The card's grid: the full width of the card, square cells up to a row height that keeps the card short. */
function FullGrid({ plan, dimExcept }: { plan: ContextGridPlan; dimExcept?: string }) {
  const [width, setWidth] = useState(0);
  const gap = 2;
  const cellWidth = width > 0 ? (width - gap * (GRID_COLS - 1)) / GRID_COLS : 0;
  return <View style={styles.fullGrid} onLayout={(event: LayoutChangeEvent) => setWidth(Math.floor(event.nativeEvent.layout.width))}>
    {cellWidth > 0 ? <ContextGrid plan={plan} cellWidth={cellWidth} cellHeight={Math.min(cellWidth, 12)} gap={gap} dimExcept={dimExcept} label="Context grid" /> : null}
  </View>;
}

/**
 * Where the Modal's own overlay is on screen. An anchor is a screen rectangle; the popup is placed in
 * the overlay, which edge-to-edge Modals and the navigation bar do not start at (0, 0) of the window.
 * The same reading AttachmentChooser takes, from the same anchoring primitive.
 */
function useOverlayFrame() {
  const overlay = useRef<View>(null);
  const [frame, setFrame] = useState<{ x: number; y: number; height: number } | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    void measureAnchor(overlay.current).then(rect => setFrame({ x: rect?.x ?? 0, y: rect?.y ?? 0, height }));
  }, []);
  return { overlay, frame, onLayout };
}
/** The gauge's screen rectangle while `active`: taken once it has stopped moving, then followed. */
function useGaugeRect(control: ContextControl, active: boolean): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null);
  const gauge = control.gaugeRef;
  useEffect(() => {
    if (!active) { setRect(null); return; }
    let live = true;
    let stop: (() => void) | undefined;
    void settledAnchor(() => gauge.current, () => live).then(first => {
      if (!live || !first) return;
      setRect(first);
      stop = followAnchor(() => gauge.current, first, next => { if (live) setRect(next); });
    });
    return () => { live = false; stop?.(); };
  }, [active, gauge]);
  return rect;
}

export function ContextGauge({ control }: { control: ContextControl }) {
  const { label, percent, color } = gaugeState(control.snapshot);
  const [peek, setPeek] = useState<AnchorRect | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  // A long press needs the keyboard out of the way first: the composer dock moves with it, and the peek sits on the gauge.
  const openPeek = useCallback(async () => {
    haptic.select();
    const id = ++request.current;
    await dismissKeyboard();
    if (id !== request.current) return;
    const rect = await settledAnchor(() => control.gaugeRef.current, () => id === request.current);
    if (rect && id === request.current) setPeek(rect);
  }, [control.gaugeRef]);
  const closePeek = useCallback(() => { request.current++; setPeek(null); }, []);
  const peeking = peek !== null;
  useEffect(() => {
    if (!peek) return;
    return followAnchor(() => control.gaugeRef.current, peek, setPeek);
  }, [peeking]);
  useEffect(() => { if (control.open) closePeek(); }, [control.open, closePeek]);
  // While the card is open its own copy of the gauge sits above the scrim (see ContextSheet), and this one steps out of the accessibility tree.
  return <>
    <View ref={control.gaugeRef} collapsable={false}>
      <PressScale aria-hidden={control.open} accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Hold for a context grid" accessibilityState={{ expanded: control.open }} onPress={control.toggle} onLongPress={() => void openPeek()} delayLongPress={350} style={styles.gauge}>
        <GaugeRing percent={percent} color={color} />
      </PressScale>
    </View>
    {peek ? <ContextPeek anchor={peek} snapshot={control.snapshot} onClose={closePeek} onOpen={() => { closePeek(); control.toggle(); }} /> : null}
  </>;
}

/** The small grid that a long press on the gauge opens: on the gauge, tap it for the full card, tap anywhere else to dismiss. */
function ContextPeek({ anchor, snapshot, onClose, onOpen }: { anchor: AnchorRect; snapshot: ContextSnapshot | undefined; onClose(): void; onOpen(): void }) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { overlay, frame, onLayout } = useOverlayFrame();
  const plan = useMemo(() => planContextGrid(snapshot), [snapshot]);
  const measuredWindow = useRef({ width: window.width, height: window.height });
  // iOS cannot present the card over a Modal controller that is still being dismissed: hand over in onDismiss.
  const [handoff, setHandoff] = useState(false);
  useEffect(() => {
    if (window.width !== measuredWindow.current.width || window.height !== measuredWindow.current.height) onClose();
  }, [window.width, window.height, onClose]);
  const open = () => { if (Platform.OS === "ios") setHandoff(true); else onOpen(); };
  const overlayHeight = frame?.height ?? window.height;
  const gaugeTop = anchor.y - (frame?.y ?? 0);
  const gaugeCentre = anchor.x - (frame?.x ?? 0) + anchor.width / 2;
  const left = clamp(gaugeCentre - PEEK_W / 2, insets.left + EDGE, window.width - insets.right - PEEK_W - EDGE);
  const bottom = clamp(overlayHeight - gaugeTop + ANCHOR_GAP, insets.bottom + EDGE, overlayHeight - PEEK_H - insets.top - EDGE);
  return <Modal transparent visible={!handoff} animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onDismiss={() => { if (handoff) onOpen(); }}>
    <View ref={overlay} collapsable={false} style={styles.peekOverlay} onLayout={onLayout}>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss context preview" onPress={onClose} style={StyleSheet.absoluteFill} />
      {frame ? <GlassSurface testID="context-grid-peek" variant="raised" borderRadius={radius.md} style={[styles.peek, { left, bottom, width: PEEK_W, height: PEEK_H }]}>
        <PressScale accessibilityRole="button" accessibilityLabel="Context grid peek" accessibilityHint="Opens the context window details" aria-valuetext={peekSummary(snapshot)} onPress={open} style={{ width: PEEK_W, height: PEEK_H, gap: space.sm }}>
          <ContextGrid plan={plan} cellWidth={PEEK_CELL} cellHeight={PEEK_CELL} gap={PEEK_GAP} label="Context grid cells" />
          <Text style={styles.peekLine} numberOfLines={1}>{peekSummary(snapshot)}</Text>
        </PressScale>
      </GlassSurface> : null}
    </View>
  </Modal>;
}

function resetLabel(reset?: string): string {
  if (!reset) return "Reset time unavailable";
  const date = new Date(reset);
  const remaining = date.getTime() - Date.now();
  if (remaining > 0 && remaining < 24 * 60 * 60_000) return `Resets in ${Math.floor(remaining / 3600000)} hr ${Math.ceil(remaining % 3600000 / 60000)} min`;
  return `Resets ${date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}
export function ContextCard({ control }: { control: ContextControl }) {
  return control.open ? <ContextSheet control={control} /> : null;
}
function ContextSheet({ control }: { control: ContextControl }) {
  const window = useWindowDimensions();
  const [selected, setSelected] = useState<string>();
  const { overlay, frame, onLayout } = useOverlayFrame();
  const gauge = useGaugeRect(control, true);
  const compressing = control.phase !== "idle";
  const s = control.snapshot;
  const plan = useMemo(() => planContextGrid(s), [s]);
  const detail = s?.categories.find(c => c.id === selected);
  const gaugeLabel = gaugeState(s);
  const overlayHeight = frame?.height ?? window.height;
  // The gauge stays pressable above the scrim, so the card must not run under it.
  const clearOfGauge = gauge && frame ? 2 * (gauge.y - frame.y - ANCHOR_GAP - overlayHeight / 2) : Infinity;
  const percentOf = (line: { percent: number; tokens: number }): string => plan.free ? ` (${percentLabel(line.percent, line.tokens)})` : "";
  return <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={control.close}>
    <View ref={overlay} collapsable={false} style={styles.overlay} onLayout={onLayout}>
    <Pressable accessibilityRole="button" accessibilityLabel="Dismiss usage details" onPress={control.close} style={StyleSheet.absoluteFill} />
    <View style={[styles.card, { maxHeight: Math.max(240, Math.min(720, overlayHeight * .84, clearOfGauge)) }]} accessibilityViewIsModal accessibilityLabel={control.usage ? "Usage details" : "Context window details"}>
    <View style={styles.row}><Text style={styles.title}>{control.usage ? "/usage" : "Context window"}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close usage details" onPress={control.close} style={styles.close}><Text style={styles.title}>×</Text></Pressable></View>
    <View style={styles.row}><Text style={styles.title}>Context {s?.maximum ? `${s.estimated ? "~" : ""}${Math.round(s.used / s.maximum * 100)}%` : "unknown"}</Text><Text style={styles.meta}>{s ? `${s.estimated ? "~" : ""}${tokenLabel(s.used)} / ${s.maximum ? tokenLabel(s.maximum) : "unknown"} tokens` : "Unknown / unknown tokens"}</Text></View>
    <Text selectable style={styles.model}>Model · {s?.model ?? "Unknown"}</Text>
    {control.reading ? <Text accessibilityLiveRegion="polite" style={styles.meta}>Refreshing live reading…</Text> : null}
    {control.error ? <Text accessibilityRole="alert" style={styles.notice}>{control.error}</Text> : null}
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 9 }} keyboardShouldPersistTaps="handled">
    <FullGrid plan={plan} dimExcept={detail?.id} />
    {s ? <>
      <View style={styles.legend}>
        {plan.categories.map(c => <PressScale key={c.id} accessibilityRole="button" accessibilityLabel={`${c.label}, ${c.estimated ? "estimated " : ""}${tokenLabel(c.tokens)} tokens${plan.free ? `, ${percentLabel(c.percent, c.tokens)}` : ""}`} accessibilityState={{ selected: selected === c.id }} onPress={() => setSelected(v => v === c.id ? undefined : c.id)} style={[styles.legendItem, { opacity: selected && selected !== c.id ? .4 : 1 }]}><CellGlyph kind="category" color={categoryColor(c.id)} /><Text style={styles.legendName}>{c.label}</Text><Text style={styles.meta}>{c.estimated ? "~" : ""}{tokenLabel(c.tokens)} tokens{percentOf(c)}</Text></PressScale>)}
        {plan.free ? <View accessible accessibilityLabel={`Free space, ${tokenLabel(plan.free.tokens)} tokens, ${percentLabel(plan.free.percent, plan.free.tokens)}`} style={[styles.legendItem, { opacity: selected ? .4 : 1 }]}><CellGlyph kind="free" color={FREE_OUTLINE} /><Text style={styles.legendName}>Free space</Text><Text style={styles.meta}>{plan.free.estimated ? "~" : ""}{tokenLabel(plan.free.tokens)} tokens{percentOf(plan.free)}</Text></View> : null}
        {plan.buffer ? <View accessible accessibilityLabel={plan.bufferKnown ? `Autocompact buffer, ${tokenLabel(plan.buffer.tokens)} tokens, ${percentLabel(plan.buffer.percent, plan.buffer.tokens)}` : "Autocompact buffer, unknown"} style={[styles.legendItem, { opacity: selected ? .4 : 1 }]}><CellGlyph kind="buffer" color={colors.warn} /><Text style={styles.legendName}>Autocompact buffer</Text><Text style={styles.meta}>{plan.bufferKnown ? `~${tokenLabel(plan.buffer.tokens)} tokens${percentOf(plan.buffer)}` : "unknown"}</Text></View> : null}
      </View>
      {detail ? <View style={styles.detail}><Text style={styles.title}>{detail.label}{detail.estimated ? " · estimated" : ""}</Text>{detail.details.map(d => <View key={d.label} style={styles.row}><Text style={styles.meta}>{d.label}</Text><Text style={styles.meta}>{tokenLabel(d.tokens)}</Text></View>)}{detail.note ? <Text style={styles.meta}>{detail.note}</Text> : !detail.details.length ? <Text style={styles.meta}>Rough token count of the pinned {detail.label.toLowerCase()}.</Text> : null}</View> : null}
      <Text style={styles.provenance}>{s.source}{s.categories.length ? " · category counts estimated" : ""}</Text>
    </> : <Text style={styles.meta}>This harness has no native context snapshot. Lifetime token usage is not context occupancy.</Text>}
    {control.usage && !control.plans.length ? <Text style={styles.meta}>Account quotas and burn pace unknown. No provider reading available.</Text> : null}
    {control.usage ? control.plans.map(p => <View key={p.provider} style={styles.plan}><Text style={styles.provider}>{p.provider}</Text>{p.unavailable ? <Text style={styles.meta}>Account quota unknown · burn pace unknown</Text> : p.windows.map(w => <View key={w.label} style={styles.window}><View style={styles.row}><Text style={styles.meta}>{w.label} {Math.round(w.percent)}%</Text><Text style={styles.reset}>{resetLabel(w.resetsAt)}</Text></View><View style={styles.planBar}><View style={{ width: `${w.percent}%`, height: 3, backgroundColor: colors.gold }} /></View></View>)}{p.burn ? <Text style={styles.meta}>Burn {p.burn.observed.toFixed(2)}%/h · sustainable {p.burn.sustainable.toFixed(2)}%/h{p.burn.ratio !== undefined ? ` · ${p.burn.ratio.toFixed(2)}× pace` : ""}</Text> : !p.unavailable ? <Text style={styles.meta}>Burn pace unknown</Text> : null}</View>) : null}
    {s?.notes.map(note => <Text key={note} style={styles.provenance}>{note}</Text>)}
    </ScrollView>
    <View style={styles.footer}><Text style={[styles.meta, { flex: 1 }]}>{control.phase === "waiting" ? "Waiting for the running turn" : compressing ? "Summarizing messages" : s?.threshold ? `~${tokenLabel(Math.max(0, s.threshold - s.used))} until auto-compact` : "Auto-compact state unknown"}</Text><PressScale accessibilityRole="button" accessibilityLabel={control.compactUnavailable ? "Compaction unavailable on this host" : "Compact now"} disabled={!control.canCompact} onPress={() => void control.compact()} style={[styles.compact, !control.canCompact && { opacity: .4 }]}><Text style={styles.compactText}>{control.compactUnavailable ? "Unavailable" : "Compact now"}</Text></PressScale></View>
    {control.notice ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>{control.notice}</Text> : null}
  </View>
  {gauge && frame ? <PressScale accessibilityRole="button" accessibilityLabel={gaugeLabel.label} accessibilityHint="Closes the context window details" accessibilityState={{ expanded: true }} onPress={control.toggle} style={[styles.gaugeOnScrim, { left: gauge.x - frame.x, top: gauge.y - frame.y, width: gauge.width, height: gauge.height }]}><GaugeRing percent={gaugeLabel.percent} color={gaugeLabel.color} /></PressScale> : null}
  </View></Modal>;
}
const styles = StyleSheet.create({
  gauge: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  /** The gauge's twin in the card's Modal: same place, above the scrim, so tapping the gauge again closes the card. */
  gaugeOnScrim: { position: "absolute", alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, justifyContent: "center", padding: 16, backgroundColor: "rgba(0,0,0,.65)" },
  peekOverlay: { flex: 1 },
  peek: { position: "absolute", backgroundColor: colors.surfaceRaised },
  peekLine: { ...type.mono, fontSize: 11, lineHeight: PEEK_LINE_H, color: colors.textMuted },
  fullGrid: { alignSelf: "stretch" },
  close: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  model: { ...type.mono, fontSize: 12, color: colors.text, flexShrink: 1 },
  card: { width: "100%", maxWidth: 560, alignSelf: "center", backgroundColor: colors.bg, borderWidth: 1, borderColor: glass.hair, borderRadius: 16, padding: 14, gap: 9 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 },
  title: { ...type.small, color: colors.text }, meta: { ...type.mono, color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  legend: { gap: 0 },
  legendItem: { width: "100%", flexDirection: "row", alignItems: "center", minHeight: 30, gap: 8 },
  legendName: { ...type.small, fontSize: 12, color: colors.textMuted, flex: 1 },
  detail: { backgroundColor: glass.fill, borderRadius: 8, padding: 10, gap: 4 },
  provenance: { ...type.small, fontSize: 9, lineHeight: 12, color: colors.textTertiary },
  plan: { gap: 7 }, provider: { ...type.mono, fontSize: 10, color: colors.textTertiary }, window: { gap: 4 },
  reset: { ...type.mono, fontSize: 11, color: colors.textTertiary },
  planBar: { backgroundColor: colors.hair, height: 3, overflow: "hidden", borderRadius: 2 },
  footer: { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderColor: glass.hair, paddingTop: 7 },
  compact: { minHeight: 36, justifyContent: "center", paddingHorizontal: 10, backgroundColor: glass.fillChipOn, borderRadius: 12 },
  compactText: { ...type.small, fontSize: 11, color: colors.gold }, notice: { ...type.small, color: colors.gold },
});
