import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "AnnotationRoot.tsx"), "utf8");
const registration = source.indexOf('BackHandler.addEventListener("hardwareBackPress"');

function androidBackEffect(): string {
  if (registration === -1) throw new Error("AnnotationRoot must register Android hardware back");
  const start = source.lastIndexOf("  useEffect(() => {", registration);
  const end = source.indexOf("  }, [active]);", registration);
  if (start === -1 || end === -1) throw new Error("Android back must follow annotation activity");
  return source.slice(start, end);
}

describe("Android back in annotation mode", () => {
  test("registers only when active on Android and removes its subscription on exit/unmount", () => {
    expect(source).toContain('import { BackHandler,');
    const effect = androidBackEffect();
    expect(effect).toContain('if (Platform.OS !== "android" || !active) return;');
    expect(effect).toContain('BackHandler.addEventListener("hardwareBackPress",');
    expect(effect).toContain("return () => subscription.remove();");
  });

  test("consumes back to exit annotation; otherwise lets normal back navigation handle it", () => {
    const effect = androidBackEffect();
    const listener = effect.match(/BackHandler\.addEventListener\("hardwareBackPress", \(\) => \{([\s\S]*?)\n    \}\);/);
    expect(listener).not.toBeNull();
    const body = listener?.[1] ?? "";
    expect(body).toMatch(/if \(!annotate\.get\(\)\.active\) return false;\s*exitAnnotation\(\);\s*return true;/);
    expect(body.indexOf("return false")).toBeLessThan(body.indexOf("exitAnnotation()"));
  });
});
