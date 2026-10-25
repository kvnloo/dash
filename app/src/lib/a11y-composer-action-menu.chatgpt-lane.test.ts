import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  composerMenuUnavailable,
  describeComposerMenuTrigger,
  describeComposerMenuRow,
  describeComposerMenuChoice,
  dispatchComposerMenuRowAction,
  dispatchComposerMenuChoiceAction,
  shouldRestoreComposerMenuFocus,
} from "./a11y-composer-action-menu";

describe("composer menu trigger accessibility", () => {
  test("announces the exact label and truthful collapsed/expanded state", () => {
    expect(describeComposerMenuTrigger("Filter", false)).toEqual({
      label: "Filter",
      hint: "Activate to open. Hold and slide to choose a row.",
      state: { expanded: false },
      actions: [{ name: "activate", label: "Open Filter" }],
    });
    expect(describeComposerMenuTrigger("Filter", true)).toEqual({
      label: "Filter",
      hint: "Activate to close the menu.",
      state: { expanded: true },
      actions: [{ name: "activate", label: "Close Filter" }],
    });
  });

  test("blocked opening is honest; an already-open busy menu remains dismissible", () => {
    expect(describeComposerMenuTrigger("Mode", false, { disabled: true })).toEqual({
      label: "Mode", hint: "Menu unavailable.",
      state: { expanded: false, disabled: true }, actions: [],
    });
    expect(describeComposerMenuTrigger("Mode", false, { loading: true })).toEqual({
      label: "Mode", hint: "Menu unavailable.",
      state: { expanded: false, disabled: true, busy: true }, actions: [],
    });
    expect(describeComposerMenuTrigger("Mode", true, { loading: true })).toEqual({
      label: "Mode", hint: "Activate to close the menu.",
      state: { expanded: true, disabled: false, busy: true },
      actions: [{ name: "activate", label: "Close Mode" }],
    });
    expect(describeComposerMenuTrigger(" ", false).label).toBe("Composer actions");
  });
});

describe("composer menu row and real choice semantics", () => {
  test("row name and current value are independent, with no fabricated selection", () => {
    const row = describeComposerMenuRow({ label: "Surface", value: "  Chat  ", run() {} }, false);
    expect(row).toEqual({
      label: "Surface",
      value: { text: "Chat" },
      hint: "Activate to run. Long press for options.",
      state: { expanded: false },
      actions: [
        { name: "activate", label: "Activate Surface" },
        { name: "longpress", label: "Show Surface options" },
      ],
    });
    expect(describeComposerMenuRow({ label: " ", value: "", run() {} }, true)).toEqual({
      label: "Unnamed menu action",
      value: undefined,
      hint: "Current value unavailable. Activate to run or hold for options.",
      state: { expanded: true },
      actions: [
        { name: "activate", label: "Activate Unnamed menu action" },
        { name: "longpress", label: "Show Unnamed menu action options" },
      ],
    });
  });

  test("disabled, loading, and selected state never imply a runnable option", () => {
    expect(composerMenuUnavailable({ disabled: true })).toBe(true);
    expect(composerMenuUnavailable({ loading: true })).toBe(true);
    expect(composerMenuUnavailable({ disabled: false, loading: false })).toBe(false);
    expect(describeComposerMenuRow({
      label: "Profile", value: "Fast", disabled: true, selected: false, run() {},
    }, false)).toEqual({
      label: "Profile", value: { text: "Fast" }, hint: "Action unavailable.",
      state: { expanded: false, disabled: true, selected: false }, actions: [],
    });
    expect(describeComposerMenuRow({
      label: "Profile", value: "Fast", loading: true, selected: true, run() {},
    }, true)).toEqual({
      label: "Profile", value: { text: "Fast" }, hint: "Action in progress.",
      state: { expanded: true, disabled: true, busy: true, selected: true }, actions: [],
    });
  });

  test("selected describes the real supplied choice, not an invented model or target", () => {
    const selected = describeComposerMenuChoice({ label: "Deep", selected: true, run() {} });
    expect(selected).toEqual({
      label: "Deep", hint: undefined, state: { selected: true },
      actions: [{ name: "activate", label: "Select Deep" }],
    });
    expect(describeComposerMenuChoice({ label: " ", disabled: true, run() {} })).toEqual({
      label: "Unnamed option", hint: "Option unavailable.",
      state: { disabled: true }, actions: [],
    });
    expect(describeComposerMenuChoice({ label: "Fast", loading: true, run() {} })).toEqual({
      label: "Fast", hint: "Option in progress.",
      state: { disabled: true, busy: true }, actions: [],
    });
  });

  test("tap and accessible activate share exactly one close-then-run callback", () => {
    const events: string[] = [];
    const row = { label: "Harness", value: "OMP", run: () => events.push("run:OMP") };
    const callbacks = {
      dismiss: () => events.push("dismiss"),
      showOptions: () => events.push("show"),
    };
    // The UI must call the SAME dispatcher for touch and screen reader.
    const touch = () => dispatchComposerMenuRowAction(row, "activate", callbacks);
    const accessible = (name: string) => dispatchComposerMenuRowAction(row, name, callbacks);
    expect(touch()).toBe(true);
    expect(events).toEqual(["dismiss", "run:OMP"]);
    events.length = 0;
    expect(accessible("activate")).toBe(true);
    expect(events).toEqual(["dismiss", "run:OMP"]);
    events.length = 0;
    expect(accessible("longpress")).toBe(true);
    expect(events).toEqual(["show"]);
    events.length = 0;
    expect(accessible("escape")).toBe(false);
    expect(events).toEqual([]);
  });

  test("unavailable row and choice actions do not dismiss or execute", () => {
    const events: string[] = [];
    const handlers = {
      dismiss: () => events.push("dismiss"),
      showOptions: () => events.push("show"),
    };
    for (const flags of [{ disabled: true }, { loading: true }]) {
      const row = { label: "Mode", value: "Chat", run: () => events.push("row"), ...flags };
      expect(dispatchComposerMenuRowAction(row, "activate", handlers)).toBe(false);
      expect(dispatchComposerMenuRowAction(row, "longpress", handlers)).toBe(false);
      const choice = { label: "Chat", run: () => events.push("choice"), ...flags };
      expect(dispatchComposerMenuChoiceAction(choice, "activate", handlers.dismiss)).toBe(false);
    }
    expect(events).toEqual([]);
  });

  test("a real choice's activation invokes exactly that choice, not its neighbor", () => {
    const events: string[] = [];
    const choices = [
      { label: "Chat", selected: true, run: () => events.push("Chat") },
      { label: "Live surface", selected: false, run: () => events.push("Live surface") },
    ];
    const dismiss = () => events.push("dismiss");
    expect(dispatchComposerMenuChoiceAction(choices[1], "activate", dismiss)).toBe(true);
    expect(events).toEqual(["dismiss", "Live surface"]);
    events.length = 0;
    expect(dispatchComposerMenuChoiceAction(choices[0], "longpress", dismiss)).toBe(false);
    expect(events).toEqual([]);
  });
});

describe("menu dismissal and source-backed native boundary", () => {
  test("restore focus only on a real dismissal transition, not on selection or first render", () => {
    expect(shouldRestoreComposerMenuFocus(true, false, true)).toBe(true);
    for (const state of [
      [false, false, true], [false, true, true], [true, true, true],
      [true, false, false],
    ]) {
      expect(shouldRestoreComposerMenuFocus(state[0], state[1], state[2])).toBe(false);
    }
  });

  test("existing trigger, scrim, minimum targets, gesture and reduced motion remain intact", () => {
    // Baseline source contracts only. PR #210 owns concurrent row JSX; native
    // wiring of this helper is intentionally deferred to Hermes integration.
    const source = readFileSync(join(import.meta.dir, "../components/ComposerActionMenu.tsx"), "utf8");
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain('accessibilityLabel={`Close ${label}`}');
    expect(source).toContain("accessibilityState={{ expanded: open }}");
    expect(source).toContain("onAccessibilityTap={actions.toggle}");
    expect(source).toContain("Gesture.Exclusive(hold, Gesture.Tap()");
    expect(source).toContain("minWidth: 44, minHeight: 44");
    expect(source).toContain("ReduceMotion.System");
  });
});
