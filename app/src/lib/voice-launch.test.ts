import { describe, expect, test } from "bun:test";
import { VOICE_BOOTSTRAP_PATH, checkVoiceBootstrap, launchSharedVoice } from "./voice-launch";

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


const attached = { profile: "hermes", session: "attached-session" };

describe("native voice bootstrap failures", () => {
  test("uses the existing authenticated bootstrap route", () => {
    expect(VOICE_BOOTSTRAP_PATH).toBe("/voice/bootstrap");
  });

  for (const [status, reason] of [
    [401, "Voice authorization expired. Re-pair Dash."],
    [403, "Voice permission denied. Check the voice grant."],
    [404, "Bridge lacks voice bootstrap. Update bridge."],
    [500, "Voice service unavailable. Retry shortly."],
    [502, "Voice service unavailable. Retry shortly."],
    [503, "Voice is disabled on this bridge."],
    [504, "Voice service unavailable. Retry shortly."],
  ] satisfies Array<[number, string]>) {
    test("HTTP " + status + " has an honest reason and Retry", async () => {
      const result = await checkVoiceBootstrap(attached, async () =>
        Response.json({ error: "private backend detail" }, { status }));
      expect(result).toEqual({ kind: "error", reason, retryLabel: "Retry" });
      if (result.kind !== "error") throw new Error("Expected bootstrap failure");
      expect(result.reason).not.toContain("private");
    });
  }

  test("offline, timeout and thrown non-Error values are retryable without leaking details", async () => {
    const offline = await checkVoiceBootstrap(attached, async () => {
      throw new TypeError("Failed to fetch https://private.example/token");
    });
    expect(offline).toEqual({ kind: "error", reason: "Can't reach Dash voice. Check connection.", retryLabel: "Retry" });
    const timeout = await checkVoiceBootstrap(attached, async () => {
      const error = new Error("private timeout detail");
      error.name = "TimeoutError";
      throw error;
    });
    expect(timeout).toEqual({ kind: "error", reason: "Voice request timed out. Retry.", retryLabel: "Retry" });
    const unknown = await checkVoiceBootstrap(attached, async () => { throw "private"; });
    expect(unknown).toEqual(offline);
  });

  test("success requires the exact attached profile and session", async () => {
    const sent: { profile: string; session: string }[] = [];
    const ok = await checkVoiceBootstrap(attached, async target => {
      sent.push({ profile: target.profile, session: target.session });
      return Response.json({ ready: true, profile: target.profile, session: target.session });
    });
    expect(ok).toEqual({ kind: "ready" });
    expect(sent).toEqual([attached]);
    for (const bad of [
      { ready: false, profile: "hermes", session: "attached-session" },
      { ready: true, profile: "other", session: "attached-session" },
      { ready: true, profile: "hermes", session: "other-session" },
      { ready: true, profile: "hermes" },
      null,
    ]) {
      expect(await checkVoiceBootstrap(attached, async () => Response.json(bad)))
        .toEqual({ kind: "error", reason: "Voice could not confirm this conversation.", retryLabel: "Retry" });
    }
    const malformed = await checkVoiceBootstrap(attached, async () => new Response("{", { status: 200 }));
    expect(malformed).toEqual({ kind: "error", reason: "Voice sent an invalid response.", retryLabel: "Retry" });
  });

  test("does not attempt to parse error bodies", async () => {
    const result = await checkVoiceBootstrap(attached, async () => ({
      ok: false, status: 401,
      json: async () => { throw new Error("must not inspect private response"); },
    }));
    expect(result.kind).toBe("error");
  });
});
