import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TAB_LABELS } from "../components/golden-nav";
import { DEFAULT_MAIN_TAB } from "./home";

describe("cold-open home tab", () => {
  test("default Main tab is Orchestra", () => {
    expect(TAB_LABELS[DEFAULT_MAIN_TAB]).toBe("Orchestra");
    expect(DEFAULT_MAIN_TAB).toBe(2);
  });

  test("MainScreen cold-opens on DEFAULT_MAIN_TAB, not Chats", () => {
    const main = readFileSync(join(import.meta.dir, "../screens/MainScreen.tsx"), "utf8");
    expect(main).toContain("DEFAULT_MAIN_TAB");
    expect(main).toMatch(/useState\(\s*DEFAULT_MAIN_TAB\s*\)/);
    expect(main).toMatch(/useSharedValue\(\s*DEFAULT_MAIN_TAB\s*\)/);
    expect(main).not.toMatch(/useState\(\s*1\s*\)/);
  });
});
