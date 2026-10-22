import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { parseRecentModels, rankRecentModels, type RecentModel } from "../../../shared/recent-models";
import type { Conversation } from "../model";
import { executionToken } from "../lib/bridge-auth";
import { hermesProfileFor, sessionModelCommand } from "../lib/agent-controls";
import { useLiveThinking } from "../lib/live-thinking";
import { actionable, approvals } from "../store/approvals";
import { store } from "../store/app";
import { colors, glass, radius, type } from "../theme";
import { AgentOrb } from "./AgentOrb";
import { ComposerActionMenu, type ComposerMenuRow } from "./ComposerActionMenu";
import { debugUi } from "../debug/ui-store";
import { isDebugActive } from "../debug/expose";

export function AgentPopup({ conversation, onHarness, onApprovals }: { conversation?: Conversation; onHarness(): void; onApprovals(): void }) {
  const settings = store.use(s => s.settings);
  const online = store.use(s => s.connection.status === "online");
  const harness = conversation?.harness ?? settings?.harness ?? "hermes";
  const count = approvals.use(s => s.items.filter(actionable).length);
  const { thinking } = useLiveThinking(conversation);
  const [models, setModels] = useState<RecentModel[]>([]);
  const [catalog, setCatalog] = useState<RecentModel[]>([]);
  const [current, setCurrent] = useState<RecentModel>();
  const [note, setNote] = useState("Recent-model source unavailable. No model change has been sent.");
  const [sheet, setSheet] = useState(false);
  const [query, setQuery] = useState("");
  const [inspected, setInspected] = useState<RecentModel>();
  const profile = hermesProfileFor(conversation);
  const snapshot = debugUi.use(s => s.inputModels);
  useEffect(() => {
    setModels([]); setCatalog([]); setCurrent(undefined);
    if (isDebugActive() && snapshot && snapshot.profile === profile) {
      setModels(snapshot.models); setCatalog(snapshot.catalog); setCurrent(snapshot.current); setNote(snapshot.note);
      return;
    }
    if (!settings || !online || !profile) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    let disposed = false;
    const load = async () => {
      try {
        const token = await executionToken(settings);
        const response = await fetch(`http://${settings.address}/models/recent?profile=${encodeURIComponent(profile)}${conversation?.sessionId ? `&session=${encodeURIComponent(conversation.sessionId)}` : ""}`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
        if (!response.ok) throw new Error("Recent-model source unavailable");
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") throw new Error("Invalid model source");
        if (disposed) return;
        setModels(parseRecentModels("models" in body ? body.models : undefined));
        setCatalog(parseRecentModels("catalog" in body ? body.catalog : undefined));
        setCurrent(parseRecentModels("current" in body ? [body.current] : [])[0]);
        setNote("applyBlocker" in body && typeof body.applyBlocker === "string" ? body.applyBlocker : "Model application is not available through this transport. No model change has been sent.");
      } catch { if (!disposed) setNote("Recent-model endpoint unavailable. Current model is unknown; no model change has been sent."); }
      finally { clearTimeout(timer); }
    };
    void load();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [settings, online, profile, conversation?.sessionId, snapshot]);
  const quick = models.slice(0, 4);
  const openModels = (index?: number) => { setInspected(index === undefined ? undefined : quick[index]); setSheet(true); };
  const rows: ComposerMenuRow[] = [
    { id: "harness", label: "Harness", value: harness, run: onHarness },
    ...(count ? [{ id: "approvals", label: "Needs OK", value: `${count} pending`, run: onApprovals }] : []),
    { id: "models", label: "Model", value: current?.model ?? "unavailable", run: () => openModels(), values: quick.map(m => m.model), index: Math.max(0, quick.findIndex(m => m.model === current?.model && m.provider === current?.provider)), inspect: index => openModels(index) },
  ];
  const filtered = useMemo(() => {
    // Recent count wins over a zero-count catalog entry; never inflate usage counts.
    const unique = new Map<string, RecentModel>();
    for (const row of [...catalog, ...models]) unique.set(`${row.provider}/${row.model}`, row);
    return rankRecentModels([...unique.values()]).filter(m => `${m.provider}/${m.model}`.toLowerCase().includes(query.toLowerCase()));
  }, [models, catalog, query]);
  const isCurrent = (m: RecentModel) => m.model === current?.model && m.provider === current.provider;
  return <>
    <ComposerActionMenu label={`Agent controls${count ? `, ${count} approvals pending` : ""}`} rows={rows}>
      <View style={styles.button}><AgentOrb size={22} thinking={thinking} label={harness} /><Text numberOfLines={1} style={styles.short}>{current?.model ?? harness}</Text>{count ? <Text style={styles.badge}>{count}</Text> : null}</View>
    </ComposerActionMenu>
    <Modal visible={sheet} transparent animationType="none" onRequestClose={() => setSheet(false)}>
      <View style={styles.scrim}><View style={styles.sheet}>
        <Text style={styles.title}>Models · {profile ?? harness}</Text>
        <Text style={styles.note}>{note}</Text>
        <Text style={styles.note}>Usage: sessions started in the last 14 days. Catalog entries are not proof of availability or credit.</Text>
        {quick.length ? <View style={styles.quick}>{quick.map(m => <Pressable key={`${m.provider}/${m.model}`} accessibilityRole="button" accessibilityLabel={`Inspect ${m.provider}/${m.model}, ${m.count} sessions`} accessibilityState={{ selected: isCurrent(m) }} onPress={() => setInspected(m)} style={[styles.chip, isCurrent(m) && styles.current]}><Text style={styles.small}>{m.model}</Text><Text style={styles.note}>{m.count} sessions</Text></Pressable>)}</View> : null}
        <TextInput accessibilityLabel="Search models" value={query} onChangeText={setQuery} placeholder="Search paid-provider models…" placeholderTextColor={colors.textFaint} style={styles.input} autoCapitalize="none" />
        {inspected ? <View><Text accessibilityLiveRegion="polite" style={styles.note}>Inspecting {inspected.provider}/{inspected.model}. This did not change the session model.</Text><Text selectable style={styles.note}>Native session command: {sessionModelCommand(inspected)}</Text></View> : null}
        <ScrollView style={styles.list}>{filtered.map(m => <Pressable key={`${m.provider}/${m.model}`} accessibilityRole="button" onPress={() => setInspected(m)} style={styles.row}><Text style={styles.small}>{m.provider}/{m.model}{isCurrent(m) ? " · current" : ""}</Text><Text style={styles.note}>{m.count ? `${m.count} sessions` : "cached catalog"}</Text></Pressable>)}</ScrollView>
        {!filtered.length ? <Text style={styles.note}>No verified model metadata available.</Text> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Close model search" onPress={() => setSheet(false)} style={styles.row}><Text style={styles.small}>Close</Text></Pressable>
      </View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", gap: 6 }, short: { ...type.mono, fontSize: 10, color: colors.textMuted, maxWidth: 110 }, badge: { ...type.mono, fontSize: 11, color: colors.warn },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,.75)", justifyContent: "flex-end", padding: 12 },
  sheet: { backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: glass.hair, padding: 16, gap: 10 },
  title: { ...type.cardTitle, color: colors.text }, note: { ...type.small, color: colors.textTertiary }, small: { ...type.small, color: colors.text },
  input: { ...type.body, color: colors.text, padding: 12, borderWidth: 1, borderColor: glass.hair, borderRadius: radius.md },
  quick: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, chip: { padding: 8, borderWidth: 1, borderColor: glass.hair, borderRadius: radius.md, minHeight: 44 }, current: { borderColor: colors.gold }, list: { maxHeight: 260 }, row: { minHeight: 44, justifyContent: "center", paddingVertical: 8 },
});
