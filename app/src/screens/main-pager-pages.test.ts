import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// GesturePager lays pages out in a column slot. A page without flex: 1 sizes to its
// content, so a FlashList inside it gets no height and paints nothing (the empty Chats pane).
describe("MainScreen pager pages", () => {
  const main = readFileSync(join(import.meta.dir, "MainScreen.tsx"), "utf8");
  const pages = [...main.matchAll(/<View key="(bots|chats|orchestra)" style=\{\{([^}]*)\}\}>/g)];

  test("all three pages are declared", () => {
    expect(pages.map((m) => m[1])).toEqual(["bots", "chats", "orchestra"]);
  });

  for (const name of ["bots", "chats", "orchestra"]) {
    test(`${name} page fills the pager slot height`, () => {
      const style = pages.find((m) => m[1] === name)?.[2] ?? "";
      expect(style).toMatch(/\bflex:\s*1\b/);
    });
  }

  test("pager slot itself stretches each page", () => {
    const pager = readFileSync(join(import.meta.dir, "../components/GesturePager.tsx"), "utf8");
    expect(pager).toContain("<View key={index} style={{ width: pageWidth, flex: 1 }}>");
  });
});
