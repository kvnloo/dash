// Real Expo web app + real authenticated bridge + TURBO-C08 scripted voice peer/broker.
// Does not prove Android permission, speaker routing or physical device behavior.
import { test as base, expect, pair } from "./fixtures";
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from "./fixture-z0live-broker";

const test = base.extend<{ voiceBroker: FixtureZ0liveBroker }>({
  voiceBroker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ voiceBroker }, use) => {
    await use({
      identity: true,
      env: {
        DASH_NATIVE_VOICE: "1",
        DASH_Z0LIVE_BROKER: voiceBroker.origin,
        DASH_ARMY_VOICE_WEB: "1",
        ARMY_PERSIST_SESSION: "1",
      },
    });
  },
});

// These journeys need the Hermes database seed. Only Linux also has the OMP process fixture.
if (process.platform === "darwin") test.use({ persistSession: false });

test("live voice bubble follows the call, opens focus and hides for annotation", async ({ page, bridge, voiceBroker }) => {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: "z0live", scope: "z0live:voice" });
  voiceBroker.authorize(z0live);
  await page.addInitScript((tokens: { dash: string; z0live: string }) => {
    Object.defineProperty(window, "__dashVoiceArmy", {
      value: { ...tokens, identity: { credentialId: "cred_armyorb0001" } }, configurable: true,
    });
    Object.defineProperty(window, "__dashVoiceSay", { value: "ARMY voice hello", configurable: true });
  }, { dash, z0live });
  await pair(page, bridge);
  const hermes = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]')
    .filter({ hasText: "ARMY native fixture" });
  await expect(hermes).toHaveCount(1, { timeout: 30000 });
  await hermes.click({ noWaitAfter: true });
  await expect(page.getByTestId("chat-window")).toBeVisible();
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });

  await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Expand", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("voice-caption")).toBeVisible();
  // The call stays connecting until the orb is on screen: the provider's SDP answer is held until then.
  const releaseAnswer = voiceBroker.holdAnswer();
  await page.getByRole("button", { name: "Start voice in Dash", exact: true }).click({ noWaitAfter: true });
  const orb = page.getByTestId("voice-orb-overlay");
  await expect(orb, "full-screen Voice owns its hero, not the overlay").toHaveCount(0);
  await page.getByRole("button", { name: "Back to chat · call keeps going" }).click({ noWaitAfter: true });

  const focusPhase = page.getByTestId("voice-phase");
  const phases = ["Connecting", "Listening", "Hearing", "Thinking", "Speaking", "Listening"];
  // Record the bubble's accessible phase as it changes. Some scripted phases last under a second.
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.defineProperty(window, "__armyOrbPhases", { value: seen, configurable: true });
    const record = () => {
      const overlay = document.querySelector('[data-testid="voice-orb-overlay"]');
      if (!overlay) return;
      const entry = (overlay.getAttribute("aria-label") ?? "").replace("Open voice focus · ", "");
      if (seen[seen.length - 1] !== entry) seen.push(entry);
    };
    record();
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const recorded = () => page.evaluate(() => {
    const value: unknown = Reflect.get(window, "__armyOrbPhases");
    return Array.isArray(value) ? value.map(String) : [];
  });
  const shownInOrder = (seen: string[]) => {
    let next = 0;
    for (const entry of seen) {
      const want = phases[next];
      if (entry === want) next++;
    }
    return next;
  };
  await expect.poll(async () => shownInOrder(await recorded()), { timeout: 15000, message: "the orb shows Connecting while the call connects" }).toBeGreaterThanOrEqual(1);
  await expect(orb, "orb is on screen: connecting").toBeVisible();
  releaseAnswer();
  await expect.poll(async () => shownInOrder(await recorded()), { timeout: 20000, message: "the orb follows every voice phase in order" }).toBe(phases.length);
  await expect(orb, "orb is on screen: listening").toBeVisible();
  const drawing = await orb.getByTestId("agent-orb").boundingBox();
  expect(drawing?.width).toBe(52);

  await page.getByRole("tab").nth(1).click({ noWaitAfter: true });
  await page.getByRole("button", { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  await expect(page.getByRole("button", { name: "Chat options" })).toBeVisible();
  await page.getByRole("button", { name: /^Live call, .*\. Show voice orb$/ }).click({ noWaitAfter: true });
  await expect(page.getByTestId("voice-focus-back")).toBeVisible();
  await expect(orb).toHaveCount(0);
  await page.getByTestId("voice-mute").click();
  await expect(focusPhase).toHaveAttribute("aria-label", "Voice status: muted");
  await page.getByTestId("voice-mute").click();
  await expect(focusPhase).toHaveAttribute("aria-label", "Voice status: listening");
  await page.getByTestId("voice-focus-back").click();
  await expect(orb).toBeVisible();

  // The actual Chat options button sits outside the centered orb. This click must reach it.
  await page.getByRole("button", { name: "Chat options" }).click({ noWaitAfter: true });
  await expect(page.getByRole("button", { name: "Annotate this screen" })).toBeVisible();
  await page.getByRole("button", { name: "Annotate this screen" }).click({ noWaitAfter: true });
  await expect(page.getByLabel("Annotation mode on", { exact: true })).toBeVisible();
  await expect(orb).toHaveCount(0);
  await page.getByRole("button", { name: "Exit annotation" }).click({ noWaitAfter: true });
  await expect(orb).toBeVisible();
  await orb.click({ delay: 650 });
  await page.getByTestId("voice-bubble-menu").getByRole("button", { name: "End", exact: true }).click();
  await expect(orb).toHaveCount(0);
  await expect.poll(() => voiceBroker.calls().filter(call =>
    call.method === "POST" && /^\/v1\/sessions\/[^/]+\/end$/.test(call.path)).length).toBe(1);
});

test("Settings orb style survives reload and appears on chat and the active mic", async ({ page, bridge, voiceBroker }, info) => {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: "z0live", scope: "z0live:voice" });
  voiceBroker.authorize(z0live);
  await page.addInitScript((tokens: { dash: string; z0live: string }) => {
    Object.defineProperty(window, "__dashVoiceArmy", {
      value: { ...tokens, identity: { credentialId: "cred_armyorb0001" } }, configurable: true,
    });
  }, { dash, z0live });
  await pair(page, bridge);
  const settings = page.getByRole("button", { name: "Open settings", exact: true }).first();
  await settings.click({ noWaitAfter: true });
  const face = page.getByRole("radio", { name: "Bot face" });
  const rings = page.getByRole("radio", { name: "Thinking rings" });
  await expect(page.getByRole("radio", { name: "Thinking sphere" })).toBeChecked();
  await rings.click({ noWaitAfter: true });
  await expect(rings).toBeChecked();
  await expect(rings.locator("ellipse")).toHaveCount(3);
  await face.click({ noWaitAfter: true });
  await expect(face).toBeChecked();
  await page.screenshot({ path: info.outputPath("orb-style-picker.png") });
  const back = page.getByRole("button", { name: "Back", exact: true }).last();
  await back.click({ noWaitAfter: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  const chats = page.getByRole("tab").nth(1);
  await chats.click({ noWaitAfter: true });
  const hermes = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]')
    .filter({ hasText: "ARMY native fixture" });
  await expect(hermes).toHaveCount(1, { timeout: 30000 });
  await expect(hermes.getByTestId("orb-style-face")).toBeInViewport();
  await hermes.click({ noWaitAfter: true });
  const window = page.getByTestId("chat-window");
  await expect(window.getByTestId("orb-style-face").first()).toBeVisible();
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });

  await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Expand", exact: true }).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Start voice in Dash", exact: true }).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Back to chat · call keeps going" }).click({ noWaitAfter: true });
  await expect(page.getByTestId("voice-orb-overlay").getByTestId("orb-style-face")).toBeVisible();

  await chats.click({ noWaitAfter: true });
  await page.getByRole("button", { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  const mic = page.getByRole("button", { name: /^Live call, .*\. Show voice orb$/ });
  await expect(mic.getByTestId("moodie-body")).toBeVisible();
  await page.screenshot({ path: info.outputPath("orb-style-chat-mic.png") });
  await mic.click();
  await page.getByTestId("voice-end").click();
  await expect.poll(() => voiceBroker.calls().some(call =>
    call.method === "POST" && /^\/v1\/sessions\/[^/]+\/end$/.test(call.path))).toBe(true);
});
