import { memo } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import NativeMarkdown, { type RenderRules } from "react-native-markdown-display";
import { colors, fonts, type } from "../theme";
import { CodeBlock } from "./CodeBlock";

const rules: RenderRules = {
  fence: node => <CodeBlock key={node.key} code={node.content.replace(/\n$/, "")} language={"sourceInfo" in node && typeof node.sourceInfo === "string" ? node.sourceInfo.trim().split(/\s/)[0] ?? "" : ""} />,
  code_block: node => <CodeBlock key={node.key} code={node.content.replace(/\n$/, "")} language="" />,
  table: (node, children) => <ScrollView key={node.key} horizontal><View style={styles.table}>{children}</View></ScrollView>,
  // Remote images must not leak a private conversation's viewing time to a host.
  image: () => null,
};
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <NativeMarkdown style={styles} rules={rules} onLinkPress={url => {
    if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
    return false;
  }}>{text}</NativeMarkdown>;
});
const styles = StyleSheet.create({
  body: { color: colors.text, ...type.body },
  paragraph: { marginTop: 3, marginBottom: 7 },
  heading1: { ...type.heading, fontSize: 21, lineHeight: 27, marginTop: 8, marginBottom: 6 },
  heading2: { ...type.heading, fontSize: 18, lineHeight: 24, marginTop: 8, marginBottom: 6 },
  heading3: { ...type.heading, marginTop: 6, marginBottom: 4 },
  strong: { fontFamily: fonts.semibold },
  code_inline: { fontFamily: fonts.mono, fontSize: 13, color: colors.gold, backgroundColor: colors.surfaceRaised },
  link: { color: colors.gold, textDecorationLine: "underline" },
  blockquote: { backgroundColor: colors.surface, borderColor: colors.textTertiary, borderLeftWidth: 2, paddingHorizontal: 10 },
  bullet_list: { marginVertical: 2 },
  ordered_list: { marginVertical: 2 },
  table: { borderWidth: 1, borderColor: colors.hair, marginVertical: 6 },
  th: { padding: 8, borderColor: colors.hair },
  td: { padding: 8, borderColor: colors.hair },
  hr: { backgroundColor: colors.hair, height: 1, marginVertical: 8 },
});
