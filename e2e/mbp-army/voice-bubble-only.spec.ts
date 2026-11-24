// DA-096: outside Voice focus the bubble is the only live-call surface; the legacy app-wide voice bar
// (its top band, caption strip and Mute/End row) is gone wherever the bubble shows. In focus the orb is
// large and approval and ephemeral-ui cards stack below it, in both card styles.
// Real Expo web export + real authenticated bridge + loopback z0live fixture broker + scripted web peer.
// Proves browser layout and state only, never Android audio, native WebRTC or a real model.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page, TestInfo } from "playwright/test";
import { expect, pair, send, test as base, type Bridge } from "./fixtures";
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from "./fixture-z0live-broker";

const test = base.extend<{ broker: FixtureZ0liveBroker }>({
  broker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ broker }, use) => {
    await use({ identity: true, generatedUI: true, env: {
      DASH_NATIVE_VOICE: "1", DASH_Z0LIVE_BROKER: broker.origin, DASH_ARMY_VOICE_WEB: "1",
      ARMY_PERSIST_SESSION: "1",
    } });
  },
});
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, persistSession: false });

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const dir = process.env.ARMY_VOICEBAR_RECEIPTS;
  if (dir) await mkdir(dir, { recursive: true });
  await page.screenshot({ path: dir ? join(dir, name + ".png") : info.outputPath(name + ".png"), animations: "disabled" });
}

/** Pair, open and close the Hermes chat so voice binds to it, and start a call from Voice focus. */
async function startCall(page: Page, bridge: Bridge, broker: FixtureZ0liveBroker, credentialId: string, style: "Dash" | "App" = "Dash") {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: "z0live", scope: "z0live:voice" });
  broker.authorize(z0live);
  await page.addInitScript((value: { dash: string; z0live: string; credentialId: string }) => {
    Object.defineProperty(window, "__dashVoiceArmy", { value: { dash: value.dash, z0live: value.z0live, identity: { credentialId: value.credentialId } } });
    Object.defineProperty(window, "__dashVoiceSay", { value: "ARMY voice hello" });
  }, { dash, z0live, credentialId });
  await pair(page, bridge);
  if (style === "App") {
    await page.getByRole("button", { name: "Open settings", exact: true }).first().click();
    await page.getByRole("radiogroup", { name: "Card style" }).getByRole("radio", { name: "App" }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
  }
  const chat = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]').filter({ hasText: "ARMY native fixture" });
  await expect(chat).toHaveCount(1, { timeout: 30000 });
  await chat.click();
  await expect(page.getByTestId("chat-window")).toBeVisible();
  await page.getByRole("button", { name: "Close chat window", exact: true }).click();
  await page.getByRole("tab").nth(0).click();
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  await page.getByRole("button", { name: "Start voice in Dash" }).click();
  await expect(page.getByTestId("voice-transcript")).toContainText("ARMY voice reply", { timeout: 20000 });
  await page.getByTestId("voice-focus-back").click();
  return chat;
}

/** Exactly one live-call surface: the 58 px bubble. No band, caption strip or bar controls. */
async function onlyTheBubble(page: Page): Promise<void> {
  const bubble = page.getByTestId("voice-orb-overlay");
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toBeVisible();
  await expect.poll(async () => (await bubble.boundingBox())?.width, "the bubble settles at 58 px").toBe(58);
  for (const legacy of ["voice-mic-bar", "voice-caption-strip", "voice-live-caption", "voice-phase", "voice-mute", "voice-end", "voice-captions-toggle"]) {
    await expect(page.getByTestId(legacy), `legacy voice bar part ${legacy}`).toHaveCount(0);
  }
  await expect(page.getByText("ARMY voice reply"), "no caption band over the app").toHaveCount(0);
}

test("Chats list with a live call shows only the voice bubble and no legacy voice bar", async ({ page, bridge, broker }, info) => {
  await startCall(page, bridge, broker, "cred_armybar0001");
  await onlyTheBubble(page);
  await page.getByRole("tab").nth(1).click();
  const pane = page.getByTestId("chats-pane");
  await expect(pane).toBeVisible();
  await onlyTheBubble(page);
  // The list is not pushed down by a reserved voice band: its first row stays put when the call ends.
  const rowTop = async () => (await pane.locator('[data-testid^="chat-row-"]').first().boundingBox())?.y ?? NaN;
  const live = await rowTop();
  await shot(page, info, "chats-bubble-only");
  const bubble = page.getByTestId("voice-orb-overlay");
  await bubble.click({ delay: 650 });
  await page.getByTestId("voice-bubble-menu").getByRole("button", { name: "End", exact: true }).click();
  await expect(bubble).toHaveCount(0);
  await expect.poll(() => broker.calls().filter(call => call.method === "POST" && /\/sessions\/[^/]+\/end$/.test(call.path)).length).toBe(1);
  await expect.poll(rowTop).toBe(live);
});

for (const style of ["Dash", "App"] as const) {
  test(`Voice focus shows the large orb with an approval card and a ${style} style Gmail card below it`, async ({ page, bridge, broker }, info) => {
    const chat = await startCall(page, bridge, broker, `cred_armyfoc${style === "Dash" ? "d" : "a"}01`, style);
    await page.getByRole("tab").nth(1).click();
    await chat.click();
    const window = page.getByTestId("chat-window");
    await expect(window).toBeVisible();
    await send(page, "ARMY_EPHEMERAL_INBOX");
    const surface = style === "Dash" ? "rgba(18, 20, 17, 0.82)" : "rgb(31, 31, 31)";
    await expect(window.frameLocator('iframe[title="gmail inbox card"]').locator('.eu-card[data-kind="inbox"]'))
      .toHaveCSS("background-color", surface, { timeout: 30000 });
    await send(page, "ARMY_PERMISSION voice approval");
    await expect(page.getByTestId("voice-orb-badge")).toHaveText("1");
    const bubble = page.getByTestId("voice-orb-overlay");
    await expect.poll(async () => (await bubble.boundingBox())?.width, "outside focus the orb is a 58 px bubble").toBe(58);
    await bubble.click();
    await expect(bubble, "focus owns the large orb; the bubble is gone").toHaveCount(0);
    const stack = page.getByTestId("voice-focus-cards");
    const approval = stack.getByTestId("voice-approval");
    await expect(approval).toContainText("Needs OK");
    const orb = page.getByTestId("voice-content").getByTestId("agent-orb");
    await expect.poll(async () => Math.round((await orb.boundingBox())?.width ?? 0)).toBe(188);
    const hero = await orb.boundingBox();
    const card = await approval.boundingBox();
    expect(hero && card && hero.y + hero.height < card.y, "approval card sits below the orb").toBe(true);
    const gmail = stack.frameLocator('iframe[title="gmail inbox card"]').locator('.eu-card[data-kind="inbox"]');
    await expect(gmail).toHaveCSS("background-color", surface);
    const frame = await stack.locator('iframe[title="gmail inbox card"]').boundingBox();
    expect(card && frame && card.y + card.height <= frame.y, "Gmail card sits below the approval").toBe(true);
    await shot(page, info, `focus-${style.toLowerCase()}`);
    await stack.getByTestId("voice-approval-allow").click();
    await expect(approval).toHaveCount(0);
    await page.getByTestId("voice-end").click();
    await expect.poll(() => broker.calls().filter(call => call.method === "POST" && /\/sessions\/[^/]+\/end$/.test(call.path)).length).toBe(1);
  });
}
