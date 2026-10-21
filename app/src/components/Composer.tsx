import { Feather } from "@expo/vector-icons";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ChatAttachment } from "../../../shared/protocol";
import { pickFiles, pickPhotos } from "../lib/attachment-picker";
import {
  LIMIT_LABEL,
  MAX_ATTACHMENTS_PER_TURN,
  canSendDrafts,
  formatSize,
  isImage,
  readyRefs,
  rejectReason,
  remainingSlots,
  uploadAttachment,
  type DraftAttachment,
  type PickedFile,
} from "../lib/attachments";
import { store } from "../store/app";
import { colors, fonts, glass, radius, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";
import { ComposerSuggestions } from "./ComposerSuggestions";

interface Props {
  disabled: boolean;
  streaming: boolean;
  placeholder: string;
  initialText?: string;
  harness?: string;
  cwd?: string;
  /** Debug fixtures only: chips to show on first render. */
  initialAttachments?: DraftAttachment[];
  onSend(text: string, attachments: ChatAttachment[]): void;
  onStop(): void;
  onVoice(): void;
}

let draftSeq = 0;

export const Composer = memo(function Composer({ disabled, streaming, placeholder, initialText, harness, cwd, initialAttachments, onSend, onStop, onVoice }: Props) {
  const [text, setText] = useState(initialText ?? "");
  const [drafts, setDrafts] = useState<DraftAttachment[]>(initialAttachments ?? []);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const canSend = canSendDrafts(text, drafts) && !disabled;

  const update = useCallback((key: string, patch: Partial<DraftAttachment>) => {
    if (!mounted.current) return;
    setDrafts(list => list.map(d => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  const addFiles = useCallback((picked: PickedFile[]) => {
    const settings = store.get().settings;
    if (!settings) { Alert.alert("Attachments", "Pair with a computer first."); return; }
    const added: DraftAttachment[] = picked.map(file => {
      const reason = rejectReason(file);
      return { key: `att-${++draftSeq}`, name: file.name, mime: file.mime, size: file.size, uri: file.uri, state: reason ? "error" : "uploading", error: reason ?? undefined };
    });
    setDrafts(list => [...list, ...added]);
    picked.forEach((file, i) => {
      const draft = added[i];
      if (!draft || draft.state === "error") return;
      uploadAttachment(settings, file, fetch).then(
        ref => update(draft.key, { state: "ready", ref, size: ref.size }),
        (error: unknown) => update(draft.key, { state: "error", error: error instanceof Error ? error.message : "Upload failed." }),
      );
    });
  }, [update]);

  const pick = useCallback(async (kind: "photos" | "files") => {
    const room = remainingSlots(drafts);
    if (room === 0) { Alert.alert("Attachments", `Up to ${MAX_ATTACHMENTS_PER_TURN} files per message.`); return; }
    try {
      const picked = kind === "photos" ? await pickPhotos(room) : await pickFiles(room);
      if (picked.length) addFiles(picked);
    } catch (error) {
      Alert.alert("Attachments", error instanceof Error ? error.message : "Could not open the picker.");
    }
  }, [addFiles, drafts]);

  const onAttach = useCallback(() => {
    // React Native Web has no multi-button Alert; its file dialog covers photos too.
    if (Platform.OS === "web") { void pick("files"); return; }
    Alert.alert("Attach", `Up to ${LIMIT_LABEL} per file, sent to the paired computer over Tailscale.`, [
      { text: "Photos", onPress: () => void pick("photos") },
      { text: "Files", onPress: () => void pick("files") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [pick]);

  const remove = useCallback((key: string) => setDrafts(list => list.filter(d => d.key !== key)), []);

  const submit = useCallback(() => {
    if (!canSend) return;
    const refs = readyRefs(drafts);
    const value = text.trim();
    setText("");
    setDrafts([]);
    onSend(value, refs);
  }, [canSend, drafts, text, onSend]);

  return <View style={styles.wrap}><ComposerSuggestions text={text} harness={harness} cwd={cwd} onChange={setText} /><GlassSurface blur borderRadius={18} contentStyle={styles.sheet}>
    {drafts.length > 0 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips} accessibilityLabel="Attachments">
        {drafts.map(d => <AttachmentChip key={d.key} draft={d} onRemove={remove} />)}
      </ScrollView>
    ) : null}
    <View style={styles.field}>
      <TextInput style={styles.input} value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={colors.textFaint} multiline={false} numberOfLines={1} keyboardAppearance="dark" autoCapitalize="sentences" onSubmitEditing={submit} accessibilityLabel="Message" />
      <View style={styles.controls}>
        <PressScale accessibilityRole="button" accessibilityLabel="Attach file" onPress={onAttach} disabled={disabled} style={styles.hit}><Feather name="paperclip" size={18} color={drafts.length ? colors.gold : colors.textMuted} /></PressScale>
        <PressScale accessibilityRole="button" accessibilityLabel="Voice input" onPress={onVoice} style={styles.hit}><Feather name="mic" size={18} color={colors.textMuted} /></PressScale>
        <PressScale accessibilityRole="button" accessibilityLabel={streaming ? "Stop" : "Send"} onPress={streaming ? onStop : submit} disabled={!streaming && !canSend} style={styles.hit}><View style={[styles.send, streaming && styles.stop, !streaming && !canSend && styles.disabled]}>{streaming ? <View style={styles.square} /> : <Feather name="arrow-up" size={20} color={colors.onAccent} />}</View></PressScale>
      </View>
    </View>
  </GlassSurface></View>;
});

const AttachmentChip = memo(function AttachmentChip({ draft, onRemove }: { draft: DraftAttachment; onRemove(key: string): void }) {
  const failed = draft.state === "error";
  const meta = failed ? draft.error ?? "Failed" : draft.state === "uploading" ? "Uploading…" : formatSize(draft.size);
  return <View style={[styles.chip, failed && styles.chipError]} accessibilityLabel={`${draft.name}, ${meta}`}>
    {isImage(draft.mime) && !failed
      ? <Image source={{ uri: draft.uri }} style={styles.thumb} accessibilityIgnoresInvertColors />
      : <View style={styles.fileIcon}><Feather name={failed ? "alert-circle" : "file-text"} size={15} color={failed ? colors.danger : colors.textMuted} /></View>}
    <View style={styles.chipText}>
      <Text style={styles.chipName} numberOfLines={1}>{draft.name}</Text>
      <Text style={[styles.chipMeta, failed && styles.chipMetaError]} numberOfLines={1}>{meta}</Text>
    </View>
    {draft.state === "uploading" ? <ActivityIndicator size="small" color={colors.gold} style={styles.spinner} /> : null}
    <PressScale accessibilityRole="button" accessibilityLabel={`Remove ${draft.name}`} onPress={() => onRemove(draft.key)} style={styles.remove}><Feather name="x" size={14} color={colors.textMuted} /></PressScale>
  </View>;
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 8, gap: 8 },
  sheet: { paddingHorizontal: 8 },
  field: { flexDirection: "row", alignItems: "center", minHeight: 60 },
  input: { flex: 1, minWidth: 0, ...type.body, color: colors.text, paddingLeft: 8, paddingVertical: 12 },
  controls: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  hit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  send: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  stop: { backgroundColor: colors.text },
  disabled: { opacity: .3 },
  square: { width: 12, height: 12, borderRadius: 2, backgroundColor: colors.bg },
  chips: { gap: 8, paddingTop: 10, paddingHorizontal: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, height: 44, maxWidth: 220, paddingLeft: 4, paddingRight: 2, borderRadius: radius.card + 2, backgroundColor: glass.fillChipOn, borderWidth: 1, borderColor: glass.hair, borderTopColor: glass.highlight },
  chipError: { borderColor: colors.danger },
  thumb: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: glass.fill },
  fileIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: glass.quiet },
  chipText: { flexShrink: 1, minWidth: 0 },
  chipName: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, color: colors.text },
  chipMeta: { ...type.mono, fontSize: 11, lineHeight: 14, color: colors.textTertiary },
  chipMetaError: { color: colors.danger, fontFamily: fonts.body },
  spinner: { marginHorizontal: 2 },
  remove: { width: 28, height: 40, alignItems: "center", justifyContent: "center" },
});
