// Real Dash web pairing -> authenticated Bun bridge -> fixture ACP agent.
// Voice status is diagnostic only; native mic and deployed z0live still require device checks.
import { test, expect, openChat, pair, send, type Bridge } from "./fixtures";
import { PROTOCOL_VERSION, parseServerMessage } from "../../shared/protocol";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const statusUrl = (bridge: Bridge) => `http://127.0.0.1:${bridge.port}/voice/status`;
const legacyToken = async (bridge: Bridge) =>
  (await readFile(join(bridge.dir, ".dash/token"), "utf8")).trim();
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath("final.png") });
});

test("voice status diagnoses missing model, rejects anonymous requests, and announces hello", async ({ page, bridge, request }) => {
  await openChat(page, bridge);
  await send(page, "ARMY_VOICE_STATUS real fixture turn");
  await expect(page.getByText(/ARMY_REPLY: ARMY_VOICE_STATUS/).first()).toBeVisible();

  const unauthorized = await request.get(statusUrl(bridge));
  expect(unauthorized.status()).toBe(401);
  const token = await legacyToken(bridge);
  const response = await request.get(statusUrl(bridge), { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body: unknown = await response.json();
  expect(body).toMatchObject({
    stt: { ok: false }, ffmpeg: expect.any(Boolean), nativeVoice: true,
    identity: false, broker: expect.any(String),
  });
  if (!record(body) || !record(body.stt) || typeof body.stt.reason !== "string") {
    throw Error("Unavailable STT must have a diagnostic reason");
  }
  expect(body.stt.reason).toMatch(/model/i);
  expect(Object.keys(body).sort()).toEqual(["stt", "ffmpeg", "nativeVoice", "identity", "broker"].sort());

  // Observe a fresh real WebSocket hello after the UI has paired. No message or route mock.
  const raw: unknown = await page.evaluate(({ port, token: sessionToken }) =>
    new Promise<unknown>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(sessionToken)}`);
      const timer = setTimeout(() => { socket.close(); reject(Error("Bridge hello timed out")); }, 10000);
      socket.addEventListener("message", event => {
        clearTimeout(timer);
        socket.close();
        try { resolve(JSON.parse(String(event.data))); } catch (error) { reject(error); }
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(Error("Bridge hello socket failed"));
      }, { once: true });
    }), { port: bridge.port, token });

  const hello = parseServerMessage(raw);
  if (!hello || hello.type !== "hello") throw Error("Bridge did not send a parsed hello");
  expect(hello.version).toBe(PROTOCOL_VERSION);
  expect(hello.voice).toEqual({ stt: false, nativeVoice: true });
  if (!record(raw)) throw Error("Bridge hello must be a JSON object");
  const legacyHello: Record<string, unknown> = Object.fromEntries(
    Object.entries(raw).filter(([key]) => key !== "voice"),
  );
  const parsedLegacy = parseServerMessage(legacyHello);
  if (!parsedLegacy || parsedLegacy.type !== "hello") throw Error("Old bridge hello no longer pairs");
  expect(parsedLegacy.voice).toBeUndefined();
});

test.describe("fixture speech engine", () => {
  test.use({ bridgeOptions: { env: { DASH_STT_ENGINE: "fixture" } } });
  test("voice status follows fixture STT availability", async ({ page, bridge, request }) => {
    await pair(page, bridge);
    const response = await request.get(statusUrl(bridge), {
      headers: { authorization: `Bearer ${await legacyToken(bridge)}` },
    });
    expect(response.status()).toBe(200);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ stt: { ok: true }, nativeVoice: true });
    if (!record(body) || !record(body.stt)) throw Error("Missing STT status");
    expect(body.stt.reason).toBeUndefined();
  });
});

test.describe("explicitly disabled voice with configured identity", () => {
  test.use({
    bridgeOptions: {
      identity: true,
      env: {
        DASH_STT_ENGINE: "fixture",
        DASH_NATIVE_VOICE: "0",
        DASH_Z0LIVE_BROKER: "https://voice-fixture.ts.net:8791",
      },
    },
  });
  test("voice status accepts either principal and reports disabled native voice", async ({ page, bridge, request }) => {
    await pair(page, bridge);
    for (const token of [await legacyToken(bridge), bridge.identityToken()]) {
      const response = await request.get(statusUrl(bridge), { headers: { authorization: `Bearer ${token}` } });
      expect(response.status()).toBe(200);
      const body: unknown = await response.json();
      expect(body).toMatchObject({
        stt: { ok: true }, ffmpeg: expect.any(Boolean), nativeVoice: false,
        identity: true, broker: "https://voice-fixture.ts.net:8791",
      });
    }
    const disallowed = await request.post(statusUrl(bridge), {
      headers: { authorization: `Bearer ${await legacyToken(bridge)}` },
    });
    expect(disallowed.status()).toBe(405);
  });
});
