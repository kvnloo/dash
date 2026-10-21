import { Feather } from "@expo/vector-icons";
import { AgentOrb } from "./AgentOrb";
import type { OrbState } from "../lib/orb-phase";
import { toggleHandedness, useHandedness } from "../lib/useHandedness";
import { type RefObject, memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ChatAttachment } from "../../../shared/protocol";
import { pickFiles, pickPhotos } from "../lib/attachment-picker";
import { uploadPickedFile } from "../lib/attachment-upload";
import {
  LIMIT_LABEL,
  MAX_ATTACHMENTS_PER_TURN,
  canSendDrafts,
  formatSize,
  isImage,
  readyRefs,
  rejectReason,
  remainingSlots,
  type DraftAttachment,
  type PickedFile,
} from "../lib/attachments";
import { store } from "../store/app";
import { colors, fonts, glass, radius, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { composerMode, type SendMode } from "../lib/composer-mode";
import { haptic } from "../haptics";

interface Props {
  disabled: boolean;
  streaming: boolean;
  steerBusy?: boolean;
  placeholder: string;
  initialText?: string;
  harness?: string;
  cwd?: string;
  blurTarget?: RefObject<View | null>;
  /** Debug fixtures only: chips to show on first render. */
  initialAttachments?: DraftAttachment[];
  onSend(text: string, attachments: ChatAttachment[], mode?: SendMode): void;
  onStop(): void;
  onVoice(): void;
  /** A live z0live call's orb state: the mic shows a small live orb instead of the glyph. */
  voiceCall?: OrbState;
}

let draftSeq = 0;

export const Composer = memo(function Composer({ disabled, streaming, steerBusy = false, placeholder, initialText, harness, cwd, blurTarget, initialAttachments, onSend, onStop, onVoice, voiceCall }: Props) {
  const thumb = useHandedness();
  const [choice, setChoice] = useState<SendMode>("steer");
  useEffect(() => { if (!steerBusy) setChoice("steer"); }, [steerBusy]);
  const sendMode = composerMode(steerBusy, choice);
  const switchMode = () => { setChoice(value => value === "steer" ? "queue" : "steer"); haptic.select(); };
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
      uploadPickedFile(settings, file).then(
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
    onSend(value, refs, sendMode.mode);
  }, [canSend, drafts, text, onSend, sendMode.mode]);

  return <View style={styles.wrap}><ComposerSuggestions text={text} harness={harness} cwd={cwd} onChange={setText} /><GlassSurface blur blurTarget={blurTarget} variant="raised" borderRadius={18} contentStyle={styles.sheet}>
    {drafts.length > 0 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips} accessibilityLabel="Attachments">
        {drafts.map(d => <AttachmentChip key={d.key} draft={d} onRemove={remove} />)}
      </ScrollView>
    ) : null}
    {steerBusy ? <View style={[styles.modeRow, thumb.row]}><Text accessibilityLiveRegion="polite" style={styles.chipMeta}>{sendMode.label}</Text><PressScale accessibilityRole="button" accessibilityLabel={choice === "steer" ? "Choose Queue for next turn" : "Choose Steer the running turn"} onPress={switchMode} style={styles.modeToggle}><Text style={styles.chipName}>{choice === "steer" ? "Queue instead" : "Steer instead"}</Text></PressScale></View> : null}
    <View style={[styles.field, thumb.row]}>
      <TextInput style={styles.input} value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={colors.textFaint} multiline scrollEnabled keyboardAppearance="dark" autoCapitalize="sentences" textAlignVertical="top" accessibilityLabel="Message" />
      <View style={[styles.controls, thumb.row]}>
        <PressScale accessibilityRole="button" accessibilityLabel="Attach file" onPress={onAttach} disabled={disabled} style={styles.hit}><Feather name="paperclip" size={18} color={drafts.length ? colors.gold : colors.textMuted} /></PressScale>
        <PressScale accessibilityRole="button" accessibilityLabel={voiceCall ? `Live call, ${voiceCall.phase}. Open voice` : "Voice input"} accessibilityHint="Long press to switch thumb side" onLongPress={toggleHandedness} onPress={onVoice} style={styles.hit}>{voiceCall ? <AgentOrb size={22} thinking={voiceCall} label={`live call ${voiceCall.phase}`} /> : <Feather name="mic" size={18} color={colors.textMuted} />}</PressScale>
        {streaming ? <PressScale accessibilityRole="button" accessibilityLabel="Stop" onPress={onStop} style={styles.hit}><View style={[styles.send, styles.stop]}><View style={styles.square} /></View></PressScale> : null}
        {steerBusy || !streaming ? <PressScale accessibilityRole="button" accessibilityLabel={sendMode.action} accessibilityHint={sendMode.label} onPress={submit} disabled={!canSend} style={styles.hit}><View style={[styles.send, !canSend && styles.disabled]}><Feather name={sendMode.mode === "steer" ? "corner-up-right" : "arrow-up"} size={20} color={colors.onAccent} /></View></PressScale> : null}
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
  input: { flex: 1, minWidth: 0, maxHeight: 148, ...type.body, color: colors.text, paddingLeft: 8, paddingTop: 12, paddingBottom: 12 },
  controls: { flexDirection: "row", alignItems: "center", flexShrink: 0 },
  modeRow: { alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 },
  modeToggle: { minHeight: 44, paddingHorizontal: 8 },
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
