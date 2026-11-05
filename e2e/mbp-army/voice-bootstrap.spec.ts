// Native voice metadata journey: real Expo pairing, bridge, native Hermes SQLite
// fixture and C01's ephemeral z0bridge identity. No route mocks or live credentials.
// Physical voice and deployed z0live remain separate host/device checks.
import { test, expect, pair, type Bridge } from "./fixtures";
import type { APIRequestContext } from "playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PROFILE = "default";
const SESSION = "army-fixture-session";
const BROKER = "https://voice-fixture.ts.net:8791";

function bootstrap(request: APIRequestContext, bridge: Bridge, bearer: string, profile: string, session = SESSION, origin?: string) {
  return request.post("http://127.0.0.1:" + bridge.port + "/voice/bootstrap", {
    headers: {
      authorization: "Bearer " + bearer,
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    data: { profile, session },
  });
}

test.describe("attached Hermes voice bootstrap", () => {
  test.use({ bridgeOptions: { identity: true, env: { DASH_NATIVE_VOICE: "1" } } });

  test("voice bootstrap resolves the real fixture Hermes chat IDs", async ({ page, bridge, request }) => {
    await pair(page, bridge);
    const token = bridge.identityToken();
    for (const profile of [PROFILE, "hermes:" + PROFILE, "hermes:session:" + PROFILE + ":" + SESSION]) {
      // Playwright APIRequestContext sends no Origin (unlike browser fetch).
      const response = await bootstrap(request, bridge, token, profile);
      expect(response.status(), profile).toBe(200);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        ready: true, profile, canonicalProfile: PROFILE, session: SESSION,
        audience: "z0live", requiredScope: "z0live:voice", backgroundMicrophone: false,
      });
    }
  });

  test("voice bootstrap rejects unknown sessions and legacy credentials", async ({ bridge, request }) => {
    const token = bridge.identityToken();
    const unknown = await bootstrap(request, bridge, token, "hermes:" + PROFILE, "army-unknown-session");
    expect(unknown.status()).toBe(400);
    const mismatched = await bootstrap(request, bridge, token, "hermes:session:" + PROFILE + ":" + SESSION, "army-unknown-session");
    expect(mismatched.status()).toBe(400);
    const legacy = (await readFile(join(bridge.dir, ".dash/token"), "utf8")).trim();
    const denied = await bootstrap(request, bridge, legacy, PROFILE);
    expect(denied.status()).toBe(401);
    const browser = await bootstrap(request, bridge, token, PROFILE, SESSION, "http://127.0.0.1:" + bridge.port);
    expect(browser.status()).toBe(401);
  });
});

test.describe("explicitly disabled native voice", () => {
  test.use({ bridgeOptions: { identity: true, env: { DASH_NATIVE_VOICE: "0" } } });
  test("voice bootstrap reports disabled native voice", async ({ bridge, request }) => {
    const response = await bootstrap(request, bridge, bridge.identityToken(), PROFILE);
    expect(response.status()).toBe(503);
  });
});

test.describe("configured z0live broker", () => {
  test.use({ bridgeOptions: { identity: true, env: { DASH_Z0LIVE_BROKER: BROKER } } });
  test("voice bootstrap echoes configured broker origin", async ({ bridge, request }) => {
    const response = await bootstrap(request, bridge, bridge.identityToken(), "hermes:session:" + PROFILE + ":" + SESSION);
    expect(response.status()).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ ready: true, broker: BROKER, canonicalProfile: PROFILE });
  });
});
