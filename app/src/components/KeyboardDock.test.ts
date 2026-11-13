import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
});
