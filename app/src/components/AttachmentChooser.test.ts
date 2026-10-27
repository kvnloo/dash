import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const composer = readFileSync(join(import.meta.dir, "Composer.tsx"), "utf8");
const chooser = readFileSync(join(import.meta.dir, "AttachmentChooser.tsx"), "utf8");

describe("app-owned attachment chooser", () => {
  test("renders themed rows instead of the Android Attach Alert or web's direct picker bypass", () => {
    expect(composer).toContain("<AttachmentChooser anchor={attachAnchor}");
    expect(composer).not.toMatch(/Alert\.alert\(["']Attach["']/);
    const pick = composer.slice(composer.indexOf("const pick ="), composer.indexOf("const onAttach ="));
    expect(pick).not.toContain('Platform.OS === "web"');
    expect(chooser).toContain('<GlassSurface testID="attachment-sheet" variant="raised"');
    for (const label of ["Photos", "Files", "Cancel attachment"]) expect(chooser).toContain(`accessibilityLabel="${label}"`);
    expect(chooser).toContain("minHeight: 44");
    expect(chooser).toContain('animationType="none"');
    expect(chooser).toContain("onRequestClose={onClose}");
    expect(chooser).toContain('Platform.OS === "ios"');
    expect(chooser).toContain("onDismiss={() => { if (pendingPick) onPick(pendingPick); }}");
  });

  test("measures the paperclip after keyboard dismissal without replacing the draft or selection", () => {
    const opening = composer.slice(composer.indexOf("const onAttach ="), composer.indexOf("const uploadShared ="));
    expect(opening.indexOf("await dismissKeyboard()")).toBeLessThan(opening.indexOf("measureInWindow"));
    expect(opening).not.toContain("setText(");
    expect(opening).not.toContain("setCursor(");
    expect(opening).not.toContain("setDrafts(");
    expect(chooser).toContain('thumb.side === "left" ? anchor.x : anchor.x + anchor.width - width');
  });

  test("retains OS file pickers, upload consent and Dash-native dictation error/retry UI", () => {
    expect(composer).toContain('kind === "photos" ? await pickPhotos(room) : await pickFiles(room)');
    expect(composer).toContain("remainingSlots(drafts)");
    expect(composer).toContain("rejectReason(file)");
    expect(composer).toContain("uploadPickedFile(settings, file)");
    expect(composer).toContain('Alert.alert("Upload shared files?"');
    expect(composer).toContain('Alert.alert("Attachments"');
    expect(composer).toContain('useRecordedSpeech("dictation"');
    expect(composer).toContain('accessibilityLabel="Retry dictation"');
    expect(composer).toContain('speech.state.phase === "error" ? "alert" : "text"');
    expect(composer).not.toContain('Alert.alert("Dictation"');
  });
});