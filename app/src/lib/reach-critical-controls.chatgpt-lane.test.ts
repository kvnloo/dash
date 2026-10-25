import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLOSE_HIT } from "./chat-window";
import { parseHandedness, resolveHandedness, thumbLayout, type ThumbSide } from "./handedness";
import { primaryFirstReachRow } from "./reach-critical-controls";

function source(path: string): string {
  return readFileSync(join(import.meta.dir, path), "utf8");
}

const composer = source("../components/Composer.tsx");
const windowDock = source("../components/ChatWindow.tsx");
const promptRail = source("../components/PromptRail.tsx");
const chatScreen = source("../screens/ChatScreen.tsx");
const settings = source("../screens/SettingsScreen.tsx");

describe("H-065: reach-critical handedness", () => {
  test("first-child Send / Stop is on the RIGHT for right-handed users and on the LEFT for left-handed users", () => {
    expect(primaryFirstReachRow("right")).toEqual({
      flexDirection: "row-reverse",
      justifyContent: "flex-start",
    });
    expect(primaryFirstReachRow("left")).toEqual({
      flexDirection: "row",
      justifyContent: "flex-start",
    });
    // Only placement changes. No RTL, transforms, text styles, or event remapping.
    expect(Object.keys(primaryFirstReachRow("left")).sort()).toEqual(["flexDirection", "justifyContent"]);
    expect(Object.keys(primaryFirstReachRow("right")).sort()).toEqual(["flexDirection", "justifyContent"]);
  });

  test("saved Right / Left / Auto resolve to correct first-child reach side, including invalid/legacy settings", () => {
    const values = [
      ["right", "row-reverse"],
      ["left", "row"],
      ["auto", "row-reverse"],
      ["LEFT", "row-reverse"],
      [undefined, "row-reverse"],
      [null, "row-reverse"],
    ] satisfies Array<[unknown, "row" | "row-reverse"]>;
    for (const [raw, direction] of values) {
      const side = resolveHandedness(parseHandedness(raw));
      expect(primaryFirstReachRow(side).flexDirection).toBe(direction);
    }
    // An eventual supported system signal can override Auto only.
    expect(primaryFirstReachRow(resolveHandedness("auto", "left")).flexDirection).toBe("row");
    expect(primaryFirstReachRow(resolveHandedness("right", "left")).flexDirection).toBe("row-reverse");
  });

  test("primary-first geometry stays opposite to the last-child close-X row on both sides", () => {
    for (const side of ["right", "left"] satisfies ThumbSide[]) {
      const primary = primaryFirstReachRow(side);
      const close = thumbLayout(side).row;
      expect(primary.flexDirection).not.toBe(close.flexDirection);
      expect(primary.justifyContent).toBe("flex-start");
    }
    expect(thumbLayout("right").edge(0)).toEqual({ right: 0, left: undefined });
    expect(thumbLayout("left").edge(0)).toEqual({ left: 0, right: undefined });
    expect(thumbLayout("right").railPadding(44)).toEqual({ paddingRight: 44, paddingLeft: 0 });
    expect(thumbLayout("left").railPadding(44)).toEqual({ paddingLeft: 44, paddingRight: 0 });
  });

  test("the real Composer has the primary action FIRST for every state, with an accessible 44-DIP hit", () => {
    expect(composer).toContain('testID="composer-controls"');
    const primary = composer.indexOf("{editingQueue ? <PressScale");
    const attach = composer.indexOf("<View ref={attachRef}", primary);
    const microphone = composer.indexOf("<MicButton side={thumb.side}", attach);
    expect(primary).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(primary);
    expect(microphone).toBeGreaterThan(attach);
    expect(composer).toContain('accessibilityLabel="Stop" onPress={onStop}');
    expect(composer).toContain('accessibilityLabel={streaming && !steerBusy ? "Queue" : sendMode.action}');
    expect(composer).toContain('accessibilityLabel="Save queued merge"');
    expect(composer).toContain("onPress={submit}");
    expect(composer).toContain("hit: { width: 44, height: 44,");
    expect(composer).toContain("editingQueue && thumb.align");
  });

  test("the existing chat-window X is LAST and mirrors through the reactive thumb row", () => {
    expect(windowDock).toContain('testID="chat-window-badge-row" style={[styles.badgeRow, thumb.row]}');
    const badge = windowDock.indexOf('testID="chat-window-badge"');
    const close = windowDock.indexOf('testID="chat-window-close"');
    expect(badge).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(badge);
    expect(windowDock).toContain('accessibilityLabel="Close chat window"');
    expect(windowDock).toContain("onPress={() => { haptic.tap(); onClose(); }}");
    expect(CLOSE_HIT).toBeGreaterThanOrEqual(44);
    expect(windowDock).toContain("close: { width: CLOSE_HIT, height: CLOSE_HIT");
  });

  test("the prompt rail, its preview/cursor and Latest share the mirrored edge and reserve content space", () => {
    expect(promptRail).toContain("style={[styles.rail, thumb.edge(0)]}");
    expect(promptRail).toContain("style={[styles.preview, thumb.edge(48)]}");
    expect(promptRail).toContain("style={[styles.cursor, thumb.edge(6), cursor]}");
    expect(promptRail).toContain('accessibilityLabel={live ? "Latest live reply" : "Latest reply"}');
    expect(promptRail).toContain("onPress={() => { clear(); onLatest(); }} style={styles.latest}");
    expect(promptRail).toContain("latest: { minHeight: 44, width: 44");
    expect(promptRail).toContain('rail: { position: "absolute", top: "18%", bottom: "12%", width: 44');
    expect(chatScreen).toContain("contentContainerStyle={[styles.listContent, thumb.railPadding(44)]}");
  });

  test("the existing Settings selector remains saved, accessible and reactive rather than flipping text", () => {
    expect(settings).toContain('setHandedness(value); haptic.select();');
    expect(settings).toContain("settingsThumbA11y(value, thumb.preference, settings !== null)");
    expect(settings).toContain('disabled={!settings}');
    expect(settings).toContain('minHeight: 48');
    expect(settings).toContain('(["right", "left", "auto"] satisfies Handedness[])');
    expect(settings).not.toContain("I18nManager.forceRTL");
  });
});
