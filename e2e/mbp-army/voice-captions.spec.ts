// DA-056: a one-line live caption of the z0live call in the chat window, with a CC toggle in focus.
// DA-096: outside focus and chat windows the bubble is the only call surface, so no caption band.
// Real Expo web app + real authenticated bridge + loopback z0live fixture broker + scripted web peer.
// Proves browser state and layout only, never Android audio, native WebRTC or a real model.
import { test as base, expect, pair } from "./fixtures";
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from "./fixture-z0live-broker";

const test = base.extend<{ voiceBroker: FixtureZ0liveBroker }>({
  voiceBroker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ voiceBroker }, use) => {
    await use({ identity: true, env: { DASH_NATIVE_VOICE: "1", DASH_Z0LIVE_BROKER: voiceBroker.origin, DASH_ARMY_VOICE_WEB: "1", ARMY_PERSIST_SESSION: "1" } });
  },
});

if (process.platform === "darwin") test.use({ persistSession: false });

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath("final.png") });
});

test("live caption strip shows streaming user and agent text in one line over Dash and CC turns it off", async ({ page, bridge, voiceBroker }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: "z0live", scope: "z0live:voice" });
  voiceBroker.authorize(z0live);
  await page.addInitScript((tokens: { dash: string; z0live: string }) => {
    Object.defineProperty(window, "__dashVoiceArmy", { value: { ...tokens, identity: { credentialId: "cred_armycaption01" } }, configurable: true });
    Object.defineProperty(window, "__dashVoiceSay", { value: "ARMY voice hello", configurable: true });
  }, { dash, z0live });
  await pair(page, bridge);
  const hermes = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]').filter({ hasText: "ARMY native fixture" });
  await expect(hermes).toHaveCount(1, { timeout: 30000 });
  await hermes.click({ noWaitAfter: true });
  await expect(page.getByTestId("chat-window")).toBeVisible();
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Expand", exact: true }).click({ noWaitAfter: true });

  // The provider's SDP answer is held until the in-page recorder below is armed, so no speech is missed.
  const releaseAnswer = voiceBroker.holdAnswer();
  await page.getByRole("button", { name: "Start voice in Dash", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("voice-caption-strip"), "full-screen Voice has its own transcript").toHaveCount(0);
  await page.getByRole("button", { name: "Back to chat · call keeps going" }).click({ noWaitAfter: true });
  const strip = page.getByTestId("voice-caption-strip");
  const bubble = page.getByTestId("voice-orb-overlay");
  await expect(bubble).toBeVisible();
  await expect(strip, "Main shows the bubble, not a caption band").toHaveCount(0);
  await page.getByRole("tab").nth(1).click({ noWaitAfter: true });
  await hermes.click({ noWaitAfter: true });
  const chat = page.getByTestId("chat-window");
  await expect(chat).toBeVisible();
  await expect(chat.getByTestId("voice-caption-strip")).toBeVisible();
  await expect(page.getByTestId("voice-live-caption")).toHaveText("Captions on");

  // Record every caption text the page shows: scripted partials last a few hundred ms.
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.defineProperty(window, "__armyCaptions", { value: seen, configurable: true });
    const record = () => {
      const text = document.querySelector('[data-testid="voice-live-caption"]')?.textContent ?? "";
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    };
    record();
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const recorded = () => page.evaluate(() => {
    const value: unknown = Reflect.get(window, "__armyCaptions");
    return Array.isArray(value) ? value.map(String) : [];
  });
  releaseAnswer();
  const wanted = ["You · ARMY voice", "You · ARMY voice hello", "Dash · ARMY voice", "Dash · ARMY voice reply"];
  const inOrder = (seen: string[]) => { let next = 0; for (const text of seen) if (text === wanted[next]) next++; return next; };
  await expect.poll(async () => inOrder(await recorded()), { timeout: 20000, message: "partial then final text for you, then for Dash" }).toBe(wanted.length);
  await expect(page.getByTestId("voice-live-caption")).toHaveText("Dash · ARMY voice reply");
  await expect(page.getByTestId("voice-live-caption")).toHaveAttribute("aria-label", "Dash said: ARMY voice reply");

  const box = await strip.boundingBox();
  expect(box?.height, "the strip is a single short line").toBeLessThanOrEqual(24);
  await expect(page.getByTestId("voice-mic-bar")).toHaveCount(0);
  await expect(page.getByTestId("voice-captions-toggle")).toHaveCount(0);
  await expect(page.getByTestId("window-voice-controls")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("captions-window.png") });

  await bubble.click();
  await expect(page.getByTestId("voice-transcript")).toContainText("ARMY voice reply");
  await page.getByRole("button", { name: "Hide live captions", exact: true }).click();
  await expect(page.getByTestId("voice-transcript")).toHaveCount(0);
  await page.getByTestId("voice-focus-back").click();
  await expect(chat).toBeVisible();
  await expect(strip).toHaveCount(0);
  await expect(bubble).toHaveAttribute("aria-label", /^Open voice focus · (Listening|Hearing|Thinking|Speaking)/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dash.voice.captions"))).toBe("off");
  await page.screenshot({ path: info.outputPath("captions-off.png") });
  await bubble.click();
  await page.getByRole("button", { name: "Show live captions", exact: true }).click();
  await page.getByTestId("voice-focus-back").click();
  await expect(chat.getByTestId("voice-live-caption")).toHaveText("Dash · ARMY voice reply");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dash.voice.captions"))).toBe("on");

  await bubble.click({ delay: 650 });
  await page.getByTestId("voice-bubble-menu").getByRole("button", { name: "End", exact: true }).click();
  await expect(strip).toHaveCount(0);
  await expect.poll(() => voiceBroker.calls().filter(call => call.method === "POST" && /^\/v1\/sessions\/[^/]+\/end$/.test(call.path)).length).toBe(1);
  expect(voiceBroker.calls().filter(call => call.method === "POST" && call.path === "/v1/tools/ask_z0")).toHaveLength(1);
});
