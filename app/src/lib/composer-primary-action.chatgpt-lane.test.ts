import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composerMode } from "./composer-mode";
import {
  activateComposerPrimaryAction,
  selectComposerPrimaryAction,
  type ComposerPrimaryInput,
} from "./composer-primary-action";

const base: ComposerPrimaryInput = {
  editingQueue: false,
  streaming: false,
  steerBusy: false,
  canSend: false,
  sendMode: composerMode(false),
};

function choose(update: Partial<ComposerPrimaryInput> = {}) {
  return selectComposerPrimaryAction({ ...base, ...update });
}

const composer = readFileSync(join(import.meta.dir, "../components/Composer.tsx"), "utf8");
const component = readFileSync(join(import.meta.dir, "../components/ComposerPrimaryAction.tsx"), "utf8");
const pressScale = readFileSync(join(import.meta.dir, "../components/PressScale.tsx"), "utf8");

describe("H-141: one primary Send/Stop control", () => {
  test("idle empty draft is disabled Send, while a sendable draft enables the same target", () => {
    expect(choose()).toEqual({
      kind: "submit",
      label: "Send",
      hint: "",
      disabled: true,
      glyph: "arrow-up",
    });
    expect(choose({ canSend: true })).toEqual({
      kind: "submit",
      label: "Send",
      hint: "",
      disabled: false,
      glyph: "arrow-up",
    });
  });

  test("running with no sendable draft becomes enabled Stop even when Send is disabled", () => {
    for (const flags of [
      { streaming: true },
      { steerBusy: true },
      { streaming: true, steerBusy: true },
    ]) {
      expect(choose(flags)).toEqual({
        kind: "stop",
        label: "Stop",
        hint: "Stop the running turn",
        disabled: false,
      });
    }
  });

  test("running with a sendable draft retains explicit Steer or Queue instead of a second Stop", () => {
    expect(choose({ steerBusy: true, canSend: true, sendMode: composerMode(true, "steer") })).toEqual({
      kind: "submit",
      label: "Steer",
      hint: "Steer the running turn",
      disabled: false,
      glyph: "corner-up-right",
    });
    expect(choose({ steerBusy: true, canSend: true, sendMode: composerMode(true, "queue") })).toEqual({
      kind: "submit",
      label: "Queue",
      hint: "Queue for next turn",
      disabled: false,
      glyph: "arrow-up",
    });
    expect(choose({ streaming: true, canSend: true, sendMode: composerMode(false) })).toEqual({
      kind: "submit",
      label: "Queue",
      hint: "",
      disabled: false,
      glyph: "arrow-up",
    });
  });

  test("queue preview takes precedence over running Stop and retains its save eligibility", () => {
    for (const canSend of [false, true]) {
      expect(choose({ editingQueue: true, streaming: true, steerBusy: true, canSend })).toEqual({
        kind: "save-queue",
        label: "Save queued merge",
        hint: "Keep this merged message queued for the next turn",
        disabled: !canSend,
      });
    }
  });

  test("enabled press dispatches exactly one submit or Stop; disabled press dispatches neither", () => {
    const called: string[] = [];
    const submit = () => { called.push("submit"); };
    const stop = () => { called.push("stop"); };
    expect(activateComposerPrimaryAction(choose(), submit, stop)).toBe("disabled");
    expect(called).toEqual([]);
    expect(activateComposerPrimaryAction(choose({ canSend: true }), submit, stop)).toBe("submitted");
    expect(called).toEqual(["submit"]);
    expect(activateComposerPrimaryAction(choose({ streaming: true }), submit, stop)).toBe("stopped");
    expect(called).toEqual(["submit", "stop"]);
    expect(activateComposerPrimaryAction(choose({ editingQueue: true, canSend: false }), submit, stop)).toBe("disabled");
    expect(called).toEqual(["submit", "stop"]);
    expect(activateComposerPrimaryAction(choose({ editingQueue: true, canSend: true }), submit, stop)).toBe("submitted");
    expect(called).toEqual(["submit", "stop", "submit"]);
  });

  test("real production Composer keeps the one primary target immediately left below the message field", () => {
    const field = composer.indexOf('testID="composer-field"');
    const input = composer.indexOf("<TextInput", field);
    const controls = composer.indexOf('testID="composer-controls"', input);
    const attachment = composer.indexOf("ref={attachRef}", controls);
    expect(field).toBeGreaterThan(-1);
    expect(input).toBeGreaterThan(field);
    expect(controls).toBeGreaterThan(input);
    expect(attachment).toBeGreaterThan(controls);

    const primaryRegion = composer.slice(controls, attachment);
    expect(primaryRegion).toContain('flexDirection: "row"');
    expect(primaryRegion).toContain('justifyContent: "flex-start"');
    if (primaryRegion.includes("<ComposerPrimaryAction")) {
      // Once Hermes wires the standalone component, it must replace, not supplement, the inline button.
      expect(primaryRegion.match(/<ComposerPrimaryAction\\b/g) ?? []).toHaveLength(1);
      expect(primaryRegion).toContain("onStop={onStop}");
      expect(primaryRegion).toContain("onSubmit={submit}");
      expect(primaryRegion).not.toContain('accessibilityLabel="Stop"');
    } else {
      // The currently mounted conditional is one of three exclusive branches of one JSX expression.
      expect(primaryRegion).toContain("editingQueue ? <PressScale");
      expect(primaryRegion).toContain("(streaming || steerBusy) && !canSend");
      expect(primaryRegion).toContain('accessibilityLabel="Stop"');
      expect(primaryRegion).toContain("onPress={onStop}");
      expect(primaryRegion).toContain("onPress={submit}");
      expect(primaryRegion.match(/accessibilityLabel="Stop"/g) ?? []).toHaveLength(1);
    }
    expect(composer).toMatch(/hit:\\s*\\{\\s*width:\\s*44,\\s*height:\\s*44/);
  });

  test("extracted visual target is one 44-DIP accessible PressScale with theme and reduced motion", () => {
    expect(component.match(/<PressScale\\b/g) ?? []).toHaveLength(1);
    expect(component).toContain('testID="composer-primary-action"');
    expect(component).toContain('accessibilityRole="button"');
    expect(component).toContain("accessibilityLabel={action.label}");
    expect(component).toContain("accessibilityState={{ disabled: action.disabled }}");
    expect(component).toContain("disabled={action.disabled}");
    expect(component).toContain("activateComposerPrimaryAction(action, onSubmit, onStop)");
    expect(component).toMatch(/width:\\s*44/);
    expect(component).toMatch(/height:\\s*44/);
    expect(component).toContain("colors.gold");
    expect(component).toContain("colors.text");
    expect(component).toContain("colors.bg");
    expect(component).toContain("allowFontScaling");
    expect(pressScale).toContain("ReduceMotion.System");
    expect(component).not.toContain("onAccessibilityAction");
  });
});
