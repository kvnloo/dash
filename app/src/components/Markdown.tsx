import { memo, useMemo, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View, type TextStyle } from "react-native";
import { Renderer, useMarkdown, type MarkedStyles } from "react-native-marked";
import { colors, fonts, type } from "../theme";
import type { LiveIntent } from "../../../shared/live";
import { GenerativeBlock } from "./genui/GenerativeBlock";
import { InlineImage } from "./genui/InlineImage";
import { isImageRef } from "../lib/genui";
import { prepareGenerativeMarkdown } from "../lib/generative-stream";

class TranscriptRenderer extends Renderer {
  onIntent?: (intent: LiveIntent) => boolean;
  streaming = false;
  override code(code: string, language = ""): ReactNode {
    return <GenerativeBlock key={this.getKey()} code={code} streaming={this.streaming} language={language.trim().toLowerCase().split(/\s/)[0] ?? ""} onIntent={this.onIntent} />;
  }
  override link(children: string | ReactNode[], href: string, style?: TextStyle): ReactNode {
    if (isImageRef(href)) return <InlineImage key={this.getKey()} href={href} label="Image" />;
    return <Text key={this.getKey()} selectable accessibilityRole="link" style={style} onPress={() => {
      if (/^https?:\/\//i.test(href)) void Linking.openURL(href);
    }}>{children}</Text>;
  }
  override image(uri: string, alt?: string): ReactNode {
    return /^https?:\/\//i.test(uri) || isImageRef(uri) ? <InlineImage key={this.getKey()} href={uri} label={alt || "Image"} /> : null;
  }
  override linkImage(_href: string, imageUri: string, alt?: string): ReactNode { return this.image(imageUri, alt); }
}
export const Markdown = memo(function Markdown({ text, onIntent, streaming = false }: { text: string; onIntent?: (intent: LiveIntent) => boolean; streaming?: boolean }) {
  // Unfinished UI fences are buffered before Markdown can expose model source.
  const prepared = useMemo(() => prepareGenerativeMarkdown(text), [text]);
  // Reset renderer keys per parse so unchanged code blocks retain their identity.
  const renderer = useMemo(() => { const renderer = new TranscriptRenderer({ selectable: true }); renderer.onIntent = onIntent; renderer.streaming = streaming; return renderer; }, [prepared, onIntent, streaming]);
  const nodes = useMarkdown(prepared, { renderer, styles, colorScheme: "dark" });
  // Hook only, not the library's nested FlatList. FlashList owns vertical scroll.
  return <View>{nodes}</View>;
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
