import { afterEach, expect, test } from "bun:test";
import { pageControls, registerPage, rowsFor, tapIndex, type SettingRow } from "./settings-registry";

export function row(id = "view", select = (_index: number) => {}): SettingRow {
  return { id, label: id, kind: "scrub", home: "composer", values: ["Fleet", "Work"], index: 0, select };
}
afterEach(() => pageControls.set({}));

test("old owner cleanup cannot remove a replacement even when rows are reused", () => {
  const rows = [row()];
  const oldCleanup = registerPage("orchestra", rows);
  const newCleanup = registerPage("orchestra", rows);
  oldCleanup();
  expect(pageControls.get().orchestra).toBe(rows);
  newCleanup();
  expect(pageControls.get().orchestra).toBeUndefined();
});

test("rows preserve homes, order, tap cycle and action semantics", () => {
  const global = [row("info"), { ...row("rare"), home: "header" as const }];
  expect(rowsFor("composer", global, [row("view")]).map(r => r.id)).toEqual(["info", "view"]);
  expect(tapIndex({ index: 1, values: ["a", "b"], kind: "scrub" })).toBe(0);
  expect(tapIndex({ index: 0, values: [], kind: "toggle" })).toBe(0);
  expect(tapIndex({ index: 3, values: [], kind: "action" })).toBe(3);
});
