import { ContextCard, ContextGauge, type ContextControl } from "./ContextCard";
import { Feather } from "@expo/vector-icons";
import { AgentOrb } from "./AgentOrb";
import type { OrbState } from "../lib/orb-phase";
import { useHandedness } from "../lib/useHandedness";
import { MicButton } from "./MicButton";
import { dictate } from "../lib/dictation";
import { insertAtCursor, type Selection } from "../lib/mic-gesture";
import { type RefObject, memo, useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AttachmentChooser, type AttachmentAnchor } from "./AttachmentChooser";
import { dismissKeyboard } from "../lib/dismiss-keyboard";
import type { ChatAttachment } from "../../../shared/protocol";
import { pickFiles, pickPhotos } from "../lib/attachment-picker";
import { uploadPickedFile } from "../lib/attachment-upload";
import {
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
import { useComposerDraft } from "../store/composer-draft";
import { colors, fonts, glass, radius, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { composerMode, type SendMode } from "../lib/composer-mode";
import { haptic } from "../haptics";
import type { IncomingShare } from "../lib/incoming-share";

interface Props {
  /** Conversation id: the unsent text and attachments outlive this view (window close, surface switch). */
  draftKey?: string;
  context?: ContextControl;
  disabled: boolean;
  streaming: boolean;
  steerBusy?: boolean;
  placeholder: string;
  initialText?: string;
  queuePreview?: string;
  onQueuePreviewChange?(text: string): void;
  onSaveQueuePreview?(): void;
  harness?: string;
  cwd?: string;
  blurTarget?: RefObject<View | null>;
  /** Debug fixtures only: chips to show on first render. */
  initialAttachments?: DraftAttachment[];
  sharedDraft?: IncomingShare;
  onSharedDraftConsumed?(id: string): void;
  onSend(text: string, attachments: ChatAttachment[], mode?: SendMode): void;
  onStop(): void;
  onVoice(): void;
  /** A live z0live call's orb state: the mic shows a small live orb instead of the glyph. */
  voiceCall?: OrbState;
}

let draftSeq = 0;
const NO_ATTACHMENTS: DraftAttachment[] = [];

export const Composer = memo(function Composer({ draftKey, context, disabled, streaming, steerBusy = false, placeholder, initialText, queuePreview, onQueuePreviewChange, onSaveQueuePreview, harness, cwd, blurTarget, initialAttachments, sharedDraft, onSharedDraftConsumed, onSend, onStop, onVoice, voiceCall }: Props) {
  const thumb = useHandedness();
  const [choice, setChoice] = useState<SendMode>("steer");
  useEffect(() => { if (!steerBusy) setChoice("steer"); }, [steerBusy]);
  const sendMode = composerMode(steerBusy, choice);
  const switchMode = () => { setChoice(value => value === "steer" ? "queue" : "steer"); haptic.select(); };
  const { text, setText, drafts, setDrafts } = useComposerDraft(draftKey, initialText ?? "", initialAttachments ?? NO_ATTACHMENTS);
  const lastShare = useRef<string | undefined>(undefined);
  const blockedShare = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!sharedDraft || lastShare.current === sharedDraft.id) return;
    // Keep the share queued rather than silently dropping files when a draft is full.
    if (drafts.length + sharedDraft.files.length > MAX_ATTACHMENTS_PER_TURN) {
      if (blockedShare.current !== sharedDraft.id) Alert.alert("Shared files waiting", `Remove attachments to make room for ${sharedDraft.files.length} shared files.`);
      blockedShare.current = sharedDraft.id;
      return;
    }
    lastShare.current = sharedDraft.id;
    setText(value => [value, sharedDraft.text].filter(Boolean).join("\n"));
    setDrafts(list => [...list, ...sharedDraft.files.map((file): DraftAttachment => ({ key: `shared-${++draftSeq}`, name: file.name, mime: file.mime, size: file.size, uri: file.uri, state: "local" }))]);
    onSharedDraftConsumed?.(sharedDraft.id);
  }, [sharedDraft, onSharedDraftConsumed, drafts.length]);
  const mounted = useRef(true);
  const inputRef = useRef<TextInput>(null);
  const attachRef = useRef<View>(null);
  const [attachAnchor, setAttachAnchor] = useState<AttachmentAnchor | null>(null);
  const attachRequest = useRef(0);
  const selection = useRef<Selection | null>(null);
  const [cursor, setCursor] = useState<Selection | undefined>(undefined);
  /** While dictating, focus the field without raising the keyboard; a tap on the field restores normal typing. */
  const [dictating, setDictating] = useState(false);
  const onDictate = useCallback(async () => {
    setDictating(true);
    const result = await dictate();
    if (!mounted.current) return;
    if (result.ok) {
      setText(current => {
        const next = insertAtCursor(current, selection.current, result.text);
        const sel = { start: next.cursor, end: next.cursor };
        selection.current = sel;
        setCursor(sel);
        return next.text;
      });
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (result.reason !== "canceled") {
      Alert.alert("Dictation", result.message ? `System speech recognizer unavailable: ${result.message}` : "System speech recognizer unavailable.");
    }
  }, []);
  useEffect(() => () => { mounted.current = false; }, []);

  const editingQueue = queuePreview !== undefined;
  const draftText = queuePreview ?? text;
  const changeText = editingQueue ? onQueuePreviewChange ?? setText : setText;
  const canSend = editingQueue ? Boolean(draftText.trim()) : canSendDrafts(draftText, drafts) && !disabled;

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

  const onAttach = useCallback(async () => {
    const request = ++attachRequest.current;
    await dismissKeyboard();
    if (!mounted.current || request !== attachRequest.current) return;
    // Measure after the dock has returned from the IME; draft text and selection stay intact.
    requestAnimationFrame(() => attachRef.current?.measureInWindow((x, y, width, height) => {
      if (mounted.current && request === attachRequest.current) setAttachAnchor({ x, y, width, height });
    }));
  }, []);
  useEffect(() => {
    if (disabled || editingQueue) { attachRequest.current++; setAttachAnchor(null); }
  }, [disabled, editingQueue]);

  const uploadShared = () => {
    const local = drafts.filter(d => d.state === "local");
    if (!local.length || disabled) return;
    Alert.alert("Upload shared files?", "Uploads these files to your paired computer over Tailscale. This does not send a message to an agent.", [
      { text: "Cancel", style: "cancel" },
      { text: "Upload files", onPress: () => {
        setDrafts(list => list.filter(d => !local.some(item => item.key === d.key)));
        addFiles(local.map(d => ({ uri: d.uri, name: d.name, mime: d.mime, size: d.size })));
      } },
    ]);
  };

  const remove = useCallback((key: string) => setDrafts(list => list.filter(d => d.key !== key)), []);

  const submit = useCallback(() => {
    if (!canSend) return;
    if (queuePreview !== undefined) { onSaveQueuePreview?.(); return; }
    const refs = readyRefs(drafts);
    const value = text.trim();
    setText("");
    setDrafts([]);
    onSend(value, refs, sendMode.mode);
  }, [canSend, drafts, text, onSend, sendMode.mode, queuePreview, onSaveQueuePreview]);

  return <View style={styles.wrap}>{context ? <ContextCard control={context} /> : null}<ComposerSuggestions text={draftText} harness={harness} cwd={cwd} onChange={changeText} /><GlassSurface blur blurTarget={blurTarget} variant="raised" borderRadius={18} contentStyle={styles.sheet}>
    {drafts.length > 0 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips} accessibilityLabel="Attachments">
        {drafts.map(d => <AttachmentChip key={d.key} draft={d} onRemove={remove} />)}
      </ScrollView>
    ) : null}
    {drafts.some(d => d.state === "local") ? <PressScale accessibilityRole="button" accessibilityLabel="Upload shared files" disabled={disabled || editingQueue} onPress={uploadShared} style={styles.modeToggle}><Text style={styles.chipName}>Upload shared files to paired computer</Text></PressScale> : null}
    {steerBusy && !editingQueue ? <View style={[styles.modeRow, thumb.row]}><Text accessibilityLiveRegion="polite" style={styles.chipMeta}>{sendMode.label}</Text><PressScale accessibilityRole="button" accessibilityLabel={choice === "steer" ? "Choose Queue for next turn" : "Choose Steer the running turn"} onPress={switchMode} style={styles.modeToggle}><Text style={styles.chipName}>{choice === "steer" ? "Queue instead" : "Steer instead"}</Text></PressScale></View> : null}
    <View testID="composer-field" style={[styles.field, editingQueue && styles.previewField]}>
      <TextInput ref={inputRef} style={[styles.input, editingQueue && styles.previewInput]} value={draftText} onChangeText={changeText} selection={cursor} onSelectionChange={e => { selection.current = e.nativeEvent.selection; if (cursor) setCursor(undefined); }} showSoftInputOnFocus={!dictating} onPressIn={() => { if (dictating) setDictating(false); }} placeholder={placeholder} placeholderTextColor={colors.textFaint} multiline scrollEnabled keyboardAppearance="dark" autoCapitalize="sentences" textAlignVertical="top" accessibilityLabel={editingQueue ? "Merged queue preview" : "Message"} />
      <View testID="composer-controls" style={[styles.controls, thumb.row, { justifyContent: thumb.side === "left" ? "flex-start" : "flex-end" }, editingQueue && thumb.align]}>
        {context ? <ContextGauge control={context} /> : null}
        <View ref={attachRef} collapsable={false}><PressScale accessibilityRole="button" accessibilityLabel="Attach file" accessibilityState={{ expanded: attachAnchor !== null }} onPress={onAttach} disabled={disabled || editingQueue} style={styles.hit}><Feather name="paperclip" size={18} color={drafts.length ? colors.gold : colors.textMuted} /></PressScale></View>
        <MicButton side={thumb.side} onDictate={onDictate} onLive={onVoice} onTap={voiceCall ? onVoice : undefined} accessibilityLabel={voiceCall ? `Live call, ${voiceCall.phase}. Open voice` : undefined}>{voiceCall ? <AgentOrb size={22} thinking={voiceCall} label={`live call ${voiceCall.phase}`} /> : undefined}</MicButton>

        {streaming ? <PressScale accessibilityRole="button" accessibilityLabel="Stop" onPress={onStop} style={styles.hit}><View style={[styles.send, styles.stop]}><View style={styles.square} /></View></PressScale> : null}
        <PressScale accessibilityRole="button" accessibilityLabel={editingQueue ? "Save queued merge" : streaming && !steerBusy ? "Queue" : sendMode.action} accessibilityHint={editingQueue ? "Keep this merged message queued for the next turn" : sendMode.label} onPress={submit} disabled={!canSend} style={[styles.hit, editingQueue && styles.previewSave]}>{editingQueue ? <Text style={styles.chipName}>Save queued</Text> : <View style={[styles.send, !canSend && styles.disabled]}><Feather name={sendMode.mode === "steer" ? "corner-up-right" : "arrow-up"} size={20} color={colors.onAccent} /></View>}</PressScale>
      </View>
    </View>
  </GlassSurface>
  {attachAnchor ? <AttachmentChooser anchor={attachAnchor} onClose={() => setAttachAnchor(null)} onPick={kind => {
    setAttachAnchor(null);
    Keyboard.dismiss();
    // Keep this synchronous on web: the OS picker requires the row's user activation.
    void pick(kind);
  }} /> : null}
  </View>;
});

const AttachmentChip = memo(function AttachmentChip({ draft, onRemove }: { draft: DraftAttachment; onRemove(key: string): void }) {
  const failed = draft.state === "error";
  const meta = failed ? draft.error ?? "Failed" : draft.state === "local" ? "On this phone · not uploaded" : draft.state === "uploading" ? "Uploading…" : formatSize(draft.size);
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
  field: { flexDirection: "column", alignItems: "stretch", minHeight: 96 },
  previewField: { flexDirection: "column", alignItems: "stretch" },
  previewInput: { flex: 0, minHeight: 168, maxHeight: 192 },
  previewSave: { width: 100 },
  input: { flex: 0, alignSelf: "stretch", minWidth: 0, minHeight: 48, maxHeight: 148, ...type.body, color: colors.text, paddingLeft: 8, paddingTop: 12, paddingBottom: 12 },
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
