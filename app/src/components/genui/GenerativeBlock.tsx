import { useMemo } from "react";
import type { LiveIntent } from "../../../../shared/live";
import { parseGenUI } from "../../lib/genui";
import { parseMermaid } from "../../lib/mermaid";
import { colors } from "../../theme";
import { CodeBlock } from "../CodeBlock";
import DiagramDOM from "./DiagramDOM";
import { GenUI } from "./GenUI";
import { InlineHTML } from "./InlineHTML";
const palette = { bg: colors.bg, text: colors.text, gold: colors.gold, muted: colors.textFaint };
export function GenerativeBlock({ code, language, onIntent }: { code: string; language: string; onIntent?: (intent: LiveIntent) => boolean }) {
  const diagram = useMemo(() => language === "mermaid" ? parseMermaid(code) : null, [language, code]);
  const widgets = useMemo(() => language === "genui" || language === "openui" ? parseGenUI(code) : null, [language, code]);
  if (diagram) return <DiagramDOM key={code} diagram={diagram} palette={palette} dom={{ style: { height: 350 }, scrollEnabled: false, useExpoDOMWebView: false }} />;
  if (widgets) return <GenUI key={code} widgets={widgets} onIntent={onIntent} />;
  if (language === "html" && code.length <= 200000) return <InlineHTML source={code} />;
  return <CodeBlock code={code} language={language} />;
}
