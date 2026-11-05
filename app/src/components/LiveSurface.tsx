import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { LiveControl, LiveIntent } from "../../../shared/live";
import { refreshLiveReceipts, sendLiveIntent } from "../net/bridge";
import { liveStore, setAskHermes, showVersion, EMPTY_LIVE, type LiveLine, type LiveState } from "../store/live";
import { colors, controlMin, glass, radius, space, type } from "../theme";
import { LiveArtifactFrame } from "./LiveArtifactFrame";
import { Markdown } from "./Markdown";
import { PressScale } from "./PressScale";
import { flowMode } from "../lib/flow-trace";
import { acceptsGeneration } from "../lib/generative-stream";

/**
 * The live surface of a Hermes chat: a fast libfx worker streams the quick conversation and renders
 * fx0 designs (per-turn versions) inline. Taps become declared intents that land in Hermes as
 * receipts; "Ask Hermes" routes a question through the worker to the owning Hermes session.
 */
export const LiveSurface = memo(function LiveSurface({ conversationId }: { conversationId: string }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const live = liveStore.use(all => all[conversationId] ?? EMPTY_LIVE);
  const scroll = useRef<ScrollView>(null);
  const [receiptsOpen, setReceiptsOpen] = useState(false);
  const shown = live.artifacts.find(a => a.version === live.shownVersion) ?? live.artifacts.at(-1);
  const onIntent = useCallback((intent: LiveIntent) => { sendLiveIntent(conversationId, intent); }, [conversationId]);

  useEffect(() => { if (live.status === "ready") refreshLiveReceipts(conversationId); }, [conversationId, live.status, live.busy]);
  useEffect(() => { requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true })); }, [live.lines.length, live.artifacts.length]);

  if (live.status === "opening" || live.status === "idle") {
    return <View style={styles.center}><Text style={styles.meta}>Attaching the live surface to this Hermes session…</Text></View>;
  }
  if (live.status === "error") {
    return <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{live.error ?? "Live surface unavailable"}</Text></View>;
  }

  const last = live.receipts.at(-1);
  return (
    <View style={styles.root} testID="live-surface">
      <View style={styles.owner}>
        <View style={[styles.dot, { backgroundColor: live.busy ? colors.gold : colors.textFaint }]} />
        <Text style={styles.mono} numberOfLines={1}>fx worker · {live.model ?? "libfx"} → Hermes {live.parentSessionId?.slice(-8) ?? ""}</Text>
      </View>
      <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {shown ? (
          <View style={styles.card} testID="live-artifact">
            <View style={styles.versions} accessibilityRole="tablist">
              <Text style={styles.label}>{shown.title ?? "fx0 design"}</Text>
              <View style={styles.flex} />
              {live.artifacts.map(a => (
                <PressScale key={a.version} accessibilityRole="tab" accessibilityState={{ selected: a.version === shown.version }} aria-selected={a.version === shown.version}
                  accessibilityLabel={`Version ${a.version}`} onPress={() => showVersion(conversationId, a.version)} style={[styles.pill, a.version === shown.version && styles.pillOn]}>
                  <Text style={[styles.pillText, a.version === shown.version && styles.pillTextOn]}>v{a.version}</Text>
                </PressScale>
              ))}
            </View>
            <LiveArtifactFrame html={shown.html} version={shown.version} height={300} onIntent={onIntent} />
            <PressScale accessibilityRole="button" accessibilityLabel="Open live artifact in stage" onPress={() => nav.navigate("ArtifactStage", { html: shown.html, title: shown.title ?? "Live artifact · unverified" })} style={{ minHeight: 44, justifyContent: "center" }}><Text style={styles.chipTextOn}>Open in stage ↗ · static preview</Text></PressScale>
          </View>
        ) : null}
        {live.controls.map(control => <NativeControl key={control.id} control={control} onIntent={onIntent} />)}
        {live.lines.filter(line => !flowMode || line.generation === undefined || acceptsGeneration(live.generation ?? 0, line.generation)).map(line => <Line key={line.id} line={line} conversationId={conversationId} />)}
      </ScrollView>
      <PressScale accessibilityRole="button" accessibilityLabel={`Receipts in Hermes: ${live.receipts.length}`} onPress={() => setReceiptsOpen(o => !o)} style={styles.receipts}>
        <Text style={styles.label}>In Hermes · {live.receipts.length} receipt{live.receipts.length === 1 ? "" : "s"}</Text>
        {receiptsOpen ? live.receipts.slice(-6).map((r, i) => (
          <Text key={`${r.at}-${i}`} style={styles.meta} numberOfLines={2}>
            <Text style={styles.mono}>{r.hermes ? `#${r.hermes.messageId} ` : ""}{r.kind} · </Text>
            {r.decisions.length ? `Decided ${r.decisions.join("; ")}` : r.summary.replace(/\s+/g, " ")}
          </Text>
        )) : (
          <Text style={styles.meta} numberOfLines={1}>
            {last ? (last.decisions.length ? `Decided: ${last.decisions.join("; ")}` : last.summary.replace(/\s+/g, " ")) : "Nothing recorded yet"}
          </Text>
        )}
      </PressScale>
      <View style={styles.bar}>
        <PressScale accessibilityRole="switch" accessibilityState={{ checked: live.askHermes }} aria-checked={live.askHermes} accessibilityLabel="Ask Hermes"
          onPress={() => setAskHermes(conversationId, !live.askHermes)} style={[styles.chip, live.askHermes && styles.chipOn]}>
          <Text style={[styles.chipText, live.askHermes && styles.chipTextOn]}>Ask Hermes</Text>
        </PressScale>
        <Timing live={live} />
      </View>
    </View>
  );
});

function Timing({ live }: { live: LiveState }) {
  const t = live.timing;
  if (!t) return null;
  const parts = [t.firstCharAt ? `first char ${Math.round(t.firstCharAt - t.sentAt)} ms` : null, t.firstHtmlAt ? `html ${((t.firstHtmlAt - t.sentAt) / 1000).toFixed(1)} s` : null, t.doneAt ? `turn ${((t.doneAt - t.sentAt) / 1000).toFixed(1)} s` : null].filter(Boolean);
  return <Text style={styles.mono} numberOfLines={1} testID="live-timing">{parts.join(" · ")}</Text>;
}

function Line({ line, conversationId }: { line: LiveLine; conversationId: string }) {
  if (line.role === "owner") return <View style={styles.ownerBubble}><Text style={styles.body}>{line.text}</Text></View>;
  if (line.role === "hermes") {
    return (
      <View style={styles.hermes} accessibilityLabel={`Hermes: ${line.text}`}>
        <Text style={[styles.mono, line.state === "error" && { color: colors.danger }]}>Hermes</Text>
        {line.state === "error" ? <Text style={styles.body}>{line.text}</Text> : <Markdown text={line.text} onIntent={intent => sendLiveIntent(conversationId, intent)} />}
      </View>
    );
  }
  if (line.state === "error" || !line.text) return <Text style={[styles.body, styles.worker, line.state === "error" && { color: colors.danger }]}>{line.text || (line.state === "streaming" ? "…" : "")}</Text>;
  return <Markdown text={line.text} onIntent={intent => sendLiveIntent(conversationId, intent)} />;
}

function NativeControl({ control, onIntent }: { control: LiveControl; onIntent: (intent: LiveIntent) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const choose = (value: string, label: string) => { setPicked(value); onIntent({ controlId: control.id, value, label, surface: "dash-live-surface" }); };
  const options = control.kind === "choice" ? control.options : control.kind === "candidates" ? control.candidates
    : control.kind === "confirm" ? [{ id: "confirm", label: control.confirmLabel ?? "Confirm" }, { id: "cancel", label: control.cancelLabel ?? "Cancel" }]
    : [{ id: String(control.min), label: `${control.min}${control.unit ?? ""}` }, { id: String(control.value ?? (control.min + control.max) / 2), label: `${control.value ?? (control.min + control.max) / 2}${control.unit ?? ""}` }, { id: String(control.max), label: `${control.max}${control.unit ?? ""}` }];
  return (
    <View style={styles.card} accessibilityRole="radiogroup" accessibilityLabel={control.prompt}>
      <Text style={styles.heading}>{control.prompt}</Text>
      {options.map(option => (
        <PressScale key={option.id} accessibilityRole="radio" accessibilityState={{ checked: picked === option.id }} aria-checked={picked === option.id}
          onPress={() => choose(option.id, option.label)} style={[styles.option, picked === option.id && styles.optionOn]}>
          <Text style={styles.body}>{option.label}{picked === option.id ? "  · Selected" : ""}</Text>
          {"detail" in option && option.detail ? <Text style={styles.meta}>{option.detail}</Text> : null}
        </PressScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  content: { paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.md },
  owner: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs },
  dot: { width: 6, height: 6, borderRadius: 3 },
  card: { backgroundColor: glass.fill, borderColor: glass.hair, borderWidth: 1, borderTopColor: glass.highlight, borderRadius: radius.md, padding: space.md, gap: space.sm },
  versions: { flexDirection: "row", alignItems: "center", gap: space.xs },
  pill: { minWidth: 36, height: 28, borderRadius: radius.pill, borderWidth: 1, borderColor: glass.hair, alignItems: "center", justifyContent: "center", paddingHorizontal: space.sm },
  pillOn: { borderColor: colors.gold },
  pillText: { ...type.mono, color: colors.textTertiary },
  pillTextOn: { color: colors.gold },
  ownerBubble: { alignSelf: "flex-end", maxWidth: "86%", backgroundColor: glass.fillNavStrong, borderColor: glass.hair, borderWidth: 1, borderRadius: radius.lg, borderBottomRightRadius: 8, paddingHorizontal: space.md, paddingVertical: space.sm },
  worker: { color: colors.text },
  hermes: { borderLeftWidth: 2, borderLeftColor: colors.gold, paddingLeft: space.md, gap: 2 },
  receipts: { marginHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: 1, borderTopColor: glass.hair, minHeight: controlMin, justifyContent: "center" },
  bar: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xs },
  chip: { height: 32, borderRadius: radius.pill, borderWidth: 1, borderColor: glass.hair, backgroundColor: glass.fillChip, paddingHorizontal: space.md, justifyContent: "center" },
  chipOn: { borderColor: colors.gold, backgroundColor: glass.fillChipOn },
  chipText: { ...type.label, color: colors.textMuted },
  chipTextOn: { color: colors.gold },
  option: { minHeight: controlMin, borderRadius: radius.card, borderWidth: 1, borderColor: glass.hair, paddingHorizontal: space.md, paddingVertical: space.sm, justifyContent: "center" },
  optionOn: { borderColor: colors.gold },
  heading: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.text },
  meta: { ...type.small, color: colors.textMuted },
  label: { ...type.label, color: colors.textMuted },
  mono: { ...type.mono, color: colors.textTertiary },
  error: { ...type.body, color: colors.danger, textAlign: "center" },
});
