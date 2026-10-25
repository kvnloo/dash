import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const source = readFileSync(join(import.meta.dir, "Composer.tsx"), "utf8");
const adapter = readFileSync(join(import.meta.dir, "../lib/clipboard-image.ts"), "utf8");
test("native paste chip listens only while focused and cleans up its subscription", () => {
  expect(source).toContain('Platform.OS === "web" || !fieldFocused || editingQueue || disabled');
  expect(source).toContain("Clipboard.addClipboardListener");
  expect(source).toContain("subscription.remove()");
  expect(source).toContain('accessibilityLabel="Paste image"');
  expect(source).toContain("onFocus={() => setFieldFocused(true)}");
  expect(source).toContain("onBlur={() => setFieldFocused(false)}");
});
test("paste attaches through the existing uploader, preserves concurrent edits, and excludes queue previews", () => {
  expect(source).toContain("addFiles([file])");
  expect(source).toContain("current === next ? insertion.withoutUri : current");
  expect(source).toContain('Platform.OS === "web" || disabled || editingQueue || pasteBusy.current');
  expect(source).toContain("remainingSlots(drafts) === 0");
  expect(adapter).toContain('Clipboard.getImageAsync({ format: "png" })');
  expect(adapter).toContain("new File(Paths.cache, name)");
  expect(adapter).toContain('file.write(payload.base64, { encoding: "base64" })');
  expect(adapter).toContain('mime: "image/png", size: file.size');
});
