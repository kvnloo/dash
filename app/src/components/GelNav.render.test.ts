import { expect, test } from "bun:test";

// A separate Bun process keeps the native-module mocks out of other suites.
// The actual AppNav JSX is rendered by React DOM's server renderer.
test("S Pen mode pill renders full labels at 0.65 font scale and toggles without losing ink", async () => {
  const script = `
    import { mock } from "bun:test";
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";

    const presses = new Map();
    mock.module("react-native", () => ({
      Platform: { OS: "web" },
      PixelRatio: { getFontScale: () => 0.65 },
      StyleSheet: { create: styles => styles },
      View: ({ children, accessibilityLabel }) =>
        React.createElement("div", { "aria-label": accessibilityLabel }, children),
      Pressable: ({ children, accessibilityRole, accessibilityLabel }) =>
        React.createElement("button", { role: accessibilityRole, "aria-label": accessibilityLabel }, children),
      Text: ({ children, testID, allowFontScaling, numberOfLines, style }) =>
        React.createElement("span", {
          "data-testid": testID,
          "data-unscaled": allowFontScaling === false,
          "data-font-size": style?.fontSize,
          "data-lines": numberOfLines,
        }, children),
    }));
    mock.module("@expo/vector-icons", () => ({ Feather: () => null }));
    mock.module("../lib/useHandedness", () => ({ useHandedness: () => ({ row: {} }) }));
    mock.module("../haptics", () => ({ haptic: { tap: () => {} } }));
    mock.module("../motion", () => ({ PRESS_SCALE: { nav: 0.9 } }));
    mock.module("../lib/main-nav", () => ({ toMain: () => {} }));
    mock.module("./BridgePull", () => ({
      useBridgePullOptional: () => null, useBridgePullPan: () => null,
    }));
    mock.module("./PressScale", () => ({
      PressScale: ({ children, testID, accessibilityLabel, accessibilityState, style, onPress }) => {
        if (testID) presses.set(testID, onPress);
        return React.createElement("button", {
          "data-testid": testID,
          "aria-label": accessibilityLabel,
          "aria-pressed": accessibilityState?.selected,
          "data-height": style?.height,
          "data-width": style?.width,
        }, children);
      },
    }));
    mock.module("react-native-gesture-handler", () => ({ GestureDetector: ({ children }) => children }));
    mock.module("react-native-reanimated", () => ({
      default: { View: ({ children }) => React.createElement("div", null, children) },
      useAnimatedStyle: style => style(),
      useSharedValue: value => ({ value }),
    }));

    const { AppNav } = await import("./GelNav.tsx");
    const { annotate } = await import("../store/annotate.ts");
    annotate.set(state => ({
      ...state, active: false, segments: [{ id: "kept", text: "draft", start: 1, end: 2, source: "mic" }],
    }));
    const render = () => renderToStaticMarkup(React.createElement(AppNav, {
      navigation: { navigate: () => {} }, tab: 1,
    }));
    const inspect = markup => {
      const label = markup.match(/<span[^>]*data-testid="spen-mode-label"[^>]*>([^<]*)<\\/span>/);
      const button = markup.match(/<button[^>]*data-testid="spen-mode-pill"[^>]*>/);
      return {
        text: label?.[1] ?? null,
        unscaled: label?.[0].includes('data-unscaled="true"') ?? false,
        font13: label?.[0].includes('data-font-size="13"') ?? false,
        singleLine: label?.[0].includes('data-lines="1"') ?? false,
        target44: button?.[0].includes('data-height="44"') ?? false,
        width88: button?.[0].includes('data-width="88"') ?? false,
        accessible: button?.[0].includes('aria-label="S Pen mode: ' + label?.[1]) ?? false,
        tabs: (markup.match(/role="tab"/g) ?? []).length,
      };
    };

    const normal = inspect(render());
    presses.get("spen-mode-pill")?.();
    const active = inspect(render());
    presses.get("spen-mode-pill")?.();
    const restored = inspect(render());
    console.log(JSON.stringify({
      normal, active, restored,
      returnedToNormal: !annotate.get().active,
      keptDraft: annotate.get().segments[0]?.text === "draft",
      penOnlyWhenOpened: annotate.get().penMode,
    }));
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  const pill = { unscaled: true, font13: true, singleLine: true, target44: true, width88: true, accessible: true, tabs: 3 };
  expect(JSON.parse(stdout)).toEqual({
    normal: { text: "Normal", ...pill },
    active: { text: "Annotate", ...pill },
    restored: { text: "Normal", ...pill },
    returnedToNormal: true,
    keptDraft: true,
    penOnlyWhenOpened: true,
  });
});
