import { describe, expect, test } from "bun:test";
import { launchSharedVoice } from "./voice-launch";

describe("shared z0live voice launcher", () => {
  test("Android opens the exact public controls URI with no pairing or session data", async () => {
    const opened: string[] = [];
    const result = await launchSharedVoice("android", {
      openURL: async (url) => {
        opened.push(url);
      },
    });

    expect(opened).toEqual(["z0live://voice"]);
    expect(result).toEqual({ kind: "opened" });
  });

  test("a missing app offers installation or explicit legacy voice without throwing", async () => {
    const result = await launchSharedVoice("android", {
      openURL: async () => {
        throw new Error("No Activity found to handle Intent");
      },
    });

    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("Expected unavailable voice");
    expect(result.message).toContain("Lawnchair z0live");
    expect(result.message).toContain("install");
    expect(result.message).toContain("legacy voice");
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
      expect(result.message).toContain("Android");
      expect(result.message).toContain("legacy voice");
    });
  }
});
