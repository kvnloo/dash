import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keyboardInset } from "../lib/keyboard-inset";

describe("KeyboardDock", () => {
  test("sticks the dock to KeyboardController instead of a static bottom inset", () => {
    const src = readFileSync(join(import.meta.dir, "KeyboardDock.tsx"), "utf8");
    expect(src).toContain("useReanimatedKeyboardAnimation");
    expect(src).toContain("react-native-keyboard-controller");
    expect(src).toContain("translateY: height.value");
    expect(src).not.toContain("KeyboardAvoidingView");
  });

  test("Main and Chat both mount KeyboardDock so the IME does not cover the input", () => {
    const main = readFileSync(join(import.meta.dir, "../screens/MainScreen.tsx"), "utf8");
    const chat = readFileSync(join(import.meta.dir, "../screens/ChatScreen.tsx"), "utf8");
    expect(main).toContain("KeyboardDock");
    expect(chat).toContain("KeyboardDock");
    expect(main).not.toMatch(/paddingBottom:\s*Math\.max\(insets\.bottom/);
    expect(chat).not.toContain("keyboardVerticalOffset={insets.bottom}");
  });

  test("KeyboardProvider is edge-to-edge so Android IME insets actually animate", () => {
    const app = readFileSync(join(import.meta.dir, "../../App.tsx"), "utf8");
    expect(app).toContain("KeyboardProvider");
    expect(app).toContain("statusBarTranslucent");
    expect(app).toContain("navigationBarTranslucent");
    expect(app).toContain("preserveEdgeToEdge");
  });

  test("Composer is almost full-width and heavier than the 4px nav dots, not a second KeyboardAvoidingView", () => {
    const composer = readFileSync(join(import.meta.dir, "Composer.tsx"), "utf8");
    const dock = readFileSync(join(import.meta.dir, "KeyboardDock.tsx"), "utf8");
    expect(composer).toContain("paddingHorizontal: 12");
    expect(composer).toContain("minHeight: 60");
    expect(composer).not.toContain("KeyboardAvoidingView");
    expect(dock).toContain('stick: { width: "100%" }');
    expect(dock).toContain("translateY: height.value");
  });

  test("an open keyboard pads the chat content by its height; a closed one adds nothing", () => {
    expect(keyboardInset(-912)).toBe(912);
    expect(keyboardInset(0)).toBe(0);
    expect(keyboardInset(4)).toBe(0);
  });

  test("Chat content shrinks above the open IME so the sent message and reply stay visible", () => {
    const chat = readFileSync(join(import.meta.dir, "../screens/ChatScreen.tsx"), "utf8");
    expect(chat).toContain("<KeyboardInsetView style={styles.body} onOpen={scrollToNewest}>");
    expect(chat).toContain("<KeyboardInsetView style={styles.body}><LiveSurface");
    expect(chat).not.toMatch(/<View style=\{styles\.body\}>/);
  });

  test("the rail and blur target share the inner transcript viewport, not the padded keyboard box", () => {
    const chat = readFileSync(join(import.meta.dir, "../screens/ChatScreen.tsx"), "utf8");
    expect(chat).toMatch(/<View style=\{styles\.viewport\} testID="transcript-viewport">\s*<BlurTargetView ref=\{blurTarget\}/);
    expect(chat).toMatch(/<\/BlurTargetView>\s*<PromptRail[\s\S]*?<\/View>\s*<\/KeyboardInsetView>/);
    expect(chat).toContain("viewport: { flex: 1, minHeight: 0 }");
    expect(chat).toContain("blurTarget={liveOn ? undefined : blurTarget}");
  });
});
