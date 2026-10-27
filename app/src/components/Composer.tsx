import { isUsageCommand } from "../lib/composer-command";
import { ContextCard, ContextGauge, type ContextControl } from "./ContextCard";
import { Feather } from "@expo/vector-icons";
import { AgentOrb } from "./AgentOrb";
import type { OrbState } from "../lib/orb-phase";
import { useHandedness } from "../lib/useHandedness";
import { MicButton } from "./MicButton";
import { useRecordedSpeech } from "../lib/useRecordedSpeech";
import { insertAtCursor, type Selection } from "../lib/mic-gesture";
import { type RefObject, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AttachmentChooser, type AttachmentAnchor } from "./AttachmentChooser";
import { dismissKeyboard } from "../lib/dismiss-keyboard";
import type { ChatAttachment } from "../../../shared/protocol";
import * as Clipboard from "expo-clipboard";
import { clipboardInsertion } from "../lib/clipboard-paste";
import { clipboardImageFile } from "../lib/clipboard-image";
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
import { colors, fonts, glass, radius, type } from "../theme";
import { GlassSurface } from "./GlassSurface";
import { PressScale } from "./PressScale";
import { ComposerSuggestions } from "./ComposerSuggestions";
import { composerMode, type SendMode } from "../lib/composer-mode";
import { haptic } from "../haptics";
import type { IncomingShare } from "../lib/incoming-share";
import { composerDrafts, updateComposerDraft, type ComposerDraft } from "../store/composer-drafts";

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

export const Composer = memo(function Composer({ draftKey, context, disabled, streaming, steerBusy = false, placeholder, initialText, queuePreview, onQueuePreviewChange, onSaveQueuePreview, harness, cwd, blurTarget, initialAttachments, sharedDraft, onSharedDraftConsumed, onSend, onStop, onVoice, voiceCall }: Props) {
  const thumb = useHandedness();
  const [choice, setChoice] = useState<SendMode>("steer");
  useEffect(() => { if (!steerBusy) setChoice("steer"); }, [steerBusy]);
  const sendMode = composerMode(steerBusy, choice);
  const switchMode = () => { setChoice(value => value === "steer" ? "queue" : "steer"); haptic.select(); };
  const [seed] = useState<ComposerDraft>(() => ({ text: initialText ?? "", attachments: initialAttachments ?? [] }));
  const [localDraft, setLocalDraft] = useState(seed);
  const savedDraft = composerDrafts.use(all => draftKey ? all[draftKey] : undefined);
  const { text, attachments: drafts } = savedDraft ?? localDraft;
  const changeDraft = useCallback((update: (draft: ComposerDraft) => ComposerDraft) => {
    if (draftKey) updateComposerDraft(draftKey, seed, update); else setLocalDraft(update);
  }, [draftKey, seed]);
  // A draft handed over on open (main bar Send, a search result) is the owner's latest words for
  // this chat. A saved draft for the chat (often an empty one left by clearing it) used to win
  // over it, so the new chat opened empty (e2e B5). Once per mount: the composer is keyed by it.
  useLayoutEffect(() => {
    if (draftKey && initialText) updateComposerDraft(draftKey, seed, draft => draft.text === initialText ? draft : { ...draft, text: initialText });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setText = useCallback((value: string | ((previous: string) => string)) => changeDraft(draft => ({ ...draft, text: typeof value === "function" ? value(draft.text) : value })), [changeDraft]);
  const setDrafts = useCallback((value: DraftAttachment[] | ((previous: DraftAttachment[]) => DraftAttachment[])) => changeDraft(draft => ({ ...draft, attachments: typeof value === "function" ? value(draft.attachments) : value })), [changeDraft]);
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
  const speech = useRecordedSpeech("dictation", transcript => {
    if (mounted.current) {
      setText(current => {
        const next = insertAtCursor(current, selection.current, transcript);
        const sel = { start: next.cursor, end: next.cursor };
        selection.current = sel;
        setCursor(sel);
        return next.text;
      });
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  });
  const speechBusy = ["preparing", "recording", "transcribing"].includes(speech.state.phase);
  const onDictate = () => {
    if (queuePreview !== undefined) return;
    setDictating(true);
    if (speechBusy) void speech.end(); else void speech.begin();
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const editingQueue = queuePreview !== undefined;
  const draftText = queuePreview ?? text;
  const changeText = editingQueue ? onQueuePreviewChange ?? setText : setText;
  const localUsage = !editingQueue && Boolean(context) && isUsageCommand(draftText);
  const canSend = localUsage || (editingQueue ? Boolean(draftText.trim()) : canSendDrafts(draftText, drafts) && !disabled);

  const update = useCallback((key: string, patch: Partial<DraftAttachment>) => {
    // An upload completion belongs to its original draft even while offscreen.
    setDrafts(list => list.map(d => (d.key === key ? { ...d, ...patch } : d)));
  }, [setDrafts]);

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

  const [fieldFocused, setFieldFocused] = useState(false);
  const [clipboardHasImage, setClipboardHasImage] = useState(false);
  const [pastingImage, setPastingImage] = useState(false);
  const pasteBusy = useRef(false);
  useEffect(() => {
    if (Platform.OS === "web" || !fieldFocused || editingQueue || disabled) { setClipboardHasImage(false); return; }
    let disposed = false;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const hasImage = await Clipboard.hasImageAsync();
        if (!disposed && current === request) setClipboardHasImage(hasImage);
      } catch { if (!disposed && current === request) setClipboardHasImage(false); }
    };
    void refresh();
    const subscription = Clipboard.addClipboardListener(() => { void refresh(); });
    return () => { disposed = true; subscription.remove(); };
  }, [fieldFocused, editingQueue, disabled]);

  const pasteImage = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web" || disabled || editingQueue || pasteBusy.current) return false;
    if (remainingSlots(drafts) === 0) { Alert.alert("Attachments", `Up to ${MAX_ATTACHMENTS_PER_TURN} files per message.`); return false; }
    if (!store.get().settings) { Alert.alert("Attachments", "Pair with a computer first."); return false; }
    pasteBusy.current = true;
    setPastingImage(true);
    try {
      const file = await clipboardImageFile();
      if (!file || !mounted.current) return false;
      addFiles([file]);
      return true;
    } catch (error) {
      if (mounted.current) Alert.alert("Attachments", error instanceof Error ? error.message : "Could not paste the clipboard image.");
      return false;
    } finally {
      pasteBusy.current = false;
      if (mounted.current) setPastingImage(false);
    }
  }, [disabled, editingQueue, drafts, addFiles]);

  const onTextChange = (next: string) => {
    changeText(next);
    if (Platform.OS === "web" || editingQueue || disabled) return;
    const insertion = clipboardInsertion(draftText, next);
    if (!insertion) return;
    // Never clobber edits made while the clipboard/cache operation was awaiting I/O.
    void Clipboard.hasImageAsync().then(async hasImage => {
      if (!hasImage || !mounted.current) return;
      const attached = await pasteImage();
      if (attached && insertion.contentUri && mounted.current) setText(current => current === next ? insertion.withoutUri : current);
    }).catch(() => { /* Clipboard unavailable: retain the text insertion. */ });
  };

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
    if (localUsage && context) { setText(""); Keyboard.dismiss(); context.showUsage(); return; }
    if (!canSend) return;
    if (queuePreview !== undefined) { onSaveQueuePreview?.(); return; }
    const refs = readyRefs(drafts);
    const value = text.trim();
    setText("");
    setDrafts([]);
    onSend(value, refs, sendMode.mode);
  }, [localUsage, context, canSend, drafts, text, onSend, sendMode.mode, queuePreview, onSaveQueuePreview]);

  return <View style={styles.wrap}>{context ? <ContextCard control={context} /> : null}<ComposerSuggestions text={draftText} harness={harness} cwd={cwd} onChange={changeText} onUsage={context ? () => { if (isUsageCommand(draftText)) changeText(""); Keyboard.dismiss(); context.showUsage(); } : undefined} /><GlassSurface blur blurTarget={blurTarget} variant="raised" borderRadius={18} contentStyle={styles.sheet}>
    {drafts.length > 0 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips} accessibilityLabel="Attachments">
        {drafts.map(d => <AttachmentChip key={d.key} draft={d} onRemove={remove} />)}
      </ScrollView>
    ) : null}
    {drafts.some(d => d.state === "local") ? <PressScale accessibilityRole="button" accessibilityLabel="Upload shared files" disabled={disabled || editingQueue} onPress={uploadShared} style={styles.modeToggle}><Text style={styles.chipName}>Upload shared files to paired computer</Text></PressScale> : null}
    {clipboardHasImage && !editingQueue ? <PressScale accessibilityRole="button" accessibilityLabel="Paste image" disabled={disabled || pastingImage} onPress={() => { void pasteImage(); }} style={styles.modeToggle}><Text style={styles.chipName}>{pastingImage ? "Pasting image…" : "Paste image"}</Text></PressScale> : null}
    {steerBusy && !editingQueue ? <View style={[styles.modeRow, thumb.row]}><Text accessibilityLiveRegion="polite" style={styles.chipMeta}>{sendMode.label}</Text><PressScale accessibilityRole="button" accessibilityLabel={choice === "steer" ? "Choose Queue for next turn" : "Choose Steer the running turn"} onPress={switchMode} style={styles.modeToggle}><Text style={styles.chipName}>{choice === "steer" ? "Queue instead" : "Steer instead"}</Text></PressScale></View> : null}
    {speech.state.note ? <View style={styles.modeRow}>
      <Text accessibilityLiveRegion="polite" accessibilityRole={speech.state.phase === "error" ? "alert" : "text"} style={styles.chipMeta}>{speech.state.note}</Text>
      {speechBusy ? <PressScale accessibilityRole="button" accessibilityLabel="Stop dictation" onPress={() => void speech.end()} style={styles.modeToggle}><Text style={styles.chipName}>Stop</Text></PressScale> : null}
      {speech.state.phase === "error" ? <PressScale accessibilityRole="button" accessibilityLabel="Retry dictation" onPress={onDictate} style={styles.modeToggle}><Text style={styles.chipName}>Retry</Text></PressScale> : null}
    </View> : null}
    <View testID="composer-field" style={[styles.field, editingQueue && styles.previewField]}>
      <TextInput ref={inputRef} style={[styles.input, editingQueue && styles.previewInput]} value={draftText} onChangeText={onTextChange} onFocus={() => setFieldFocused(true)} onBlur={() => setFieldFocused(false)} selection={cursor} onSelectionChange={e => { selection.current = e.nativeEvent.selection; if (cursor) setCursor(undefined); }} showSoftInputOnFocus={!dictating} onPressIn={() => { if (dictating) setDictating(false); }} placeholder={placeholder} placeholderTextColor={colors.textFaint} multiline scrollEnabled keyboardAppearance="dark" autoCapitalize="sentences" textAlignVertical="top" accessibilityLabel={editingQueue ? "Merged queue preview" : "Message"} />
      <View testID="composer-controls" style={[styles.controls, { flexDirection: "row", justifyContent: "flex-start" }, editingQueue && thumb.align]}>
        {/* One primary button at the text's leading edge: Send/Steer/Queue when there is a draft, Stop while a turn runs with an empty draft. */}
        {editingQueue ? <PressScale accessibilityRole="button" accessibilityLabel="Save queued merge" accessibilityHint="Keep this merged message queued for the next turn" onPress={submit} disabled={!canSend} style={[styles.hit, styles.previewSave]}><Text style={styles.chipName}>Save queued</Text></PressScale>
          : (streaming || steerBusy) && !canSend ? <PressScale accessibilityRole="button" accessibilityLabel="Stop" onPress={onStop} style={styles.hit}><View style={[styles.send, styles.stop]}><View style={styles.square} /></View></PressScale>
          : <PressScale accessibilityRole="button" accessibilityLabel={streaming && !steerBusy ? "Queue" : sendMode.action} accessibilityHint={sendMode.label} onPress={submit} disabled={!canSend} style={styles.hit}><View style={[styles.send, !canSend && styles.disabled]}><Feather name={sendMode.mode === "steer" ? "corner-up-right" : "arrow-up"} size={20} color={colors.onAccent} /></View></PressScale>}
        {context ? <ContextGauge control={context} /> : null}
        <View ref={attachRef} collapsable={false}><PressScale accessibilityRole="button" accessibilityLabel="Attach file" accessibilityState={{ expanded: attachAnchor !== null }} onPress={onAttach} disabled={disabled || editingQueue} style={styles.hit}><Feather name="paperclip" size={18} color={drafts.length ? colors.gold : colors.textMuted} /></PressScale></View>
        <MicButton side={thumb.side} onDictate={onDictate} onLive={onVoice} onTap={speechBusy ? onDictate : voiceCall ? onVoice : undefined} accessibilityLabel={speechBusy ? "Stop dictation" : voiceCall ? `Live call, ${voiceCall.phase}. Open voice` : undefined}>{voiceCall ? <AgentOrb size={22} thinking={voiceCall} label={`live call ${voiceCall.phase}`} /> : undefined}</MicButton>

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
