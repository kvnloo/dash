// Learn and Quick surfaces. Both are thin, pinned panels that talk to the open chat's agent
// through the same sink annotation uses; the answers come back as Dash ephemeral UI
// (genui cards/choices, mermaid diagrams) rendered in the chat.

import { useEffect, useState } from "react";
import { AppState, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { parseTriage, triageAge, type TriageSnapshot } from "../../../shared/triage";
import { learnPrompt, quickItems, unblockPrompt, type LearnIntent } from "../lib/ephemeral-modes";
import { haptic } from "../haptics";
import { executionToken } from "../lib/bridge-auth";
import { annotate, currentSink } from "../store/annotate";
import { store } from "../store/app";
import { setPillMode, surfaceMode } from "../store/ephemeral-mode";
import { colors, radius, space, type } from "../theme";
import { PressScale } from "./PressScale";

export function EphemeralModes(): React.JSX.Element | null {
  const mode = surfaceMode.use(s => s);
  const annotating = annotate.use(s => s.active);
  if (annotating || !mode) return null;
  return mode === "learn" ? <LearnSurface /> : <QuickSurface />;
}

function useSend(): { label: string | undefined; send(text: string): Promise<boolean>; note: string; setNote(v: string): void } {
  const label = annotate.use(s => s.sink);
  const [note, setNote] = useState("");
  return {
    label, note, setNote,
    async send(text: string) {
      const sink = currentSink();
      if (!sink) { setNote("Open a chat first: the agent in that chat answers."); return false; }
      try {
        await sink.send(text, [], sink.steerable() ? "steer" : "queue");
        haptic.success();
        setNote(sink.label.replace(/^Sending to /, "Sent to "));
        return true;
      } catch (error) {
        setNote(error instanceof Error ? error.message : "Could not send.");
        return false;
      }
    },
  };
}

function Shell({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.viewport, { top: insets.top + 64, left: insets.left + space.sm, right: insets.right + space.sm }]}>
      <View testID={`mode-surface-${title.toLowerCase()}`} style={styles.panel} accessibilityLabel={`${title} mode`}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.hint} numberOfLines={1}>{hint}</Text>
          <Chip label="✕" a11y={`Close ${title} mode`} onPress={() => setPillMode("normal")} />
        </View>
        {children}
      </View>
    </View>
  );
}

function LearnSurface(): React.JSX.Element {
  const [topic, setTopic] = useState("");
  const { label, send, note, setNote } = useSend();
  const ask = (intent: LearnIntent) => {
    if (!topic.trim()) { setNote("Type a topic first."); return; }
    void send(learnPrompt(intent, topic));
  };
  return (
    <Shell title="Learn" hint={label ? label.replace(/^Sending to /, "→ ") : "open a chat to learn with its agent"}>
      <TextInput testID="learn-topic" accessibilityLabel="Learn topic" value={topic} onChangeText={setTopic} maxLength={300}
        placeholder="What do you want to understand?" placeholderTextColor={colors.textMuted} selectionColor={colors.gold}
        style={styles.input} returnKeyType="send" onSubmitEditing={() => ask("explain")} />
      <View style={styles.row}>
        <Chip label="Explain" a11y="Explain the topic as cards" primary onPress={() => ask("explain")} />
        <Chip label="Quiz me" a11y="Quiz me on the topic" onPress={() => ask("quiz")} />
        <Chip label="Map it" a11y="Map the topic as a diagram" onPress={() => ask("map")} />
      </View>
      {note ? <Text testID="learn-note" style={styles.note}>{note}</Text> : null}
    </Shell>
  );
}

type Feed = { phase: "loading" } | { phase: "error"; reason: string } | { phase: "live"; snapshot: TriageSnapshot };

function QuickSurface(): React.JSX.Element {
  const settings = store.use(s => s.settings);
  const [feed, setFeed] = useState<Feed>({ phase: "loading" });
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(Date.now);
  const { label, send, note } = useSend();
  useEffect(() => {
    if (!settings) { setFeed({ phase: "error", reason: "Pair with a bridge first." }); return; }
    let disposed = false;
    const load = async () => {
      if (AppState.currentState !== "active") return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const token = await executionToken(settings);
        const response = await fetch(`http://${settings.address}/triage`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error(`Bridge HTTP ${response.status}`);
        const snapshot = parseTriage(await response.json());
        if (!snapshot) throw new Error("Unreadable blockers feed");
        if (!disposed) { setFeed({ phase: "live", snapshot }); setNow(Date.now()); }
      } catch (error) {
        if (!disposed) setFeed({ phase: "error", reason: error instanceof Error ? error.message : "Bridge unreachable" });
      } finally { clearTimeout(timeout); }
    };
    void load();
    const interval = setInterval(() => void load(), 15000);
    return () => { disposed = true; clearInterval(interval); };
  }, [settings, refresh]);
  const items = feed.phase === "live" ? quickItems(feed.snapshot, hidden) : [];
  const running = feed.phase === "live" ? feed.snapshot.items.filter(item => item.kind === "running").length : 0;
  return (
    <Shell title="Quick" hint={label ? label.replace(/^Sending to /, "→ ") : "open a chat to hand blockers to its agent"}>
      <View style={styles.row}>
        <Text style={styles.count} testID="quick-count">{feed.phase === "live" ? `${items.length} blocked · ${running} running` : feed.phase === "loading" ? "Loading blockers…" : feed.reason}</Text>
        <Chip label="↻" a11y="Refresh blockers" onPress={() => setRefresh(n => n + 1)} />
      </View>
      <ScrollView style={styles.list} contentContainerStyle={{ gap: space.xs }} keyboardShouldPersistTaps="always">
        {feed.phase === "live" && items.length === 0 ? <Text style={styles.note}>Nothing is waiting on you.</Text> : null}
        {items.map(item => (
          <View key={item.id} testID={`quick-item-${item.id}`} style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.kind === "owner" ? "Needs you · " : "Blocked · "}{item.title}</Text>
            <Text style={styles.cardBody} numberOfLines={3}>{item.reason}</Text>
            <Text style={styles.meta} numberOfLines={1}>{item.source} · {triageAge(item, now)}</Text>
            <View style={styles.row}>
              <Chip label="Unblock" a11y={`Unblock ${item.title}`} primary onPress={() => void send(unblockPrompt(item))} />
              <Chip label="Hide" a11y={`Hide ${item.title}`} onPress={() => setHidden(prev => new Set([...prev, item.id]))} />
            </View>
          </View>
        ))}
      </ScrollView>
      {note ? <Text testID="quick-note" style={styles.note}>{note}</Text> : null}
    </Shell>
  );
}

function Chip({ label, a11y, primary, onPress }: { label: string; a11y: string; primary?: boolean; onPress(): void }): React.JSX.Element {
  return (
    <PressScale accessibilityRole="button" accessibilityLabel={a11y} onPress={() => { haptic.select(); onPress(); }} style={[styles.chip, primary && styles.primary]}>
      <Text style={[styles.chipText, primary && styles.chipTextOn]}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  viewport: { position: "absolute", maxHeight: "48%" },
  panel: { borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.gold, padding: space.sm, gap: space.xs },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { ...type.label, color: colors.gold },
  hint: { ...type.mono, fontSize: 10, color: colors.textTertiary, flex: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs },
  input: { minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.hair2, backgroundColor: colors.surface, color: colors.text, fontSize: 16 },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: space.md, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.hair },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...type.mono, color: colors.textMuted },
  chipTextOn: { color: colors.bg },
  note: { ...type.small, color: colors.textMuted },
  count: { ...type.mono, fontSize: 11, color: colors.text, flex: 1 },
  list: { flexGrow: 0 },
  card: { borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hair, padding: space.sm, gap: 2 },
  cardTitle: { ...type.cardTitle, color: colors.text },
  cardBody: { ...type.small, color: colors.textMuted },
  meta: { ...type.mono, fontSize: 10, color: colors.textTertiary },
});
