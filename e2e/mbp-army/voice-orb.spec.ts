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
      },
    });
  },
});

test("live hero orb follows each voice phase, mutes, passes through and hides for annotation", async ({ page, bridge, voiceBroker }) => {
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
  await page.getByRole("button", { name: "Start voice in Dash", exact: true }).click({ noWaitAfter: true });
  const orb = page.getByTestId("voice-orb-overlay");
  await expect(orb, "full-screen Voice owns its hero, not the overlay").toHaveCount(0);
  await page.getByRole("button", { name: "Back to chat · call keeps going" }).click({ noWaitAfter: true });

  const pill = page.getByTestId("voice-phase");
  const caption = page.getByTestId("voice-orb-caption");
  const phases = [
    ["connecting", "Connecting"], ["listening", "Listening"], ["hearing", "Hearing"],
    ["thinking", "Thinking"], ["speaking", "Speaking"], ["listening", "Listening"],
  ];
  for (const [phase, label] of phases) {
    await expect(pill, "real voice pill: " + phase).toHaveAttribute("aria-label", "Voice status: " + phase, { timeout: 15000 });
    await expect(orb, "orb follows pill within 300 ms: " + phase).toBeVisible({ timeout: 300 });
    await expect(caption, "orb caption follows pill within 300 ms: " + phase).toHaveText(label, { timeout: 300 });
  }
  const drawing = await orb.getByTestId("agent-orb").boundingBox();
  expect(drawing?.width).toBeGreaterThanOrEqual(220);

  await page.getByRole("tab").nth(1).click({ noWaitAfter: true });
  await page.getByRole("button", { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  await expect(page.getByRole("button", { name: "Chat options" })).toBeVisible();
  await page.getByRole("button", { name: /^Live call, .*\. Show voice orb$/ }).click({ noWaitAfter: true });
  await expect(orb).toHaveCSS("border-color", "rgb(236, 232, 223)", { timeout: 300 });

  await orb.click({ noWaitAfter: true });
  await expect(orb).toHaveAttribute("aria-label", /Unmute voice/, { timeout: 300 });
  await expect(pill).toHaveAttribute("aria-label", "Voice status: muted");
  await orb.click({ noWaitAfter: true });
  await expect(pill).toHaveAttribute("aria-label", "Voice status: listening");

  // The actual Chat options button sits outside the centered orb. This click must reach it.
  await page.getByRole("button", { name: "Chat options" }).click({ noWaitAfter: true });
  await expect(page.getByRole("button", { name: "Annotate this screen" })).toBeVisible();
  await page.getByRole("button", { name: "Annotate this screen" }).click({ noWaitAfter: true });
  await expect(page.getByTestId("annotation-overlay")).toBeVisible();
  await expect(orb).toHaveCount(0);
  await page.getByRole("button", { name: "Exit annotation" }).click({ noWaitAfter: true });
  await expect(orb).toBeVisible();
  await page.getByTestId("voice-end").click({ noWaitAfter: true });
  await expect(orb).toHaveCount(0);
  await expect.poll(() => voiceBroker.calls().filter(call =>
    call.method === "POST" && /^\/v1\/sessions\/[^/]+\/end$/.test(call.path)).length).toBe(1);
});
