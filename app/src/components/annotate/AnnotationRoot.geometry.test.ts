import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(import.meta.dir, "AnnotationRoot.tsx"), "utf8");
const match = source.match(/const COMPOSER_CLEARANCE = (\d+);/);
if (!match) throw new Error("AnnotationRoot must define a measured composer clearance");
const clearance = Number(match[1]);

// The chat field may grow to a 192dp queue preview + 44dp controls. The wrapper
// adds 8dp and KeyboardDock adds up to 24dp at rest; the remaining 12dp is air.
const TALLEST_INPUT = 192 + 44 + 8 + 24;
const EDGE = 4;
const TOP_GAP = 8;
const NAV_HEIGHT = 60;
const ACTION_HEADER_HEIGHT = 52;
const TRAY_TOP_CLEARANCE = NAV_HEIGHT + ACTION_HEADER_HEIGHT + TOP_GAP;
type Placement = "top" | "bottom";

function geometry(width: number, height: number, safeTop: number, keyboardLift: number, contentHeight: number, anchor: Placement, safeLeft = 0, safeRight = 0) {
  const reserve = clearance + Math.max(0, keyboardLift);
  const viewportTop = safeTop + TRAY_TOP_CLEARANCE;
  const viewportBottom = height - reserve;
  const viewportHeight = Math.max(0, viewportBottom - viewportTop);
  const visibleHeight = Math.min(contentHeight, viewportHeight);
  const trayTop = anchor === "top" ? viewportTop : Math.max(viewportTop, viewportBottom - visibleHeight);
  return {
    left: safeLeft + EDGE,
    right: width - safeRight - EDGE,
    viewportHeight,
    trayTop,
    trayBottom: trayTop + visibleHeight,
    frameBottom: viewportBottom,
    composerTop: height - Math.max(0, keyboardLift) - TALLEST_INPUT,
  };
}

describe("S Pen annotation tray / composer geometry", () => {
  test("sends the same keyboard-aware boundary to tray, frame and touch shield", () => {
    expect(clearance).toBeGreaterThanOrEqual(TALLEST_INPUT + 8);
    expect(source).toContain('return COMPOSER_CLEARANCE + Math.max(0, keyboardLift)');
    expect(source).toContain('bottom: composerAvoidance(-keyboardHeight.value)');
    expect(source).toContain('style={[styles.frame, frameStyle]}');
    expect(source).toContain('style={[StyleSheet.absoluteFill, frameStyle]}');
    expect(source).toContain('point.y >= size.height - composerAvoidance(-keyboardHeight.value)');
    expect(source).not.toContain('bottom: insets.bottom + space.sm');
  });

  test("390, 411 and 412dp: never intersects tallest input with keyboard closed or open", () => {
    for (const [width, height, safeTop, keyboardLifts] of [
      [390, 844, 24, [0, 320, 480]],
      [411, 915, 32, [0, 360, 500]],
      [412, 915, 32, [0, 360, 500]],
    ] satisfies Array<[number, number, number, number[]]>) {
      for (const keyboardLift of keyboardLifts) {
        for (const contentHeight of [132, 300, 500]) { // two rows, wrapped controls, long preview
          for (const anchor of ["top", "bottom"] satisfies Placement[]) {
            const rect = geometry(width, height, safeTop, keyboardLift, contentHeight, anchor);
            expect(rect.left).toBe(4);
            expect(rect.right).toBe(width - 4);
            expect(rect.trayTop).toBeGreaterThanOrEqual(safeTop + TRAY_TOP_CLEARANCE);
            expect(rect.trayBottom - rect.trayTop).toBeLessThanOrEqual(rect.viewportHeight);
            if (rect.viewportHeight > 0) {
              expect(rect.trayBottom).toBeLessThanOrEqual(rect.frameBottom);
              expect(rect.trayBottom).toBeLessThanOrEqual(rect.composerTop - 8);
            }
            expect(rect.frameBottom).toBeLessThanOrEqual(rect.composerTop - 8);
          }
        }
      }
    }
  });

  test("wrapped controls and preview scroll instead of overflowing the safe viewport", () => {
    const narrow = geometry(390, 844, 24, 320, 500, "top");
    expect(narrow.trayBottom - narrow.trayTop).toBe(844 - (320 + clearance) - (24 + TRAY_TOP_CLEARANCE));
    expect(source).toContain('overflow: "hidden"');
    expect(source).toContain('maxHeight: "100%"');
    expect(source).toContain('flexWrap: "wrap"');
    expect(source).toContain('keyboardShouldPersistTaps="always"');
    expect(source).toContain('chip: { minHeight: 44, minWidth: 44');
    expect(source).toContain('<Toast screenHeight={size.height} />');
  });

  test("411dp first row clears settings/perf controls and horizontal safe areas", () => {
    const rect = geometry(411, 915, 32, 0, 180, "top", 12, 8);
    expect(rect.trayTop).toBe(152); // 32 safe + 60 nav + 52 actions + 8 gap
    expect(rect.trayTop + 44).toBeLessThanOrEqual(rect.frameBottom);
    expect(rect.left).toBe(16);
    expect(rect.right).toBe(399);
    expect(readFileSync(join(import.meta.dir, "../golden-nav.ts"), "utf8")).toContain("export const NAV_CHROME_HEIGHT = 60;");
    expect(readFileSync(join(import.meta.dir, "../WorkspaceHeader.tsx"), "utf8")).toContain("export const WORKSPACE_HEADER_HEIGHT = 52;");
    expect(source).toContain('const TRAY_TOP_CLEARANCE = NAV_CHROME_HEIGHT + WORKSPACE_HEADER_HEIGHT + space.sm;');
    expect(source).toContain('const topInset = insets.top + TRAY_TOP_CLEARANCE;');
    expect(source).toContain('top: topInset, left: insets.left + space.xs, right: insets.right + space.xs');
    expect(source).toContain('height: Math.max(0, screenHeight - topInset - composerAvoidance(-keyboardHeight.value))');
    expect(source).toContain('const room = Math.max(0, screenHeight - topInset - composerAvoidance(-keyboardHeight.value))');
    expect(source).toContain('onPress={() => setColor(color)} style={styles.chip}'); // colour targets are 44dp too
  });

  test("oversized keyboard clips the tray instead of placing controls over the composer", () => {
    const rect = geometry(411, 915, 32, 500, 132, "bottom");
    expect(rect.viewportHeight).toBe(0);
    expect(rect.trayBottom - rect.trayTop).toBe(0);
    expect(rect.trayTop).toBe(152);
    expect(source).toContain('overflow: "hidden"');
  });

  test("moving the tray uses reduced-motion-aware 110ms ease-out, no spring", () => {
    expect(source).toContain('duration: 110, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System');
    expect(source).toContain('translateY: Math.max(0, room - trayHeight.value) * progress.value');
    expect(source).toContain('const [top, setTop] = useState(true)');
  });

  test("toggle mode and native side-button stay intact without intercepting composer taps", () => {
    expect(source).toContain('subscribeStylusButton(requireOptionalNativeModule<StylusButtonSource>("DashStylus"), stylusButton)');
    expect(source).toContain('.enabled(active && !inkError)');
    expect(source).not.toContain('stylusEnters(');
    const panStart = source.indexOf('.onTouchesDown((e, manager) => {');
    const inputGuard = source.indexOf('if (!point || point.y >= size.height - composerAvoidance(-keyboardHeight.value))', panStart);
    const penRoute = source.indexOf('if (!activeSv.value || routePointer(', panStart);
    expect(panStart).toBeGreaterThanOrEqual(0);
    expect(inputGuard).toBeGreaterThan(panStart);
    expect(penRoute).toBeGreaterThan(inputGuard);
    expect(source).toContain('e.y < size.height - composerAvoidance(-keyboardHeight.value)');
  });
});
