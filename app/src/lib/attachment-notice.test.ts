import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attachmentNoticeView,
  createAttachmentNoticeController,
  pickerErrorDetail,
  type AttachmentNoticeRequest,
} from "./attachment-notice";

const component = readFileSync(join(import.meta.dir, "../components/AttachmentNotice.tsx"), "utf8");
const chooser = readFileSync(join(import.meta.dir, "../components/AttachmentChooser.tsx"), "utf8");
const picker = readFileSync(join(import.meta.dir, "attachment-picker.ts"), "utf8");

describe("H-117 Dash attachment notices", () => {
  test("pairing, capacity and picker failures are single-action notices, never consent", () => {
    const requests: AttachmentNoticeRequest[] = [
      { kind: "pair-required" },
      { kind: "limit-reached", limit: 5 },
      { kind: "picker-error", message: "Provider failed" },
      { kind: "shared-files-waiting", count: 2 },
    ];
    for (const request of requests) {
      const notice = attachmentNoticeView(request);
      expect(notice.title.length).toBeGreaterThan(0);
      expect(notice.detail.length).toBeGreaterThan(0);
      expect(notice.primary).toEqual({ label: "OK", action: "dismiss" });
      expect(notice.secondary).toBeNull();
    }
    expect(attachmentNoticeView({ kind: "pair-required" }).detail).toContain("Pair with a computer");
    expect(attachmentNoticeView({ kind: "limit-reached", limit: 5 }).detail).toContain("Up to 5 files per message");
    expect(attachmentNoticeView({ kind: "shared-files-waiting", count: 2 }).detail).toContain("2 shared files");
    expect(attachmentNoticeView({ kind: "shared-files-waiting", count: 1 }).detail).toContain("1 shared file.");
    expect(attachmentNoticeView({ kind: "limit-reached", limit: 1 }).detail).toContain("1 file per message");
    expect(attachmentNoticeView({ kind: "limit-reached", limit: 0 }).detail).toContain("cannot accept more");
    expect(attachmentNoticeView({ kind: "limit-reached", limit: Number.NaN }).secondary).toBeNull();
  });

  test("picker error copy stays readable even for empty, multiline or oversized failures", () => {
    expect(pickerErrorDetail("  \n  ")).toBe("Could not open the picker. Try again.");
    expect(pickerErrorDetail("  Failed   to\nread \tprovider  ")).toBe("Failed to read provider");
    const oversized = pickerErrorDetail("x".repeat(300));
    expect(oversized).toBe("x".repeat(240) + "…");
    expect(attachmentNoticeView({ kind: "picker-error", message: "" }).detail).toBe(
      "Could not open the picker. Try again.",
    );
  });

  test("shared-file consent names the target and never implies a chat send", () => {
    const single = attachmentNoticeView({ kind: "shared-upload", count: 1 });
    const multiple = attachmentNoticeView({ kind: "shared-upload", count: 3 });
    expect(single.detail).toContain("Upload this file to your paired computer over Tailscale");
    expect(multiple.detail).toContain("Upload these 3 files to your paired computer over Tailscale");
    expect(single.detail).toContain("does not send a message to an agent");
    expect(single.primary).toEqual({ label: "Upload files", action: "confirm-upload" });
    expect(single.secondary).toEqual({ label: "Cancel", action: "dismiss" });
    const empty = attachmentNoticeView({ kind: "shared-upload", count: 0 });
    expect(empty.primary.action).toBe("dismiss");
    expect(empty.secondary).toBeNull();
    expect(attachmentNoticeView({ kind: "shared-upload", count: -2 }).primary.action).toBe("dismiss");
  });

  test("confirm closes then uploads exactly once; duplicate presses cannot repeat", () => {
    const events: string[] = [];
    const act = createAttachmentNoticeController(
      { kind: "shared-upload", count: 2 },
      { onDismiss: () => events.push("closed"), onConfirmUpload: () => events.push("uploaded") },
    );
    expect(act("confirm-upload")).toBe(true);
    expect(act("confirm-upload")).toBe(false);
    expect(act("dismiss")).toBe(false);
    expect(events).toEqual(["closed", "uploaded"]);
  });

  test("Cancel, Back and backdrop share a dismiss-only gate", () => {
    for (const source of ["Cancel", "Android Back", "backdrop"]) {
      const events: string[] = [];
      const act = createAttachmentNoticeController(
        { kind: "shared-upload", count: 1 },
        { onDismiss: () => events.push("closed"), onConfirmUpload: () => events.push("uploaded") },
      );
      expect(act("dismiss")).toBe(true);
      expect(act("confirm-upload")).toBe(false);
      expect(act("dismiss")).toBe(false);
      expect(events).toEqual(["closed"]);
      expect(source.length).toBeGreaterThan(0);
    }
  });

  test("warnings and empty shared lists cannot confirm, even from a stale action", () => {
    for (const request of [
      { kind: "pair-required" },
      { kind: "limit-reached", limit: 3 },
      { kind: "picker-error", message: "Permission denied" },
      { kind: "shared-files-waiting", count: 7 },
      { kind: "shared-upload", count: 0 },
    ] satisfies AttachmentNoticeRequest[]) {
      const events: string[] = [];
      const act = createAttachmentNoticeController(request, {
        onDismiss: () => events.push("closed"),
        onConfirmUpload: () => events.push("uploaded"),
      });
      expect(act("confirm-upload")).toBe(false);
      expect(events).toEqual([]);
      expect(act("dismiss")).toBe(true);
      expect(events).toEqual(["closed"]);
    }
  });

  test("the notice is a branded accessibility-modal rather than a stock Android Alert", () => {
    expect(component).toContain("<Modal");
    expect(component).toContain('animationType={reducedMotion ? "none" : "fade"}');
    expect(component).toContain('onRequestClose={close}');
    expect(component).toContain('onAccessibilityEscape={close}');
    expect(component).toContain("accessibilityViewIsModal");
    expect(component).toContain('accessible={false}');
    expect(component).toContain('focusable={false}');
    expect(component).toContain('importantForAccessibility="no-hide-descendants"');
    expect(component).toContain("AccessibilityInfo.setAccessibilityFocus(node)");
    expect(component).toContain("<ScrollView");
    expect(component).toContain('variant="raised"');
    expect(component).toContain("colors.surfaceRaised");
    expect(component).toContain("glass.fillChipOn");
    expect(component).toContain("colors.gold");
    expect(component).toContain("maxHeight: Math.max(0, window.height");
    expect(component).toContain("minHeight: 48");
    expect(component).toContain("width: 44");
    expect(component).not.toContain("Alert.alert");
  });

  test("the existing themed chooser and OS-safe picker handoff remain independent", () => {
    expect(chooser).toContain('<GlassSurface testID="attachment-sheet" variant="raised"');
    expect(chooser).toContain("minHeight: 44");
    expect(picker).toContain("DocumentPicker.getDocumentAsync");
    expect(picker).toContain("ImagePicker.launchImageLibraryAsync");
    expect(component).not.toContain("expo-image-picker");
    expect(component).not.toContain("expo-document-picker");
  });
});
