import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string): string => readFileSync(join(import.meta.dir, path), "utf8");

describe("root-owned voice survives in-app navigation", () => {
  test("one ContinuousVoiceRoot wraps the stack instead of living inside a chat or pager page", () => {
    const app = source("../../App.tsx");
    const owner = app.indexOf("<ContinuousVoiceRoot>");
    const stack = app.indexOf("<Stack.Navigator");
    const stackEnd = app.indexOf("</Stack.Navigator>");
    const ownerEnd = app.indexOf("</ContinuousVoiceRoot>");
    expect(owner).toBeGreaterThan(-1);
    expect(stack).toBeGreaterThan(owner);
    expect(stackEnd).toBeGreaterThan(stack);
    expect(ownerEnd).toBeGreaterThan(stackEnd);
    expect(app.match(/<ContinuousVoiceRoot>/g)).toHaveLength(1);
  });

  test("closing a chat window unmounts its controls, not the call", () => {
    const chat = source("../screens/ChatScreen.tsx");
    expect(chat).toMatch(/if \(!windowed\) return;\s*voiceWindowOpen\.set\(true\);\s*return \(\) => voiceWindowOpen\.set\(false\);\s*\}, \[windowed\]\);/);
    const closeStart = chat.indexOf("const closeWindow = useCallback");
    const closeEnd = chat.indexOf("const layers = useRef", closeStart);
    expect(closeStart).toBeGreaterThan(-1);
    expect(closeEnd).toBeGreaterThan(closeStart);
    const close = chat.slice(closeStart, closeEnd);
    expect(close).toContain("morph.close(() => screenBack(navigation))");
    expect(close).not.toMatch(/(?:voice|call|controller)\??\.stop\(/);
    const root = source("ContinuousVoiceRoot.tsx");
    expect(root).toContain("const windowOpen = voiceWindowOpen.use(open => open);");
    expect(root).toContain("const home = voiceControlHome(active, windowOpen);");
  });

  test("pager selection does not tear down root effects; only app background or root unmount does", () => {
    const main = source("../screens/MainScreen.tsx");
    expect(main).toContain("onPageSelected={onPage}");
    expect(main).toContain("pagerRef.current?.setPage(next)");
    const root = source("ContinuousVoiceRoot.tsx");
    const lifetimeStart = root.indexOf('useEffect(() => {\n    const subscription = AppState.addEventListener');
    const lifetimeEnd = root.indexOf("  const shown =", lifetimeStart);
    expect(lifetimeStart).toBeGreaterThan(-1);
    expect(lifetimeEnd).toBeGreaterThan(lifetimeStart);
    const lifetime = root.slice(lifetimeStart, lifetimeEnd);
    expect(lifetime).toContain('if (next === "background")');
    expect(lifetime).toContain("subscription.remove()");
    expect(lifetime).toContain("void controller?.stop()");
    expect(lifetime).toMatch(/\}, \[\]\);/);
  });
});
