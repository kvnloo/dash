import { expect, test } from "bun:test";
import { launchSharedVoice } from "./voice-launch";

for (const platform of ["android", "ios", "web"]) {
  test(`${platform} keeps voice inside Dash and explains the missing media transport`, async () => {
    const opened: string[] = [];
    const result = await launchSharedVoice(platform, { openURL: async url => { opened.push(url); } });
    expect(opened).toEqual([]);
    expect(result.kind).toBe("unavailable");
    expect(result.message).toContain("WebRTC");
    expect(result.message).toContain("System Dictate still works");
    expect(result.message).toContain("not z0live");
  });
}
