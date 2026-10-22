import { describe, expect, test } from "bun:test";
import { launchSharedVoice } from "./voice-launch";

describe("retired external voice launcher", () => {
  test("Android never opens a secondary app", async () => {
    const opened: string[] = [];
    const result = await launchSharedVoice("android", {
      openURL: async (url) => {
        opened.push(url);
      },
    });

    expect(opened).toEqual([]);
    expect(result.kind).toBe("unavailable");
  });

  test("a missing app offers installation or explicit legacy voice without throwing", async () => {
    const result = await launchSharedVoice("android", {
      openURL: async () => {
        throw new Error("No Activity found to handle Intent");
      },
    });

    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("Expected unavailable voice");
    expect(result.message).toContain("inside Dash");
    expect(result.message).toContain("Expo Go/web voice is unavailable");
  });

  test("unexpected native failures also become a recoverable fallback", async () => {
    const result = await launchSharedVoice("android", {
      openURL: async () => {
        throw "Unavailable";
      },
    });

    expect(result.kind).toBe("unavailable");
  });

  for (const platform of ["ios", "web", "windows"]) {
    test(`${platform} explains Android availability without opening a native URI`, async () => {
      const opened: string[] = [];
      const result = await launchSharedVoice(platform, {
        openURL: async (url) => {
          opened.push(url);
        },
      });

      expect(opened).toEqual([]);
      expect(result.kind).toBe("unavailable");
      if (result.kind !== "unavailable") throw new Error("Expected unavailable voice");
      expect(result.message).toContain("Expo Go/web voice is unavailable");
    });
  }
});
