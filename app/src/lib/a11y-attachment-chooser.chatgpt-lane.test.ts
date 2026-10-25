import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Native Modal, focus and TalkBack cannot be exercised in Bun. These assertions
// pin the owned component's declarative accessibility contract for device review.
const source = readFileSync(join(import.meta.dir, "../components/AttachmentChooser.tsx"), "utf8");
const options = Array.from(source.matchAll(/<PressScale\b[\s\S]*?<\/PressScale>/g), (match) => match[0]);

function openingTag(name: string): string {
  const tag = source.match(new RegExp(`<${name}\\b[^\\n]*>`))?.[0];
  if (tag === undefined) throw new Error(`Missing ${name} opening tag`);
  return tag;
}

describe("AttachmentChooser screen-reader semantics", () => {
  test("announces a bounded modal pane and focuses its labelled heading on show", () => {
    const modal = openingTag("Modal");
    const pane = openingTag("GlassSurface");
    const heading = source.match(/<Text ref=\{titleRef\}[^>]*>/)?.[0];

    expect(modal).toContain("visible={pendingPick === null}");
    expect(modal).toContain("onShow={focusTitle}");
    expect(pane).toContain('testID="attachment-sheet"');
    expect(pane).toContain('accessibilityLabel="Attachment chooser"');
    // GlassSurface accepts ViewProps, which does not declare accessibilityPaneTitle.
    expect(pane).not.toContain("accessibilityPaneTitle=");
    expect(pane).toContain("accessibilityViewIsModal");
    expect(heading).toContain('accessibilityRole="header"');
    expect(heading).toContain('accessibilityLabel="Attachment chooser"');
    expect(source).toContain("findNodeHandle(titleRef.current)");
    expect(source).toContain("AccessibilityInfo.setAccessibilityFocus(node)");
    expect(source).toContain('Platform.OS === "web"');
    // A labelled ScrollView can become a redundant focus target before the actions.
    expect(openingTag("ScrollView")).not.toContain("accessibilityLabel");
  });

  test("outside taps and Android Back still dismiss, but the scrim is not a screen-reader target", () => {
    const scrim = source.match(/<Pressable style=\{StyleSheet\.absoluteFill\}[^>]*\/>/)?.[0];

    expect(scrim).toContain("accessible={false}");
    expect(scrim).toContain("accessibilityElementsHidden");
    expect(scrim).toContain('importantForAccessibility="no-hide-descendants"');
    expect(scrim).toContain("onPress={onClose}");
    expect(scrim).not.toContain("accessibilityRole=");
    expect(openingTag("Modal")).toContain("onRequestClose={onClose}");
    expect(options[2]).toContain("onPress={onClose}");
  });

  test("Photos, Files and Cancel expose explicit button labels, hints and matching touch actions", () => {
    expect(options).toHaveLength(3);
    expect(options.map((row) => row.match(/accessibilityLabel="([^"]+)"/)?.[1])).toEqual([
      "Photos", "Files", "Cancel attachment",
    ]);
    expect(options.map((row) => row.match(/accessibilityHint="([^"]+)"/)?.[1])).toEqual([
      "Choose photos to attach", "Choose files to attach", "Close without choosing an attachment",
    ]);
    for (const row of options) expect(row).toContain('accessibilityRole="button"');
    // PressScale is a Pressable: its accessibility activation invokes the same onPress as touch.
    expect(options[0]).toContain('onPress={() => choose("photos")}');
    expect(options[1]).toContain('onPress={() => choose("files")}');
    expect(options[2]).toContain("onPress={onClose}");
  });

  test("keeps the existing native picker sequence without inventing busy, disabled or selected state", () => {
    expect(source).toContain('if (Platform.OS === "ios") setPendingPick(kind);');
    expect(source).toContain("else onPick(kind);");
    expect(openingTag("Modal")).toContain("onDismiss={() => { if (pendingPick) onPick(pendingPick); }}");
    // This chooser has no loading, disabled or selection inputs: all three choices are actionable.
    for (const row of options) {
      expect(row).not.toContain("disabled=");
      expect(row).not.toContain("accessibilityState=");
    }
  });

  test("retains 44-DIP rows, text scaling, scrolling and no modal motion", () => {
    expect(source).toContain("row: { minHeight: 44");
    expect(options.every((row) => row.includes("style={[styles.row, thumb.row]}"))).toBe(true);
    expect(source).toContain("keyboardShouldPersistTaps=\"handled\"");
    expect(source).toContain("maxHeight: Math.max(44, anchor.y - insets.top - 16)");
    expect(source).toContain("flexShrink: 1");
    expect(source).not.toContain("allowFontScaling={false}");
    expect(openingTag("Modal")).toContain('animationType="none"');
  });
});
