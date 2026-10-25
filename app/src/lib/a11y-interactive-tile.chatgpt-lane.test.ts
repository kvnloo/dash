import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { componentSizing, DENSITIES } from "./tile-layout";
import {
  buildTileCommands,
  dispatchTileAccessibilityAction,
  tileAccessibilityActions,
  tileAccessibilityLabel,
  tileAccessibilityState,
} from "./a11y-interactive-tile";

describe("InteractiveTile accessible labels and state", () => {
  test("normal, pinned, in-flight copy and terminal copy states say only what happened", () => {
    expect(tileAccessibilityLabel("Build", "Open details", false, "idle")).toBe("Build. Open details.");
    expect(tileAccessibilityLabel("Build", "Open details", true, "idle")).toBe("Build. Open details. Pinned locally.");
    expect(tileAccessibilityLabel("Build", "Open details", false, "copying")).toBe("Build. Open details. Copying summary.");
    expect(tileAccessibilityLabel("Build", "Open details", false, "copied")).toBe("Build. Open details. Summary copied.");
    expect(tileAccessibilityLabel("Build", "Open details", false, "failed")).toBe("Build. Open details. Copy failed.");
    expect(tileAccessibilityLabel("", " ", false, "idle")).toBe("Untitled tile. Summary unavailable.");
    expect(tileAccessibilityLabel(" Build! ", " Summary? ", false, "idle")).toBe("Build. Summary.");
  });

  test("copying alone reports busy, never inventing disabled, selected or expanded state", () => {
    expect(tileAccessibilityState("idle")).toEqual({ busy: false });
    expect(tileAccessibilityState("copying")).toEqual({ busy: true });
    expect(tileAccessibilityState("copied")).toEqual({ busy: false });
    expect(tileAccessibilityState("failed")).toEqual({ busy: false });
    expect(Object.keys(tileAccessibilityState("idle"))).toEqual(["busy"]);
  });
});

describe("InteractiveTile touch and screen-reader action parity", () => {
  test("activate, pin, copy, density and extras dispatch the exact gesture command", () => {
    const calls: string[] = [];
    const commands = buildTileCommands({
      onOpen: () => calls.push("detail"),
      onPin: () => calls.push("pin"),
      onCopy: () => calls.push("copy"),
      onDensity: () => calls.push("density"),
      pinned: false,
      hasSummary: true,
      extras: [{ id: "archive", label: "Archive locally", run: () => calls.push("archive") }],
    });
    expect(tileAccessibilityActions(commands)).toEqual([
      { name: "activate", label: "Open detail" },
      { name: "pin", label: "Pin locally" },
      { name: "copy", label: "Copy summary" },
      { name: "density", label: "Change density" },
      { name: "archive", label: "Archive locally" },
    ]);
    for (const action of tileAccessibilityActions(commands)) {
      const id = action.name === "activate" ? "detail" : action.name;
      const before = calls.length;
      expect(dispatchTileAccessibilityAction(action.name, commands)).toBe(true);
      commands.find(command => command.id === id)?.run();
      expect(calls.slice(before)).toEqual([id, id]);
    }
    const before = calls.length;
    expect(dispatchTileAccessibilityAction("missing", commands)).toBe(false);
    expect(calls.length).toBe(before);
  });

  test("pinned action becomes Unpin, and missing summary cannot advertise or dispatch copy", () => {
    const calls: string[] = [];
    const commands = buildTileCommands({
      onOpen: () => calls.push("detail"),
      onPin: () => calls.push("pin"),
      onCopy: () => calls.push("copy"),
      onDensity: () => calls.push("density"),
      pinned: true,
      hasSummary: false,
      extras: [],
    });
    expect(tileAccessibilityActions(commands)).toEqual([
      { name: "activate", label: "Open detail" },
      { name: "pin", label: "Unpin" },
      { name: "density", label: "Change density" },
    ]);
    expect(dispatchTileAccessibilityAction("copy", commands)).toBe(false);
    expect(calls).toEqual([]);
    expect(dispatchTileAccessibilityAction("pin", commands)).toBe(true);
    expect(calls).toEqual(["pin"]);
  });

  test("only four distinct, labelled, nonreserved extras reach either input mode", () => {
    const calls: string[] = [];
    const extra = (id: string, label: string) => ({ id, label, run: () => calls.push(id) });
    const commands = buildTileCommands({
      onOpen: () => calls.push("detail"),
      onPin: () => calls.push("pin"),
      onCopy: () => calls.push("copy"),
      onDensity: () => calls.push("density"),
      pinned: false,
      hasSummary: true,
      extras: [
        extra("copy", "Overtake copy"),
        extra("activate", "Overtake open"),
        extra("detail", "Overtake detail"),
        extra("bad ", "Whitespace id"),
        extra("blank", " "),
        extra("alpha", "Alpha"),
        extra("alpha", "Duplicate"),
        extra("beta", "Beta"),
        extra("gamma", "Gamma"),
        extra("delta", "Delta"),
        extra("overflow", "Not in the wheel"),
      ],
    });
    expect(commands.map(command => command.id)).toEqual(["detail", "pin", "copy", "density", "alpha", "beta", "gamma", "delta"]);
    const offered = tileAccessibilityActions(commands).map(action => action.name);
    expect(offered).toEqual(["activate", "pin", "copy", "density", "alpha", "beta", "gamma", "delta"]);
    for (const id of ["alpha", "beta", "gamma", "delta"]) expect(dispatchTileAccessibilityAction(id, commands)).toBe(true);
    expect(calls).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(dispatchTileAccessibilityAction("overflow", commands)).toBe(false);
    expect(dispatchTileAccessibilityAction("bad ", commands)).toBe(false);
  });
});

describe("InteractiveTile production semantic contract (render/device checks remain external)", () => {
  const source = readFileSync(new URL("../components/InteractiveTile.tsx", import.meta.url), "utf8");

  test("the native accessible button uses the same command inventory and dispatcher as gesture touch", () => {
    expect(source).toContain('accessible accessibilityRole="button" accessibilityLabel={tileAccessibilityLabel(title, summary, pinned, copyState)} accessibilityState={tileAccessibilityState(copyState)}');
    expect(source).toContain("const commands = buildTileCommands(");
    expect(source).toContain("actions: commands");
    expect(source).toContain("accessibilityActions={tileAccessibilityActions(commands)}");
    expect(source).toContain("dispatchTileAccessibilityAction(event.nativeEvent.actionName, commands)");
  });

  test("copy completion and failure are announced; modal traps a11y and restores the trigger focus", () => {
    expect(source).toContain('AccessibilityInfo.announceForAccessibility("Summary copied")');
    expect(source).toContain('AccessibilityInfo.announceForAccessibility("Copy failed")');
    expect(source).toContain("AccessibilityInfo.setAccessibilityFocus(handle)");
    expect(source).toContain('importantForAccessibility={detail ? "no-hide-descendants" : "auto"}');
    expect(source).toContain("accessibilityViewIsModal onAccessibilityEscape={close}");
    expect(source).toContain("returnFocus.current = detail?.restoreFocus ?? null");
    expect(source).toContain("BackHandler.addEventListener");
    expect(source).toContain("reduceMotion: ReduceMotion.System");
  });

  test("compact, comfortable, rich and large-type tiles keep at least 44 DIP touch heights", () => {
    for (const density of DENSITIES) for (const scale of [0.5, 1, 2]) {
      expect(componentSizing(density, scale).rowMin).toBeGreaterThanOrEqual(44);
    }
    expect(source).toContain("minHeight: sizing.rowMin");
    expect(source).toContain("minHeight: 48, minWidth: 44");
    expect(source).toContain("useReducedMotion()");
  });
});
