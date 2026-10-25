import { describe, expect, test } from "bun:test";
import { MENU_ROW_HEIGHT, rowGestureActions, submenuChoices, submenuIndex } from "./composer-row-submenu";

describe("composer row's secondary options", () => {
  test("long press opens only that row; tap still runs its primary callback exactly once", () => {
    const calls: string[] = [];
    const row = {
      id: "surface", label: "Surface", value: "Chat",
      values: ["Chat", "Live surface"], index: 0,
      run: () => calls.push("primary"),
      inspect: (index: number) => calls.push("choice:" + index),
    };
    const actions = rowGestureActions(row, {
      open: () => calls.push("open:surface"),
      close: () => calls.push("close"),
    });
    actions.hold();
    expect(calls).toEqual(["open:surface"]);
    expect(actions.choose(1)).toBe(true);
    expect(calls).toEqual(["open:surface", "close", "choice:1"]);
    actions.tap();
    expect(calls).toEqual(["open:surface", "close", "choice:1", "close", "primary"]);
  });

  test("value list exposes exact indices/current selection, even duplicate names", () => {
    const called: number[] = [];
    const row = {
      id: "details", label: "Thinking & tools", value: "Full",
      values: ["Compact", "Full", "Full"], index: 2,
      inspect: (index: number) => { called.push(index); },
      run: () => { throw new Error("not the selection action"); },
    };
    const choices = submenuChoices(row);
    expect(choices.map(choice => choice.label)).toEqual(["Compact", "Full", "Full"]);
    expect(choices.map(choice => choice.selected)).toEqual([false, false, true]);
    expect(choices.map(choice => choice.id)).toEqual(["details:0", "details:1", "details:2"]);
    choices[1]?.run();
    expect(called).toEqual([1]);
  });

  test("explicit host actions override generic values, without inventing pen or profile modes", () => {
    const calls: string[] = [];
    const choices = submenuChoices({
      id: "harness", label: "Harness", value: "Hermes",
      values: ["unused"],
      run: () => calls.push("primary"),
      options: [
        { id: "omp", label: "OMP", run: () => calls.push("omp") },
        { id: "hermes", label: "Hermes", selected: true, run: () => calls.push("hermes") },
      ],
    });
    expect(choices.map(choice => [choice.id, choice.label, choice.selected])).toEqual([
      ["omp", "OMP", false], ["hermes", "Hermes", true],
    ]);
    choices[0]?.run();
    expect(calls).toEqual(["omp"]);
  });

  test("action-only row gets a truthful Open action, not fake submenu choices", () => {
    const calls: string[] = [];
    const row = { id: "annotate", label: "Annotate", value: "S Pen or finger", run: () => calls.push("annotation") };
    const choices = submenuChoices(row);
    expect(choices.map(choice => choice.label)).toEqual(["Open Annotate"]);
    const gesture = rowGestureActions(row, { open: () => calls.push("open"), close: () => calls.push("close") });
    gesture.hold();
    expect(calls).toEqual(["open"]);
    expect(gesture.choose(99)).toBe(false);
    expect(calls).toEqual(["open"]);
    expect(gesture.choose(0)).toBe(true);
    expect(calls).toEqual(["open", "close", "annotation"]);
  });

  test("drag selection is anchored below the touched row; off-target releases cannot execute", () => {
    expect(MENU_ROW_HEIGHT).toBeGreaterThanOrEqual(44);
    expect(submenuIndex(0, 3)).toBe(-1);
    expect(submenuIndex(MENU_ROW_HEIGHT - 1, 3)).toBe(-1);
    expect(submenuIndex(MENU_ROW_HEIGHT, 3)).toBe(0);
    expect(submenuIndex(2 * MENU_ROW_HEIGHT - 1, 3)).toBe(0);
    expect(submenuIndex(2 * MENU_ROW_HEIGHT, 3)).toBe(1);
    expect(submenuIndex(4 * MENU_ROW_HEIGHT - 1, 3)).toBe(2);
    expect(submenuIndex(4 * MENU_ROW_HEIGHT, 3)).toBe(-1);
    expect(submenuIndex(-100, 3)).toBe(-1);
    expect(submenuIndex(Number.NaN, 3)).toBe(-1);
    expect(submenuIndex(48, 0)).toBe(-1);
  });
});
