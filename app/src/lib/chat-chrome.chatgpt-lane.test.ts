import { describe, expect, test } from "bun:test";
import { pillGeometry, pillReserve, type WindowOrigin } from "./chat-window";
import {
  resolveChatChrome,
  type ChatChromeInput,
  type ChatChromeMode,
  type ChatEntry,
} from "./chat-chrome";

const entries: ChatEntry[] = ["row", "notification", "deep-link", "search", "new-chat", "restore"];
const origin: WindowOrigin = { y: 320, height: 64 };
const stackless: ChatEntry[] = ["notification", "deep-link", "restore"];

describe("resolveChatChrome: every entry × origin × setting × platform × live surface", () => {
  for (const entry of entries) {
    for (const hasOrigin of [false, true]) {
      for (const fullscreenSetting of [false, true]) {
        for (const web of [false, true]) {
          for (const liveSurface of [false, true]) {
            const context = [
              entry,
              hasOrigin ? "measured" : "unmeasured",
              fullscreenSetting ? "setting-on" : "setting-off",
              web ? "web" : "native",
              liveSurface ? "live" : "chat",
            ].join(" / ");

            test(context, () => {
              const chrome = resolveChatChrome({
                entry,
                windowOrigin: hasOrigin ? origin : undefined,
                fullscreenSetting,
                liveSurface,
                web,
              });

              const expectedMode: ChatChromeMode = web || !fullscreenSetting
                ? "header"
                : entry === "row" && hasOrigin
                  ? "window"
                  : "fullscreen";

              expect({
                mode: chrome.mode,
                morph: chrome.morph,
                closeAction: chrome.closeAction,
              }).toEqual({
                mode: expectedMode,
                morph: expectedMode === "window",
                closeAction: stackless.includes(entry) ? "to-main" : "pop",
              });
            });
          }
        }
      }
    }
  }
});

describe("native full-screen fallback and origin validation", () => {
  test("an omitted setting defaults to the pill for native direct entries", () => {
    for (const entry of entries) {
      const chrome = resolveChatChrome({
        entry,
        liveSurface: false,
        web: false,
      });
      expect(chrome.mode).toBe("fullscreen");
      expect(chrome.morph).toBe(false);
    }
  });

  test("an origin on a non-row route never triggers a morph", () => {
    for (const entry of entries.filter(item => item !== "row")) {
      const chrome = resolveChatChrome({
        entry,
        windowOrigin: origin,
        fullscreenSetting: true,
        liveSurface: true,
        web: false,
      });
      expect(chrome.mode).toBe("fullscreen");
      expect(chrome.morph).toBe(false);
    }
  });

  const invalidOrigins: WindowOrigin[] = [
    { y: 0, height: 0 },
    { y: 10, height: -1 },
    { y: Number.NaN, height: 44 },
    { y: Number.POSITIVE_INFINITY, height: 44 },
    { y: -Number.POSITIVE_INFINITY, height: 44 },
    { y: 30, height: Number.NaN },
    { y: 30, height: Number.POSITIVE_INFINITY },
  ];
  for (const [index, windowOrigin] of invalidOrigins.entries()) {
    test("rejects invalid measured row rectangle #" + index, () => {
      const chrome = resolveChatChrome({
        entry: "row", windowOrigin, fullscreenSetting: true, liveSurface: false, web: false,
      });
      expect(chrome.mode).toBe("fullscreen");
      expect(chrome.morph).toBe(false);
    });
  }

  test("a partially offscreen but measurable row can still morph", () => {
    const chrome = resolveChatChrome({
      entry: "row",
      windowOrigin: { y: -20, height: 60 },
      fullscreenSetting: true,
      liveSurface: false,
      web: false,
    });
    expect(chrome.mode).toBe("window");
    expect(chrome.morph).toBe(true);
  });
});

describe("closeAction", () => {
  for (const entry of entries) {
    test(entry + " preserves its stack policy across display modes", () => {
      for (const web of [false, true]) {
        for (const fullscreenSetting of [false, true]) {
          const chrome = resolveChatChrome({
            entry, windowOrigin: origin, fullscreenSetting, liveSurface: false, web,
          });
          expect(chrome.closeAction).toBe(stackless.includes(entry) ? "to-main" : "pop");
        }
      }
    });
  }
});

describe("topReserve", () => {
  const insetTop = 40;
  const safeArea = pillGeometry({ width: 412, insetTop, cutout: null });
  const cutout = pillGeometry({
    width: 412, insetTop,
    cutout: { x: 195, y: 9, width: 24, height: 28 },
  });

  const modes: { name: string; input: ChatChromeInput; expected: ChatChromeMode }[] = [
    {
      name: "window from measured native row",
      input: { entry: "row", windowOrigin: origin, fullscreenSetting: true, liveSurface: false, web: false },
      expected: "window",
    },
    {
      name: "fullscreen from native direct entry",
      input: { entry: "notification", fullscreenSetting: true, liveSurface: true, web: false },
      expected: "fullscreen",
    },
    {
      name: "header on web",
      input: { entry: "row", windowOrigin: origin, fullscreenSetting: true, liveSurface: true, web: true },
      expected: "header",
    },
    {
      name: "header when full-screen is disabled",
      input: { entry: "row", windowOrigin: origin, fullscreenSetting: false, liveSurface: false, web: false },
      expected: "header",
    },
  ];

  for (const scenario of modes) {
    test(scenario.name + " reserves exactly the correct top inset", () => {
      const chrome = resolveChatChrome(scenario.input);
      expect(chrome.mode).toBe(scenario.expected);
      for (const geometry of [safeArea, cutout]) {
        for (const top of [0, insetTop, 80]) {
          expect(chrome.topReserve(geometry, top)).toBe(
            scenario.expected === "header" ? top : pillReserve(geometry, top),
          );
        }
      }
    });
  }

  test("header never reserves the safe-area pill's extra height", () => {
    const header = resolveChatChrome({
      entry: "new-chat", fullscreenSetting: false, liveSurface: false, web: false,
    });
    expect(pillReserve(safeArea, insetTop)).toBeGreaterThan(insetTop);
    expect(header.topReserve(safeArea, insetTop)).toBe(insetTop);
  });
});
