import { afterEach, expect, test } from "bun:test";
import { createPageControlsBinding, pageControls, pageRowsFor, registerPage, rowsFor, tapIndex, type PageControlsFocus, type SettingRow } from "./settings-registry";

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

test("all mounted panes follow active page and route focus, not mount lifetime", () => {
  const pages = ["bots", "chats", "orchestra"];
  const bindings = pages.map(createPageControlsBinding);
  function update(focus: PageControlsFocus) {
    bindings.forEach((binding, i) => binding.update([row(pages[i])], focus));
    expect(Object.keys(pageControls.get())).toEqual(focus.routeFocused ? [focus.activeMainPage!] : []);
    pages.forEach(page => expect(pageRowsFor(page, focus).map(r => r.id)).toEqual(focus.routeFocused && focus.activeMainPage === page ? [page] : []));
  }
  update({ routeFocused: true, activeMainPage: "chats" });
  update({ routeFocused: true, activeMainPage: "orchestra" });
  // The host also gates immediately, before the page's commit-time cleanup.
  expect(pageRowsFor("orchestra", { routeFocused: false, activeMainPage: "orchestra" })).toEqual([]);
  expect(pageRowsFor("orchestra", { routeFocused: true, activeMainPage: "bots" })).toEqual([]);
  update({ routeFocused: false, activeMainPage: "orchestra" });
  update({ routeFocused: true, activeMainPage: "orchestra" });
  update({ routeFocused: true, activeMainPage: "bots" });
  bindings.forEach(binding => binding.dispose());
  expect(pageControls.get()).toEqual({});
});

test("callback-only changes dispatch latest select/run without republishing rows", () => {
  const binding = createPageControlsBinding("orchestra");
  const focus = { routeFocused: true, activeMainPage: "orchestra" };
  const calls: string[] = [];
  function rows(owner: string): SettingRow[] {
    return [row("view", i => calls.push(`${owner}:${i}`)), { ...row("reset"), kind: "action", run: () => calls.push(`${owner}:reset`) }];
  }
  let publications = 0;
  const unsubscribe = pageControls.subscribe(() => publications++);
  binding.update(rows("old"), focus);
  const retained = pageControls.get().orchestra!;
  binding.update(rows("new"), focus);
  expect(pageControls.get().orchestra).toBe(retained);
  expect(publications).toBe(1);
  retained[0]!.select(1); retained[1]!.run?.();
  expect(calls).toEqual(["new:1", "new:reset"]);
  binding.update(rows("blurred"), { ...focus, routeFocused: false });
  expect(pageControls.get()).toEqual({});
  retained[0]!.select(0); retained[1]!.run?.();
  expect(calls).toEqual(["new:1", "new:reset"]);
  binding.update(rows("refocused"), focus);
  binding.update(rows("fresh"), focus);
  expect(publications).toBe(3); // register, immediate blur cleanup, one refocus registration
  expect(pageControls.get().orchestra).toHaveLength(2);
  pageControls.get().orchestra![0]!.select(0);
  retained[0]!.select(0);
  expect(calls).toEqual(["new:1", "new:reset", "fresh:0"]);
  unsubscribe(); binding.dispose();
});

test("stale binding and retained callbacks cannot affect a newer owner", () => {
  const a = createPageControlsBinding("orchestra"), b = createPageControlsBinding("orchestra");
  const focus = { routeFocused: true, activeMainPage: "orchestra" };
  const calls: string[] = [];
  a.update([row("view", () => calls.push("old"))], focus);
  const stale = pageControls.get().orchestra![0]!;
  b.update([row("view", () => calls.push("new"))], focus);
  a.dispose(); stale.select(0);
  expect(pageControls.get().orchestra).toHaveLength(1);
  pageControls.get().orchestra![0]!.select(0);
  expect(calls).toEqual(["new"]);
  b.dispose();
});

test("metadata, action presence, row removal and delimiter-containing values refresh safely", () => {
  const binding = createPageControlsBinding("orchestra");
  const focus = { routeFocused: true, activeMainPage: "orchestra" };
  binding.update([{ ...row(), values: ["a|b", "c"] }], focus);
  const old = pageControls.get().orchestra![0]!;
  let calls = 0;
  binding.update([{ ...row(), values: ["a", "b|c"], run: () => calls++ }], focus);
  expect(pageControls.get().orchestra![0]!.values).toEqual(["a", "b|c"]);
  pageControls.get().orchestra![0]!.run?.();
  expect(calls).toBe(1);
  old.select(1);
  binding.update([], focus);
  expect(pageControls.get().orchestra).toEqual([]);
  binding.dispose();
});
