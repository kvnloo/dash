import { useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { GateItem } from "../../../shared/gate";
import type { ScreenProps } from "../navigation";
import { KeyboardDock } from "../components/KeyboardDock";
import { bridge } from "../net/bridge";
import { store } from "../store/app";
import { actionable, approvals, bulkEligible } from "../store/approvals";
import { colors, radius, space, type } from "../theme";

function Button({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.4 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
}
function Link({ label, url }: { label: string; url: string }) {
  return /^https:\/\//.test(url) ? <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={styles.link}><Text style={styles.linkText}>{label}</Text></Pressable> : <Text selectable style={styles.small}>{label}: {url}</Text>;
}
export function ApprovalsScreen({ navigation }: ScreenProps<"Approvals">) {
  const insets = useSafeAreaInsets();
  const state = approvals.use(s => s);
  const online = store.use(s => s.connection.status === "online");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[]>([]);
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
  const toggle = (ids: string[]) => setSelected(s => ids.every(id => s.includes(id)) ? s.filter(id => !ids.includes(id)) : [...new Set([...s, ...ids])]);
  const send = (message: Parameters<typeof bridge.send>[0]) => { if (!bridge.send(message)) setLocalError("Disconnected. Reconnect before deciding."); };
  const openEditor = (item: GateItem, reject = false) => { setEditor({ item, reject }); setText(reject || item.policy.requires_human_text && item.state !== "edited" ? "" : item.body); setChanged(false); };
  return <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <View style={styles.header}><Button label="Back" onPress={() => navigation.goBack()} /><Text style={styles.title}>Approvals</Text><Button label="Refresh" onPress={() => send({ type: "gate_list" })} disabled={!online} /></View>
    <Text style={styles.mode}>{state.dryRun ? "DRY RUN · Nothing will be posted" : "LIVE · Approved items can be posted"}</Text>
    <Text style={styles.subtitle}>{state.ownerDecisions ? "Human approvals are recorded on the project coordination thread." : "Rehearsal decisions only. These are not live human approval."}</Text>
    <Text style={styles.subtitle}>{state.items.filter(actionable).length} waiting · {state.items.filter(i => i.state === "stale").length} stale</Text>
    {!online ? <Text style={styles.error}>Offline. Decisions disabled until the paired bridge reconnects.</Text> : null}
    {state.error || localError ? <Text accessibilityRole="alert" style={styles.error}>{state.error || localError}</Text> : null}
    {!state.loaded ? <Text style={styles.subtitle}>Waiting for authenticated outbox…</Text> : null}
    <View style={styles.actions}>
      <Button label="Select all bulk-safe" onPress={() => toggle(eligible)} disabled={!online || !eligible.length} />
      <Button label={`Approve selected (${selected.length})`} onPress={() => setConfirm(selected)} disabled={!online || !selected.length} />
      <Button label={showHistory ? "Hide history" : "Show history"} onPress={() => setShowHistory(!showHistory)} />
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {groups.map(repo => {
        const items = visible.filter(i => i.target.repo === repo), ids = items.filter(bulkEligible).map(i => i.id);
        return <View key={repo} style={styles.group}>
          <View style={styles.groupHeader}><Text style={styles.heading}>{repo}</Text><Button label={`Select group (${ids.length})`} onPress={() => toggle(ids)} disabled={!online || !ids.length} /></View>
          {items.map(item => <View key={item.id} testID={`gate-card-${item.id}`} style={styles.card}>
            <View style={styles.actions}>
              {bulkEligible(item) ? <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${item.id}`} accessibilityState={{ checked: selected.includes(item.id), disabled: !online }} disabled={!online} onPress={() => toggle([item.id])} style={styles.button}><Text style={[styles.buttonText, selected.includes(item.id) && { color: colors.gold }]}>{selected.includes(item.id) ? "Selected" : "Select"}</Text></Pressable> : null}
              <Text style={styles.badge}>{item.policy.requires_human_text ? "HUMAN TEXT" : item.policy.bulk_ok ? "BULK SAFE" : "INDIVIDUAL"}</Text><Text style={styles.badge}>{item.kind.replaceAll("_", " ")}</Text>
            </View>
            <Link label={`${repo}${item.target.number ? ` #${item.target.number}` : " · " + (item.target.head ?? "new action")}`} url={`https://github.com/${repo}${item.target.number ? `/${item.kind === "issue_comment" ? "issues" : "pull"}/${item.target.number}` : ""}`} />
            <Text style={styles.small}>{item.policy.reason}</Text>
            <Text numberOfLines={6} selectable style={styles.body}>{item.body || "Write your own response. Generated text is not shown under this policy."}</Text>
            {item.evidence.map((e,n) => <Link key={`${e.label}-${n}`} label={e.label} url={e.url_or_path} />)}
            <Text style={[styles.small, { color: item.state === "stale" || item.state === "failed" ? colors.warn : colors.ink2 }]}>{state.status[item.id] ?? item.state}{item.reason ? ` · ${item.reason}` : ""}{item.receipt?.dry_run ? " · Dry-run checks passed. Nothing posted." : ""}</Text>
            {item.receipt?.url ? <Link label="Posted on GitHub" url={item.receipt.url} /> : null}
            <View style={styles.actions}>
              {actionable(item) || item.state === "approved" ? <>
                <Button label={item.policy.requires_human_text ? "Write response" : "Review / edit"} disabled={!online || Boolean(state.status[item.id])} onPress={() => openEditor(item)} />
                <Button label="Reject" disabled={!online || Boolean(state.status[item.id])} onPress={() => openEditor(item, true)} />
              </> : null}
              {actionable(item) ? <Button label="Approve item" disabled={!online || item.policy.requires_human_text && item.state !== "edited"} onPress={() => setConfirm([item.id])} /> : null}
              {item.state === "approved" ? <Button label={state.dryRun ? "Check dry run" : "Post approved item"} disabled={!online || Boolean(state.status[item.id])} onPress={() => send({ type: "gate_post", id: item.id })} /> : null}
            </View>
          </View>)}
        </View>;
      })}
      {state.loaded && !visible.length ? <Text style={styles.body}>No pending proposals. Agents can propose work with the gate CLI.</Text> : null}
    </ScrollView>
    <Modal visible={confirm.length > 0} transparent animationType="fade" onRequestClose={() => setConfirm([])}>
      <View style={styles.scrim}><View style={styles.sheet}><Text style={styles.title}>Approve {confirm.length} {confirm.length === 1 ? "item" : "items"}?</Text><Text style={styles.body}>By confirming, I approve only these exact bodies and targets for 24 hours. I checked peer tone, the smallest optional ask, available evidence and current feedback. No merge or expanded scope. Posting is separate. {state.dryRun ? "This bridge is dry-run only." : "Live posting is enabled."}</Text>
        <Button label={`Confirm approve ${confirm.length}`} disabled={!online} onPress={() => { send({ type: "gate_decide", decision: { action: "approve", ids: confirm } }); setConfirm([]); setSelected([]); }} /><Button label="Cancel" onPress={() => setConfirm([])} /></View></View>
    </Modal>
    <Modal visible={editor !== null} animationType="slide" onRequestClose={() => setEditor(null)}>
      <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.header}><Text style={styles.title}>{editor?.reject ? "Reject proposal" : "Write / edit response"}</Text><Button label="Close" onPress={() => setEditor(null)} /></View>
        <ScrollView contentContainerStyle={styles.content}><Text style={styles.body}>{editor?.item.target.repo} #{editor?.item.target.number}</Text><Text style={styles.body}>{editor?.reject ? "Give the agent a reason. No upstream comment will be posted." : editor?.item.policy.reason}</Text>{editor?.item.evidence.map((e,n) => <Link key={n} label={e.label} url={e.url_or_path} />)}</ScrollView>
        <KeyboardDock><TextInput accessibilityLabel={editor?.reject ? "Rejection reason" : "Owner response"} multiline value={text} onChangeText={v => { setText(v); setChanged(true); }} placeholder={editor?.reject ? "Why should this not be posted?" : "Write your response in your own words…"} placeholderTextColor={colors.textMuted} style={styles.input} />
          <Button label={editor?.reject ? "Confirm reject" : "Save owner text"} disabled={!online || !changed || !text.trim() || !editor?.reject && text === editor?.item.body} onPress={() => { if (!editor) return; send({ type: "gate_decide", decision: editor.reject ? { action: "reject", id: editor.item.id, reason: text } : { action: "edit", id: editor.item.id, body: text } }); setEditor(null); }} />
        </KeyboardDock>
      </View>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg }, header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md, gap: space.sm },
  title: { color: colors.text, ...type.title, flexShrink: 1 }, heading: { color: colors.ink, ...type.heading, flexShrink: 1 }, mode: { color: colors.ink2, ...type.small, paddingHorizontal: space.lg, paddingTop: space.sm }, subtitle: { color: colors.textMuted, ...type.small, paddingHorizontal: space.lg, paddingVertical: space.sm },
  content: { padding: space.lg, gap: space.lg }, group: { gap: space.md }, groupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hair2, padding: space.lg, gap: space.sm },
  body: { color: colors.ink, ...type.body }, small: { color: colors.ink2, ...type.small }, badge: { color: colors.textMuted, ...type.small, alignSelf: "center", flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingHorizontal: space.sm }, button: { minHeight: 44, minWidth: 44, justifyContent: "center", paddingHorizontal: space.md, backgroundColor: colors.surfaceRaised, borderRadius: radius.sm }, buttonText: { color: colors.ink, ...type.small },
  link: { minHeight: 44, justifyContent: "center" }, linkText: { color: colors.text, ...type.small, textDecorationLine: "underline", flexShrink: 1 }, error: { color: colors.warn, ...type.small, padding: space.lg },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", padding: space.lg }, sheet: { padding: space.xl, gap: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg },
  input: { color: colors.text, backgroundColor: colors.surface, margin: space.lg, padding: space.lg, borderRadius: radius.md, minHeight: 120, maxHeight: 260, ...type.body, textAlignVertical: "top" },
});
