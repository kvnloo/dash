import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Animated, Easing, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { compactionResult, contextTone, parseContext, parsePlan, record, tokenLabel, type ContextSnapshot, type PlanUsage } from "../../../shared/context";
import type { Settings } from "../model";
import { MOTION_MS } from "../motion";
import { colors, glass, type } from "../theme";
import { PressScale } from "./PressScale";

export const CATEGORY_COLORS: Record<string, string> = { system: "#b396de", tools: "#64caa8", skills: "#e4ae62", memory: "#d583ad", messages: "#729cdd", reserved: "#686c79", free: "#292d37" };
function endpoint(settings: Settings, profile: string, session: string, compact = false, harness = "hermes"): string {
  return `http://${settings.address}/chat/context${compact ? "/compact" : ""}?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}&harness=${encodeURIComponent(harness)}`;
}
export function useContextView(settings: Settings | null, online: boolean, harness: string, profile?: string, session?: string, busy = false) {
  const [open, setOpen] = useState(false);
  const [sample, setSample] = useState<{ key: string; snapshot?: ContextSnapshot; plans: PlanUsage[] }>();
  const [phase, setPhase] = useState<"idle" | "waiting" | "summarizing">("idle");
  const [notice, setNotice] = useState("");
  const key = `${settings?.address}\0${profile}\0${session}\0${harness}`;
  const identity = useRef(key);
  identity.current = key;
  const pending = useRef(false);
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
          const response = await fetch(endpoint(settings, profile ?? "default", session, false, harness), { headers: { Authorization: `Bearer ${settings.token}` }, signal: controller.signal });
          const value: unknown = response.ok ? await response.json() : undefined;
          if (!disposed) {
            const parsed = record(value) ? parseContext(value.context) : undefined;
            const usage = record(value) && Array.isArray(value.plans) ? value.plans.flatMap(p => { const plan = parsePlan(p); return plan ? [plan] : []; }) : [];
            setSample({ key, snapshot: parsed, plans: usage });
          }
        } catch { if (!disposed) setSample(undefined); }
        finally { clearTimeout(timeout); }
      }
      if (!disposed) timer = setTimeout(poll, open ? 5000 : 30_000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [key, online, open, settings?.token]);
  useEffect(() => { if (phase === "waiting" && !busy) setPhase("summarizing"); }, [busy, phase]);
  const compact = useCallback(async () => {
    if (!settings || !session || !snapshot || !online || harness !== "hermes" || pending.current) return;
    pending.current = true;
    const startKey = key;
    setPhase(busy ? "waiting" : "summarizing");
    setNotice("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 260_000);
    try {
      const response = await fetch(endpoint(settings, profile ?? "default", session, true), { method: "POST", headers: { Authorization: `Bearer ${settings.token}` }, signal: controller.signal });
      const value: unknown = await response.json();
      if (identity.current !== startKey) return;
      const after = record(value) ? parseContext(value.context) : undefined;
      if (after) setSample({ key, snapshot: after, plans });
      if (!response.ok || !record(value) || value.ok !== true) throw new Error("Compaction not confirmed. Check the session before retrying.");
      const freed = after ? compactionResult(snapshot, after) : undefined;
      setNotice(freed !== undefined ? `Freed ~${tokenLabel(freed)} tokens` : value.code === "noop" ? "No messages needed compaction" : "Compaction finished; savings not yet verified");
    } catch (error) { if (identity.current === startKey) setNotice(error instanceof Error && error.message.startsWith("Compaction") ? error.message : "Outcome unknown. Check the session before retrying."); }
    finally { clearTimeout(timeout); if (identity.current === startKey) { pending.current = false; setPhase("idle"); } }
  }, [key, settings, session, profile, snapshot, online, harness, busy, plans]);
  return { open, toggle: () => setOpen(v => !v), snapshot, plans, phase, notice, compact, canCompact: online && harness === "hermes" && Boolean(snapshot) && phase === "idle" };
}
export type ContextControl = ReturnType<typeof useContextView>;
export function ContextGauge({ control }: { control: ContextControl }) {
  const s = control.snapshot;
  const percent = s && s.maximum ? Math.min(1, s.used / s.maximum) : 0;
  const tone = s ? contextTone(s) : "normal";
  const color = tone === "red" ? colors.danger : tone === "amber" ? colors.warn : colors.gold;
  return <PressScale accessibilityRole="button" accessibilityLabel={`Context window${s?.maximum ? `, approximately ${Math.round(percent * 100)} percent` : ", unavailable"}`} accessibilityState={{ expanded: control.open }} onPress={control.toggle} style={styles.gauge}>
    <Svg width={22} height={22} viewBox="0 0 22 22"><Circle cx={11} cy={11} r={8} stroke={colors.hair} strokeWidth={2.5} fill="none" /><Circle cx={11} cy={11} r={8} stroke={color} strokeWidth={2.5} fill="none" strokeDasharray={`${percent * 50.265} 50.265`} transform="rotate(-90 11 11)" /></Svg>
  </PressScale>;
}
function resetLabel(reset?: string): string {
  if (!reset) return "Reset time unavailable";
  const date = new Date(reset);
  const remaining = date.getTime() - Date.now();
  if (remaining > 0 && remaining < 24 * 60 * 60_000) return `Resets in ${Math.floor(remaining / 3600000)} hr ${Math.ceil(remaining % 3600000 / 60000)} min`;
  return `Resets ${date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}
export function ContextCard({ control }: { control: ContextControl }) {
  const { height } = useWindowDimensions();
  const [selected, setSelected] = useState<string>();
  const opacity = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(.3)).current;
  useEffect(() => { Animated.timing(opacity, { toValue: control.open ? 1 : 0, duration: MOTION_MS.exit, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start(); }, [control.open, opacity]);
  const compressing = control.phase !== "idle";
  useEffect(() => {
    if (!compressing) { pulse.setValue(1); return; }
    const animation = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: .25, duration: MOTION_MS.enter, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== "web" }), Animated.timing(pulse, { toValue: 1, duration: MOTION_MS.enter, easing: Easing.inOut(Easing.cubic), useNativeDriver: Platform.OS !== "web" })]));
    animation.start(); return () => animation.stop();
  }, [compressing, pulse]);
  if (!control.open) return null;
  const s = control.snapshot;
  const detail = s?.categories.find(c => c.id === selected);
  const total = s?.categories.reduce((n, c) => n + c.tokens, 0) || 1;
  return <Animated.View style={[styles.card, { opacity, maxHeight: Math.min(560, height * .62) }]} accessibilityLabel="Context window details">
    <View style={styles.row}><Text style={styles.title}>Context {s?.maximum ? `~${Math.round(s.used / s.maximum * 100)}%` : "unavailable"}</Text><Text style={styles.meta}>{s ? `~${tokenLabel(s.used)} of ~${s.maximum ? tokenLabel(s.maximum) : "unknown"}` : "No native reading"}</Text></View>
    <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 9 }} keyboardShouldPersistTaps="handled">
    {s ? <>
      <View style={styles.bar}>{s.categories.map(c => <View key={c.id} accessibilityLabel={`${c.label} segment`} style={{ flex: c.tokens / total, flexDirection: "row", gap: 1, backgroundColor: compressing && c.id === "messages" ? "transparent" : CATEGORY_COLORS[c.id] ?? colors.gold, opacity: selected && selected !== c.id ? .2 : 1 }}>{compressing && c.id === "messages" ? Array.from({ length: 12 }, (_, index) => <Animated.View key={index} style={{ flex: 1, backgroundColor: CATEGORY_COLORS.messages, opacity: pulse, transform: [{ scaleX: pulse }] }} />) : null}</View>)}</View>
      <View style={styles.legend}>{s.categories.map(c => <PressScale key={c.id} accessibilityRole="button" accessibilityLabel={`${c.label}, ${c.estimated ? "estimated " : ""}${tokenLabel(c.tokens)} tokens`} accessibilityState={{ selected: selected === c.id }} onPress={() => setSelected(v => v === c.id ? undefined : c.id)} style={[styles.legendItem, { opacity: selected && selected !== c.id ? .4 : 1 }]}><View style={[styles.dot, { backgroundColor: CATEGORY_COLORS[c.id] ?? colors.gold }]} /><Text style={styles.legendName}>{c.label}</Text><Text style={styles.meta}>{c.estimated ? "~" : ""}{tokenLabel(c.tokens)}</Text></PressScale>)}</View>
      {detail ? <View style={styles.detail}><Text style={styles.title}>{detail.label}{detail.estimated ? " · estimated" : ""}</Text>{detail.details.map(d => <View key={d.label} style={styles.row}><Text style={styles.meta}>{d.label}</Text><Text style={styles.meta}>~{tokenLabel(d.tokens)}</Text></View>)}{detail.note ? <Text style={styles.meta}>{detail.note}</Text> : !detail.details.length ? <Text style={styles.meta}>Rough token count of the pinned {detail.label.toLowerCase()}.</Text> : null}</View> : null}
      <Text style={styles.provenance}>{s.source} · category counts estimated</Text>
    </> : <Text style={styles.meta}>This harness has no native context snapshot. Lifetime token usage is not context occupancy.</Text>}
    {control.plans.map(p => <View key={p.provider} style={styles.plan}><Text style={styles.provider}>{p.provider}</Text>{p.unavailable ? <Text style={styles.meta}>Plan usage unavailable</Text> : p.windows.map(w => <View key={w.label} style={styles.window}><View style={styles.row}><Text style={styles.meta}>{w.label} {Math.round(w.percent)}%</Text><Text style={styles.reset}>{resetLabel(w.resetsAt)}</Text></View><View style={styles.planBar}><View style={{ width: `${w.percent}%`, height: 3, backgroundColor: colors.gold }} /></View></View>)}</View>)}
    {s?.notes.map(note => <Text key={note} style={styles.provenance}>{note}</Text>)}
    </ScrollView>
    {s ? <View style={styles.footer}><Text style={[styles.meta, { flex: 1 }]}>{control.phase === "waiting" ? "Waiting for the running turn" : compressing ? "Summarizing messages" : s.threshold ? `~${tokenLabel(Math.max(0, s.threshold - s.used))} until auto-compact` : "Auto-compact unavailable"}</Text><PressScale accessibilityRole="button" accessibilityLabel="Compact now" disabled={!control.canCompact} onPress={() => void control.compact()} style={[styles.compact, !control.canCompact && { opacity: .4 }]}><Text style={styles.compactText}>Compact now</Text></PressScale></View> : null}
    {control.notice ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>{control.notice}</Text> : null}
  </Animated.View>;
}
const styles = StyleSheet.create({
  gauge: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  card: { position: "absolute", bottom: 72, left: 12, right: 12, zIndex: 20, backgroundColor: colors.bg, borderWidth: 1, borderColor: glass.hair, borderRadius: 16, padding: 14, gap: 9 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 6 },
  title: { ...type.small, color: colors.text }, meta: { ...type.mono, color: colors.textMuted, fontSize: 10, lineHeight: 15 },
  bar: { height: 8, flexDirection: "row", overflow: "hidden", borderRadius: 3, gap: 1 },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 12 },
  legendItem: { width: "48%", flexDirection: "row", alignItems: "center", minHeight: 32, gap: 5 },
  legendName: { ...type.small, fontSize: 11, color: colors.textMuted, flex: 1 },
  dot: { width: 5, height: 5, borderRadius: 1 },
  detail: { backgroundColor: glass.fill, borderRadius: 8, padding: 10, gap: 4 },
  provenance: { ...type.small, fontSize: 9, lineHeight: 12, color: colors.textTertiary },
  plan: { gap: 7 }, provider: { ...type.mono, fontSize: 10, color: colors.textTertiary }, window: { gap: 4 },
  reset: { ...type.mono, fontSize: 9, color: colors.textTertiary },
  planBar: { backgroundColor: colors.hair, height: 3, overflow: "hidden", borderRadius: 2 },
  footer: { flexDirection: "row", alignItems: "center", gap: 6, borderTopWidth: 1, borderColor: glass.hair, paddingTop: 7 },
  compact: { minHeight: 36, justifyContent: "center", paddingHorizontal: 10, backgroundColor: glass.fillChipOn, borderRadius: 12 },
  compactText: { ...type.small, fontSize: 11, color: colors.gold }, notice: { ...type.small, color: colors.gold },
});
