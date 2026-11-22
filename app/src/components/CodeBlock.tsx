import { memo, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-python";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-docker";
import { colors, fonts, type } from "../theme";
import { PressScale } from "./PressScale";

const grammars = new Map(["javascript", "typescript", "jsx", "tsx", "bash", "json", "python", "css", "markup",
  "yaml", "go", "rust", "sql", "swift", "kotlin", "toml", "markdown", "docker"].map(name => [name, Prism.languages[name]]));
const ALIASES: Record<string, string> = { ts: "typescript", js: "javascript", sh: "bash", shell: "bash", zsh: "bash", console: "bash", py: "python",
  yml: "yaml", golang: "go", rs: "rust", kt: "kotlin", md: "markdown", dockerfile: "docker", html: "markup", xml: "markup", svg: "markup" };

// #518: hierarchy inside DESIGN.md's palette (gold is the only accent; status colours only for diffs).
// Shade and weight carry the difference: keywords gold, names semibold ink, strings ink, comments dim
// italic, punctuation dim.
const GOLD = new Set(["keyword", "boolean", "number", "constant", "important", "atrule", "symbol"]);
const NAME = new Set(["function", "class-name", "tag", "builtin", "property", "selector", "key", "macro", "attr-name"]);
const INK = new Set(["string", "char", "attr-value", "regex", "url", "template-string"]);
const DIM = new Set(["comment", "prolog", "doctype", "cdata"]);
const QUIET = new Set(["punctuation", "operator"]);
function tokenStyle(kind: string): { color: string; fontStyle?: "italic"; fontWeight?: "600" } {
  if (kind.startsWith("deleted")) return { color: colors.danger };
  if (kind.startsWith("inserted")) return { color: colors.ok };
  if (GOLD.has(kind)) return { color: colors.gold };
  if (NAME.has(kind)) return { color: colors.text, fontWeight: "600" };
  if (INK.has(kind)) return { color: colors.text };
  if (DIM.has(kind)) return { color: colors.textTertiary, fontStyle: "italic" };
  if (QUIET.has(kind)) return { color: colors.textTertiary };
  return { color: colors.textMuted };
}

function tokenText(token: string | Prism.Token, key: string): React.ReactNode {
  if (typeof token === "string") return token;
  const content = typeof token.content === "string" ? token.content : Array.isArray(token.content)
    ? token.content.map((t, i) => tokenText(t, `${key}-${i}`)) : tokenText(token.content, `${key}-nested`);
  return <Text key={key} style={tokenStyle(token.type)}>{content}</Text>;
}
export const CodeBlock = memo(function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copyState, setCopyState] = useState({ code: "", label: "Copy" });
  const lang = ALIASES[language.toLowerCase()] ?? language.toLowerCase();
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
