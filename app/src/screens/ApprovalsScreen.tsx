import { Canvas } from "../components/Canvas";
import { PrimaryButton } from "../components/PrimaryButton";
import { ScreenHeader } from "../components/ScreenHeader";
import { useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { GateItem } from "../../../shared/gate";
import type { ScreenProps } from "../navigation";
import { KeyboardDock } from "../components/KeyboardDock";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { actionable, approvals, bulkEligible, itemTitle } from "../store/approvals";
import { colors, fonts, radius, space, type } from "../theme";
import { StageLinks } from "../components/artifact-stage/StageLinks";
import { isStageUrl } from "../lib/stage-link";

// `.z-btn` ghost: glass tint, hairline rim, pill, 44 px touch target.
function Button({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, disabled && styles.buttonDisabled, pressed && styles.buttonPressed]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Link({ label, url }: { label: string; url: string }) {
  if (isStageUrl(url)) return <StageLinks text={url} label={label} />;
  return /^https:\/\//.test(url) ? <Pressable accessibilityRole="link" hitSlop={6} onPress={() => void Linking.openURL(url)} style={styles.link}><Text style={styles.linkText} numberOfLines={2}>{label}</Text></Pressable> : <Text selectable style={styles.small}>{label}: {url}</Text>;
}
export function ApprovalsScreen({ navigation }: ScreenProps<"Approvals">) {
  const insets = useSafeAreaInsets();
  const state = approvals.use(s => s);
  const online = store.use(s => s.connection.status === "online");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[]>([]);
  const [confirmHashes, setConfirmHashes] = useState<{ id: string; body_sha256: string }[]>([]);
  const confirmCount = confirm.length || confirmHashes.length;
  const [editor, setEditor] = useState<{ item: GateItem; reject: boolean } | null>(null);
  const [text, setText] = useState("");
  const [changed, setChanged] = useState(false);
  const [localError, setLocalError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => { if (online) bridge.send({ type: "gate_list" }); }, [online]);
  useEffect(() => { setSelected(ids => ids.filter(id => state.items.some(i => i.id === id && bulkEligible(i)))); }, [state.items]);
  const visible = state.items.filter(i => showHistory || !["posted", "rejected"].includes(i.state));
  const groups = useMemo(() => [...new Set(visible.map(i => i.target.repo))].sort(), [visible]);
  const eligible = visible.filter(bulkEligible).map(i => i.id);
  const askApprove = (ids: string[]) => { setConfirm(ids); setConfirmHashes(ids.map(id => ({ id, body_sha256: state.items.find(i => i.id === id)?.trail.at(-1)?.body_sha256 ?? "" }))); };
  const toggle = (ids: string[]) => setSelected(s => ids.every(id => s.includes(id)) ? s.filter(id => !ids.includes(id)) : [...new Set([...s, ...ids])]);
  const send = (message: Parameters<typeof bridge.send>[0]) => { if (!bridge.send(message)) setLocalError("Disconnected. Reconnect before deciding."); };
  const openEditor = (item: GateItem, reject = false) => { setEditor({ item, reject }); setText(reject || item.policy.requires_human_text && item.state !== "edited" ? "" : item.body); setChanged(false); };
  return <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <Canvas /><ScreenHeader title="Approvals" onBack={() => navigation.goBack()} action="Refresh" icon="refresh-cw" onAction={() => send({ type: "gate_list" })} />
    <Text style={styles.mode}>{state.dryRun ? "Dry run · Nothing will be posted" : "Live · Approved items can be posted"}</Text>
    <Text style={styles.subtitle}>{state.ownerDecisions ? "Human approvals are recorded on the project coordination thread." : "Rehearsal decisions only. These are not live human approval."}</Text>
    <View testID="approval-metrics" style={styles.metrics}>
      {[{ label: "Pending", count: state.items.filter(actionable).length, note: "To review" }, { label: "Bulk-ready", count: eligible.length, note: "Policy checked" }, { label: "Blocked", count: state.items.filter(i => ["stale", "failed"].includes(i.state)).length, note: "Needs attention" }].map((metric, i) => <View key={metric.label} style={[styles.metric, i > 0 && styles.metricBorder]}><Text style={styles.metricLabel}>{metric.label}</Text><Text style={styles.metricNumber}>{metric.count}</Text><Text style={styles.metricNote}>{metric.note}</Text></View>)}
    </View>
    {!online ? <Text style={styles.error}>Offline. Decisions disabled until the paired bridge reconnects.</Text> : null}
    {state.error || localError ? <Text accessibilityRole="alert" style={styles.error}>{state.error || localError}</Text> : null}
    {!state.loaded ? <Text style={styles.subtitle}>Waiting for authenticated outbox…</Text> : null}
    <View style={[styles.actions, styles.toolbar]}>
      <Button label="Select all bulk-safe" onPress={() => toggle(eligible)} disabled={!online || !eligible.length} />
      <Button label={showHistory ? "Hide history" : "Show history"} onPress={() => setShowHistory(!showHistory)} />
    </View>
    <View style={{ paddingHorizontal: 16, marginBottom: 8 }}><PrimaryButton label={`Approve selected (${selected.length})`} onPress={() => askApprove(selected)} disabled={!online || !selected.length} /></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {groups.map(repo => {
        const items = visible.filter(i => i.target.repo === repo), ids = items.filter(bulkEligible).map(i => i.id);
        return <View key={repo} style={styles.group}>
          <View style={styles.groupHeader}><Text style={styles.heading}>{repo}</Text><Button label={`Select group (${ids.length})`} onPress={() => toggle(ids)} disabled={!online || !ids.length} /></View>
          {items.map(item => <View key={item.id} testID={`gate-card-${item.id}`} style={styles.card}>
            <View style={styles.actions}>
              {bulkEligible(item) ? <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${item.id}`} accessibilityState={{ checked: selected.includes(item.id), disabled: !online }} aria-checked={selected.includes(item.id)} disabled={!online} onPress={() => toggle([item.id])} style={[styles.button, selected.includes(item.id) && styles.buttonSelected]}><Text style={[styles.buttonText, selected.includes(item.id) && { color: colors.gold }]}>{selected.includes(item.id) ? "✓ Selected" : "Select"}</Text></Pressable> : null}
              <Text style={styles.badge}>{item.policy.requires_human_text ? "Human text" : item.policy.bulk_ok ? "Bulk safe" : "Individual"} · {item.kind.replaceAll("_", " ")}</Text>
            </View>
            <Text style={styles.itemTitle} numberOfLines={2}>{itemTitle(item)}</Text>
            <Link label={`${repo}${item.target.number ? ` #${item.target.number}` : " · " + (item.target.head ?? "new action")}`} url={`https://github.com/${repo}${item.target.number ? `/${item.kind === "issue_comment" ? "issues" : "pull"}/${item.target.number}` : ""}`} />
            <Text style={styles.small}>{item.policy.reason}</Text>
            <Text numberOfLines={6} selectable style={styles.body}>{item.body || "Write your own response. Generated text is not shown under this policy."}</Text>
            {item.evidence.map((e,n) => <Link key={`${e.label}-${n}`} label={e.label} url={e.url_or_path} />)}
            <Text style={[styles.stateLine, { color: item.state === "stale" || item.state === "failed" ? colors.warn : colors.textTertiary }]}>{state.status[item.id] ?? item.state}{item.reason ? ` · ${item.reason}` : ""}{item.receipt?.dry_run ? " · Dry-run checks passed. Nothing posted." : ""}</Text>
            {item.receipt?.url ? <Link label="Posted on GitHub" url={item.receipt.url} /> : null}
            <View style={[styles.actions, styles.cardActions]}>
              {actionable(item) || item.state === "approved" ? <>
                <Button label={item.policy.requires_human_text ? "Write response" : "Review / edit"} disabled={!online || Boolean(state.status[item.id])} onPress={() => openEditor(item)} />
                <Button label="Reject" disabled={!online || Boolean(state.status[item.id])} onPress={() => openEditor(item, true)} />
              </> : null}
              {actionable(item) ? <Button label="Approve item" disabled={!online || item.policy.requires_human_text && item.state !== "edited"} onPress={() => askApprove([item.id])} /> : null}
              {item.state === "approved" ? <Button label={state.dryRun ? "Check dry run" : "Post approved item"} disabled={!online || Boolean(state.status[item.id])} onPress={() => send({ type: "gate_post", id: item.id })} /> : null}
            </View>
          </View>)}
        </View>;
      })}
      {state.loaded && !visible.length ? <Text style={styles.body}>No pending proposals. Agents can propose work with the gate CLI.</Text> : null}
    </ScrollView>
    <Modal visible={confirm.length > 0} transparent animationType="fade" onRequestClose={() => setConfirm([])}>
      <View style={styles.scrim}><View style={styles.sheet}><Text style={styles.title}>Approve {confirmCount} {confirmCount === 1 ? "item" : "items"}?</Text><Text style={styles.body}>By confirming, I approve only these exact bodies and targets for 24 hours. I checked peer tone, the smallest optional ask, available evidence and current feedback. No merge or expanded scope. Posting is separate. {state.dryRun ? "This bridge is dry-run only." : "Live posting is enabled."}</Text>
        <Button label={`Confirm approve ${confirmCount}`} disabled={!online} onPress={() => { send({ type: "gate_decide", decision: { action: "approve", ids: confirm, expected: confirmHashes } }); setConfirm([]); setSelected([]); }} /><Button label="Cancel" onPress={() => setConfirm([])} /></View></View>
    </Modal>
    <Modal visible={editor !== null} animationType="slide" onRequestClose={() => setEditor(null)}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}><Text style={styles.title}>{editor?.reject ? "Reject proposal" : "Write / edit response"}</Text><Button label="Close" onPress={() => setEditor(null)} /></View>
        <ScrollView contentContainerStyle={styles.content}><Text style={styles.body}>{editor?.item.target.repo}{editor?.item.target.number ? ` #${editor.item.target.number}` : " · New action"}</Text><Text style={styles.body}>{editor?.reject ? "Give the agent a reason. No upstream comment will be posted." : editor?.item.policy.reason}</Text>{editor?.item.evidence.map((e,n) => <Link key={n} label={e.label} url={e.url_or_path} />)}</ScrollView>
        <KeyboardDock><TextInput accessibilityLabel={editor?.reject ? "Rejection reason" : "Owner response"} multiline value={text} onChangeText={v => { setText(v); setChanged(true); }} placeholder={editor?.reject ? "Why should this not be posted?" : "Write your response in your own words…"} placeholderTextColor={colors.textMuted} style={styles.input} />
          <Button label={editor?.reject ? "Confirm reject" : "Save owner text"} disabled={!online || !changed || !text.trim() || !editor?.reject && text === editor?.item.body} onPress={() => { if (!editor) return; send({ type: "gate_decide", decision: editor.reject ? { action: "reject", id: editor.item.id, reason: text } : { action: "edit", id: editor.item.id, body: text } }); setEditor(null); }} />
        </KeyboardDock>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  metrics: { flexDirection: "row", marginHorizontal: space.lg, marginVertical: space.md, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.hair, paddingVertical: 12 },
  metric: { flex: 1, gap: 2, paddingHorizontal: space.md }, metricBorder: { borderLeftWidth: 1, borderColor: colors.hair },
  // Sans tabular numerals: Cormorant's old-style "1" reads as the letter I beside a label.
  metricLabel: { ...type.label, color: colors.textMuted }, metricNumber: { fontFamily: fonts.semibold, fontSize: 30, lineHeight: 36, fontWeight: "600", fontVariant: ["tabular-nums"], color: colors.text }, metricNote: { ...type.mono, color: colors.textTertiary, fontSize: 10 },
  screen: { flex: 1, backgroundColor: colors.bg }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, gap: space.sm },
  title: { color: colors.text, ...type.title, flexShrink: 1 }, heading: { color: colors.ink, ...type.cardTitle, flexShrink: 1 }, itemTitle: { color: colors.text, ...type.cardTitle },
  mode: { color: colors.ink2, ...type.small, paddingHorizontal: space.lg, paddingTop: space.sm }, subtitle: { color: colors.textMuted, ...type.small, paddingHorizontal: space.lg, paddingVertical: space.xs },
  content: { padding: space.lg, gap: space.lg }, group: { gap: space.md }, groupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hair, borderTopColor: "rgba(255,255,255,.18)", padding: space.lg, gap: space.sm },
  body: { color: colors.ink, ...type.body }, small: { color: colors.ink2, ...type.small }, badge: { color: colors.textTertiary, ...type.mono, alignSelf: "center", flexShrink: 1 },
  stateLine: { ...type.mono }, actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm }, toolbar: { paddingHorizontal: space.lg }, cardActions: { marginTop: space.xs },
  button: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: space.lg, backgroundColor: "rgba(236,232,223,.06)", borderWidth: 1, borderColor: "rgba(236,232,223,.16)", borderTopColor: "rgba(255,255,255,.22)", borderRadius: radius.pill },
  buttonSelected: { borderColor: colors.gold }, buttonDisabled: { opacity: 0.4 }, buttonPressed: { borderColor: colors.gold },
  buttonText: { color: colors.text, ...type.small, fontFamily: fonts.semibold, fontWeight: "600" },
  link: { minHeight: 32, justifyContent: "center" }, linkText: { color: colors.textMuted, ...type.small, textDecorationLine: "underline", flexShrink: 1 }, error: { color: colors.warn, ...type.small, padding: space.lg },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", padding: space.lg }, sheet: { padding: space.xl, gap: space.lg, backgroundColor: colors.surfaceRaised, borderRadius: radius.lg },
  input: { color: colors.text, backgroundColor: colors.surface, margin: space.lg, padding: space.lg, borderRadius: radius.md, minHeight: 120, maxHeight: 260, ...type.body, textAlignVertical: "top" },
});
