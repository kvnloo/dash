import { memo, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import { colors, fonts, type } from "../theme";
import { PressScale } from "./PressScale";

const grammars = new Map(["javascript", "typescript", "bash", "json", "python", "css", "markup"].map(name => [name, Prism.languages[name]]));

function tokenText(token: string | Prism.Token, key: string): React.ReactNode {
  if (typeof token === "string") return token;
  const content = typeof token.content === "string" ? token.content : Array.isArray(token.content)
    ? token.content.map((t, i) => tokenText(t, `${key}-${i}`)) : tokenText(token.content, `${key}-nested`);
  const color = token.type.startsWith("deleted") ? colors.danger : token.type.startsWith("inserted") ? colors.ok
    : ["keyword", "boolean", "number"].includes(token.type) ? colors.gold
    : ["string", "function"].includes(token.type) ? colors.text : colors.textMuted;
  return <Text key={key} style={{ color }}>{content}</Text>;
}
export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copyState, setCopyState] = useState({ code: "", label: "Copy" });
  const lang = ({ ts: "typescript", js: "javascript", sh: "bash", py: "python" })[language] ?? language;
  const tokens = useMemo(() => {
    if (lang === "diff") return code.split("\n").map((line, index, lines) => <Text key={index} style={{ color: line.startsWith("+") ? colors.ok : line.startsWith("-") ? colors.danger : colors.textMuted }}>{line}{index < lines.length - 1 ? "\n" : ""}</Text>);
    const grammar = code.length <= 50_000 ? grammars.get(lang) : undefined;
    return grammar ? Prism.tokenize(code, grammar).map((t, i) => tokenText(t, String(i))) : code;
  }, [code, lang]);
  return <View style={styles.block}>
    <View style={styles.header}><Text style={styles.language}>{language || "code"}</Text>
      <PressScale accessibilityRole="button" accessibilityLabel={`Copy ${language || "code"} code`} style={styles.copy}
        onPress={() => { void Clipboard.setStringAsync(code).then(() => setCopyState({ code, label: "Copied" }), () => setCopyState({ code, label: "Try again" })); }}>
        <Text accessibilityLiveRegion="polite" style={styles.copyText}>{copyState.code === code ? copyState.label : "Copy"}</Text>
      </PressScale>
    </View>
    <ScrollView horizontal><Text selectable style={styles.code}>{tokens}</Text></ScrollView>
  </View>;
});
const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hair, borderRadius: 10, marginVertical: 6, overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 12, borderBottomWidth: 1, borderColor: colors.hair },
  language: { ...type.mono, color: colors.textMuted },
  copy: { minHeight: 44, minWidth: 60, alignItems: "center", justifyContent: "center" },
  copyText: { ...type.small, color: colors.text },
  code: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 20, color: colors.text, padding: 12 },
});
