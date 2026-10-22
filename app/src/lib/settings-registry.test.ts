import { describe, expect, test } from "bun:test";
import { activeScreen, pageControls, registerPage, rowsFor, tapIndex, type SettingRow } from "./settings-registry";

const row = (id: string, home: SettingRow["home"] = "composer", kind: SettingRow["kind"] = "scrub"): SettingRow => ({ id, label: id, kind, home, values: ["a", "b", "c"], index: 0, select: () => {} });

describe("settings registry", () => {
  test("global rows come first, then the page's own, filtered by home", () => {
    const global = [row("info"), row("layout")];
    const page = [row("orchestra-view"), row("thinking-summaries", "header")];
    expect(rowsFor("composer", global, page).map(r => r.id)).toEqual(["info", "layout", "orchestra-view"]);
    expect(rowsFor("header", global, page).map(r => r.id)).toEqual(["thinking-summaries"]);
    expect(rowsFor("composer", global).map(r => r.id)).toEqual(["info", "layout"]);
  });
  test("register and unregister per screen; a stale unregister keeps the newer rows", () => {
    const a = [row("x")], b = [row("y")];
    const offA = registerPage("orchestra", a);
    expect(pageControls.get().orchestra).toBe(a);
    const offB = registerPage("orchestra", b);
    offA();
    expect(pageControls.get().orchestra).toBe(b);
    offB();
    expect(pageControls.get().orchestra).toBeUndefined();
    expect(activeScreen.get()).toBe("chats");
  });
  test("plain tap cycles values; actions keep their index", () => {
    expect(tapIndex({ index: 0, values: ["a", "b", "c"], kind: "scrub" })).toBe(1);
    expect(tapIndex({ index: 2, values: ["a", "b", "c"], kind: "scrub" })).toBe(0);
    expect(tapIndex({ index: 1, values: ["All", "Focus"], kind: "toggle" })).toBe(0);
    expect(tapIndex({ index: 0, values: ["go"], kind: "action" })).toBe(0);
    expect(tapIndex({ index: 0, values: [], kind: "scrub" })).toBe(0);
  });
});
