import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AnnotationRoot mounts native Skia/gesture modules; keep this Bun regression at
// the source-contract level instead of mocking Reanimated or a phone renderer.
const src = readFileSync(join(import.meta.dir, "AnnotationRoot.tsx"), "utf8");

function section(start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing annotation retry wiring: ${start}`);
  return src.slice(from, to);
}

describe("annotation ink auto-retry", () => {
  test("first failure delays one retry by 2 s without showing the error banner", () => {
    const failure = section("const inkFailed = useCallback", "  useEffect(() => {\n    if (active || penMode)");
    const first = section("if (!inkRetryUsed.current) {", "} else {");
    const terminal = failure.slice(failure.indexOf("} else {"));
    expect(first).toContain("inkRetryUsed.current = true;");
    expect(first).toContain("setInkRetryPending(true);");
    expect(first).toContain("inkRetryTimer.current = setTimeout(() => {");
    expect(first).toContain("setInkRetryPending(false);");
    expect(first).toContain("}, 2000);");
    expect(first).not.toContain("setInkError(");
    expect(terminal).toContain('setInkError("Ink couldn\'t load. Annotation is paused; your drawing is kept.");');
    expect(terminal).not.toContain("setTimeout(");
  });

  test("pending retry blocks early reload, and stale loads cannot overwrite exit", () => {
    const loader = section("if ((!active && !penMode) || ink || inkError || inkRetryPending) return;", "  const retryInk = useCallback");
    expect(loader).toContain("let cancelled = false;");
    expect(loader).toContain("if (!cancelled) setInk(module);");
    expect(loader).toContain("if (!cancelled) inkFailed(error);");
    expect(loader).toContain("return () => { cancelled = true; };");
    expect(src).toContain(".enabled(active && !!ink && !inkError)");
  });

  test("leaving annotation or unmounting cancels the timer", () => {
    const effects = section("const inkFailed = useCallback", "  const retryInk = useCallback");
    expect(effects).toContain("if (active || penMode) return;");
    expect(effects).toContain("clearTimeout(inkRetryTimer.current);");
    expect(effects).toContain("inkRetryTimer.current = null;");
    expect(effects).toContain("inkRetryUsed.current = false;");
    expect(effects).toContain("useEffect(() => () => {");
  });

  test("manual Retry ink starts a fresh cycle; error keeps Retry ink and Exit", () => {
    const retry = section("const retryInk = useCallback", "  const finish = useCallback");
    expect(retry).toContain("inkRetryUsed.current = false;");
    expect(retry).toContain("setInkRetryPending(false);");
    expect(retry).toContain("setInkError(undefined);");
    expect(src).toContain('<Chip label="Retry ink" a11y="Retry ink renderer" onPress={retryInk} />');
    expect(src).toContain('<Chip label="Exit" a11y="Exit annotation" onPress={exitAnnotation} />');
    expect(src).toContain("const strokes = annotate.use(s => s.drawing.strokes);");
  });
});
