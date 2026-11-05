import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { generationState } from "../../lib/generation-state";
import { flowMode } from "../../lib/flow-trace";
import { parseOpenUI } from "../../lib/openui-catalog";
import { OpenUINative } from "./OpenUINative";
import type { LiveIntent } from "../../../../shared/live";
import { parseGenUI } from "../../lib/genui";
import { parseMermaid } from "../../lib/mermaid";
import { colors, type } from "../../theme";
import { CodeBlock } from "../CodeBlock";
import DiagramDOM from "./DiagramDOM";
import { GenUI } from "./GenUI";
import { InlineHTML } from "./InlineHTML";
const palette = { bg: colors.bg, text: colors.text, gold: colors.gold, muted: colors.textFaint };
export function GenerativeBlock({ code, language, onIntent, streaming = false }: { code: string; language: string; onIntent?: (intent: LiveIntent) => boolean; streaming?: boolean }) {
  const diagram = useMemo(() => language === "mermaid" ? parseMermaid(code) : null, [language, code]);
  const widgets = useMemo(() => language === "genui" || language === "openui" ? parseGenUI(code) : null, [language, code]);
  const catalog = useMemo(() => language === "openui-lang" ? parseOpenUI(code, !streaming) : null, [code, language, streaming]);
  const reduced = useReducedMotion();
  const state = useMemo(() => {
    if (flowMode && language === "html") return streaming ? "loading" : code.length <= 200000 && code !== '{"__dash_pending_generated_ui__":true}' ? "ready" : "invalid";
    return catalog ? catalog.state : generationState(language, streaming, widgets !== null);
  }, [code, language, streaming, widgets, catalog]);
  if (state === "loading" || state === "invalid") return <View style={loading.shell} accessibilityRole={state === "loading" ? "progressbar" : "alert"} accessibilityLabel={state === "loading" ? "Building interface" : "Interface could not be rendered"}>
    <View style={loading.row}>{state === "loading" && !reduced ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}<Text style={loading.label}>{state === "loading" ? "Building interface…" : "Interface could not be rendered. Ask me to regenerate it."}</Text></View>
    {state === "loading" ? [90, 65, 80].map((width, i) => <View key={i} style={[loading.line, { width: `${width}%` }]} />) : null}
  </View>;
  if (catalog?.state === "ready") return <OpenUINative tree={catalog.tree} />;
  if (diagram) return <DiagramDOM key={code} diagram={diagram} palette={palette} dom={{ style: { height: 350 }, scrollEnabled: false, useExpoDOMWebView: false }} />;
  if (widgets) return <GenUI key={code} widgets={widgets} onIntent={onIntent} />;
  if (language === "html" && code.length <= 200000) return <InlineHTML source={code} />;
  return <CodeBlock code={code} language={language} />;
}

const loading = StyleSheet.create({ shell: { paddingVertical: 14, gap: 12 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, label: { ...type.small, color: colors.textMuted, flexShrink: 1 }, line: { height: 5, borderRadius: 3, backgroundColor: colors.hair } });
