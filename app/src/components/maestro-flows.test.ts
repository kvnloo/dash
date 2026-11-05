import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const maestro = join(import.meta.dir, "../../../.maestro");

describe("Maestro flows (device later; never kill Metro)", () => {
  test("flows never stopApp/launchApp because that kills the live Metro session", () => {
    for (const name of ["inspect-nav.yaml", "inspect-keyboard.yaml", "inspect-bridge.yaml", "config.yaml"]) {
      const src = readFileSync(join(maestro, name), "utf8");
      expect(src).not.toMatch(/^- launchApp/m);
      expect(src).not.toMatch(/^- stopApp/m);
    }
  });

  test("nav flow screenshots the live Expo Go session", () => {
    const src = readFileSync(join(maestro, "inspect-nav.yaml"), "utf8");
    expect(src).toContain("appId: host.exp.exponent");
    expect(src).toContain("takeScreenshot: maestro-nav");
  });

  test("keyboard flow opens the Main composer without relaunching Expo Go", () => {
    const src = readFileSync(join(maestro, "inspect-keyboard.yaml"), "utf8");
    expect(src).toContain("Message Dash");
    expect(src).toContain("takeScreenshot: maestro-keyboard");
  });
});
