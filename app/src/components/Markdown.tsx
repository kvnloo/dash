import { memo, useMemo, type ReactNode } from "react";
import { Linking, StyleSheet, Text, View, type TextStyle } from "react-native";
import { Renderer, useMarkdown, type MarkedStyles } from "react-native-marked";
import { colors, fonts, type } from "../theme";
import { CodeBlock } from "./CodeBlock";

class TranscriptRenderer extends Renderer {
  override code(code: string, language = ""): ReactNode {
    return <CodeBlock key={this.getKey()} code={code} language={language.trim().toLowerCase().split(/\s/)[0] ?? ""} />;
  }
  override link(children: string | ReactNode[], href: string, style?: TextStyle): ReactNode {
    return <Text key={this.getKey()} selectable accessibilityRole="link" style={style} onPress={() => {
      if (/^https?:\/\//i.test(href)) void Linking.openURL(href);
    }}>{children}</Text>;
  }
  // Never fetch a remote image just because an untrusted agent named its URL.
  override image(): ReactNode { return null; }
  override linkImage(): ReactNode { return null; }
}
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  // Reset renderer keys per parse so unchanged code blocks retain their identity.
  const renderer = useMemo(() => new TranscriptRenderer({ selectable: true }), [text]);
  const nodes = useMarkdown(text, { renderer, styles, colorScheme: "dark" });
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
