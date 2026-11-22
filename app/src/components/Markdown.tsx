import { memo, useMemo, useState, type ReactNode } from "react";
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextStyle } from "react-native";
import { Renderer, useMarkdown, type MarkedStyles } from "react-native-marked";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius, space, type } from "../theme";
import type { LiveIntent } from "../../../shared/live";
import { GenerativeBlock } from "./genui/GenerativeBlock";
import { InlineImage } from "./genui/InlineImage";
import { isImageRef } from "../lib/genui";
import { annotate } from "../store/annotate";
import { store } from "../store/app";
import { haptic } from "../haptics";
import { readableReplyText, replyToSelection, selectedReplyText, type SelectionRange } from "./selection-quote";
import { prepareGenerativeMarkdown } from "../lib/generative-stream";
import { flowMode } from "../lib/flow-trace";

import { linkifyMarkdown } from "../lib/linkify-paths";
import { classifyLink, linkAccessibilityHint } from "../lib/link-target";
import { FileLinkPreview, type FileLinkTarget } from "./FileLinkPreview";

// react-native-marked prepends "/" to relative hrefs. Keep generated source
// paths opaque until the link renderer can distinguish them from absolute paths.
const SOURCE_LINK = "dashsource:";
const sourceHref = (path: string) => SOURCE_LINK + encodeURIComponent(path);
function transcriptLink(href: string) {
  if (!href.startsWith(SOURCE_LINK)) return classifyLink(href);
  try {
    const target = classifyLink(decodeURIComponent(href.slice(SOURCE_LINK.length)));
    if (target.kind === "file") return target;
  } catch { /* Malformed escaped source path. */ }
  return classifyLink("");
}

class TranscriptRenderer extends Renderer {
  onFileLink?: (target: FileLinkTarget) => void;
  onIntent?: (intent: LiveIntent) => boolean;
  streaming = false;
  override code(code: string, language = ""): ReactNode {
    return <GenerativeBlock key={this.getKey()} code={code} streaming={this.streaming} language={language.trim().toLowerCase().split(/\s/)[0] ?? ""} onIntent={this.onIntent} />;
  }
  override link(children: string | ReactNode[], href: string, style?: TextStyle): ReactNode {
    if (isImageRef(href)) return <InlineImage key={this.getKey()} href={href} label="Image" />;
    const target = transcriptLink(href);
    if (target.kind !== "web" && (target.kind !== "file" || !this.onFileLink)) {
      return <Text key={this.getKey()}>{children}</Text>;
    }
    return <Text key={this.getKey()} selectable={Platform.OS === "ios"} accessibilityRole="link"
      accessibilityHint={linkAccessibilityHint(target)} style={style} onPress={() => {
        if (target.kind === "web") void Linking.openURL(target.url).catch(() => {});
        else this.onFileLink?.(target);
      }}>{children}</Text>;
  }
  override image(uri: string, alt?: string): ReactNode {
    return /^https?:\/\//i.test(uri) || isImageRef(uri) ? <InlineImage key={this.getKey()} href={uri} label={alt || "Image"} /> : null;
  }
  override linkImage(_href: string, imageUri: string, alt?: string): ReactNode { return this.image(imageUri, alt); }
}

interface PendingReplySelection { source: string; conversationId: string }

function ReplySelectionSheet({ source, selection, onSelection, onCancel, onReply }: {
  source: string;
  selection: SelectionRange | null;
  onSelection(selection: SelectionRange): void;
  onCancel(): void;
  onReply(): void;
}) {
  const insets = useSafeAreaInsets();
  const canReply = selectedReplyText(source, selection).length > 0;
  return <Modal visible transparent animationType="none" onRequestClose={onCancel} statusBarTranslucent>
    <View style={selectionStyles.scrim}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Cancel text selection" onPress={onCancel} />
      <View style={[selectionStyles.sheet, { marginBottom: Math.max(insets.bottom, space.md) }]}>
        <Text style={selectionStyles.title}>Select message text</Text>
        <Text style={selectionStyles.hint}>Adjust the selection handles to choose what to quote.</Text>
        <TextInput
          testID="reply-selection-input"
          accessibilityLabel="Message text selection"
          value={source}
          multiline
          autoFocus
          selectTextOnFocus
          showSoftInputOnFocus={false}
          importantForAutofill="no"
          autoCorrect={false}
          selectionColor={colors.gold}
          selectionHandleColor={colors.gold}
          onSelectionChange={event => onSelection(event.nativeEvent.selection)}
          style={selectionStyles.input}
        />
        <View style={selectionStyles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel selection" onPress={onCancel} style={selectionStyles.action}>
            <Text style={selectionStyles.actionText}>Cancel</Text>
          </Pressable>
          <Pressable
            testID="reply-to-selection"
            accessibilityRole="button"
            accessibilityLabel="Reply to selection"
            accessibilityState={{ disabled: !canReply }}
            disabled={!canReply}
            onPress={onReply}
            style={[selectionStyles.action, selectionStyles.primary, !canReply && selectionStyles.disabled]}
          >
            <Text style={selectionStyles.actionText}>Reply to selection</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

export const Markdown = memo(function Markdown({ text, messageId, onIntent, streaming = false }: { text: string; messageId?: string; onIntent?: (intent: LiveIntent) => boolean; streaming?: boolean }) {
  const [pendingSelection, setPendingSelection] = useState<PendingReplySelection | null>(null);
  const [range, setRange] = useState<SelectionRange | null>(null);
  const [filePreview, setFilePreview] = useState<FileLinkTarget | null>(null);
  // Unfinished UI fences are buffered before Markdown can expose model source.
  const prepared = useMemo(() => linkifyMarkdown(prepareGenerativeMarkdown(text, flowMode), !streaming, sourceHref), [text, streaming]);
  // Android and web use the quote-selection sheet; iOS keeps native text selection.
  // Browser-native selection can cancel the Pressable long press before the sheet opens.
  const renderer = useMemo(() => { const renderer = new TranscriptRenderer({ selectable: Platform.OS === "ios" }); renderer.onIntent = onIntent; renderer.onFileLink = messageId ? setFilePreview : undefined; renderer.streaming = streaming; return renderer; }, [prepared, messageId, onIntent, streaming]);
  const nodes = useMarkdown(prepared, { renderer, styles, colorScheme: "dark" });
  const onLongPress = () => {
    if (Platform.OS === "ios" || annotate.get().active) return;
    const state = store.get();
    if (!state.activeId || !state.conversations.some(c => c.id === state.activeId)) return;
    const source = readableReplyText(text);
    if (!source.trim()) return;
    setRange(null);
    setPendingSelection({ source, conversationId: state.activeId });
    haptic.select();
  };
  const cancelSelection = () => { setPendingSelection(null); setRange(null); };
  const onReply = () => {
    if (!pendingSelection || annotate.get().active || store.get().activeId !== pendingSelection.conversationId) {
      cancelSelection();
      return;
    }
    if (replyToSelection(pendingSelection.conversationId, pendingSelection.source, range)) {
      haptic.select();
      cancelSelection();
    }
  };
  // Hook only, not the library's nested FlatList. FlashList owns vertical scroll.
  return <View>
    <Pressable testID="reply-selection-trigger" accessible={false} delayLongPress={350} onLongPress={onLongPress}><View>{nodes}</View></Pressable>
    {filePreview && messageId ? <FileLinkPreview target={filePreview} messageId={messageId} onClose={() => setFilePreview(null)} /> : null}
    {pendingSelection ? <ReplySelectionSheet source={pendingSelection.source} selection={range} onSelection={setRange} onCancel={cancelSelection} onReply={onReply} /> : null}
  </View>;
});

const selectionStyles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: "flex-end", paddingHorizontal: space.lg, backgroundColor: "rgba(0,0,0,0.72)" },
  sheet: { alignSelf: "center", width: "100%", maxWidth: 560, backgroundColor: colors.surface, borderRadius: radius.lg, borderColor: colors.hair, borderWidth: 1, padding: space.md, gap: space.sm },
  title: { ...type.heading, color: colors.text },
  hint: { ...type.small, color: colors.textMuted },
  input: { ...type.body, color: colors.text, backgroundColor: colors.bg, minHeight: 96, maxHeight: 260, paddingHorizontal: space.md, paddingVertical: space.sm, textAlignVertical: "top", borderRadius: radius.sm },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: space.sm },
  action: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: radius.sm, paddingHorizontal: space.md },
  primary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.hair },
  disabled: { opacity: 0.4 },
  actionText: { ...type.small, color: colors.text },
});

const styles: MarkedStyles = StyleSheet.create({
  text: { color: colors.text, ...type.body },
  paragraph: { paddingVertical: 3, marginBottom: 4 },
  h1: { ...type.heading, fontSize: 21, lineHeight: 27, marginVertical: 6, paddingBottom: 0, borderBottomWidth: 0 },
  h2: { ...type.heading, fontSize: 18, lineHeight: 24, marginVertical: 6, paddingBottom: 0, borderBottomWidth: 0 },
  h3: { ...type.heading, marginVertical: 4 },
  strong: { ...type.body, color: colors.text, fontFamily: fonts.semibold },
  codespan: { fontFamily: fonts.mono, fontSize: 13, fontStyle: "normal", color: colors.gold, backgroundColor: colors.surfaceRaised },
  link: { ...type.body, color: colors.gold, fontStyle: "normal", textDecorationLine: "underline" },
  blockquote: { backgroundColor: colors.surface, borderLeftColor: colors.textTertiary, borderLeftWidth: 2, paddingHorizontal: 10 },
  li: { ...type.body, color: colors.text },
  table: { borderWidth: 1, borderColor: colors.hair, marginVertical: 6 },
  tableRow: { backgroundColor: colors.surface },
  hr: { borderBottomColor: colors.hair, borderBottomWidth: 1, marginVertical: 8 },
});
