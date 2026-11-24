import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator } from "playwright/test";
import { composer, expect, pair, send, test as base } from "./fixtures";
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

async function disjoint(orb: Locator, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const bubble = await orb.boundingBox();
  const box = await target.boundingBox();
  if (!bubble || !box) throw Error("Expected both controls to have a rect");
  expect(bubble.x + bubble.width <= box.x || box.x + box.width <= bubble.x ||
    bubble.y + bubble.height <= box.y || box.y + box.height <= bubble.y).toBe(true);
}

test("voice bubble docks clear of chat controls and opens focus to resolve a pending approval", async ({ page, bridge, broker }, info) => {
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: "z0live", scope: "z0live:voice" });
  broker.authorize(z0live);
  await page.addInitScript(tokens => {
    Object.defineProperty(window, "__dashVoiceArmy", { value: { ...tokens, identity: { credentialId: "cred_armyfocus1" } } });
    Object.defineProperty(window, "__dashVoiceSay", { value: "ARMY voice hello" });
  }, { dash, z0live });
  const shot = async (name: string) => {
    const dir = process.env.ARMY_ORB_RECEIPTS;
    if (dir) await mkdir(dir, { recursive: true });
    await page.screenshot({ path: dir ? join(dir, name + ".png") : info.outputPath(name + ".png"), animations: "disabled" });
  };
  await pair(page, bridge);
  const chat = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]').filter({ hasText: "ARMY native fixture" });
  await expect(chat).toHaveCount(1, { timeout: 30000 });
  await chat.click();
  await expect(page.getByTestId("chat-window")).toBeVisible();
  await page.getByRole("button", { name: "Close chat window", exact: true }).click();
  const tabs = page.getByRole("tab");
  await tabs.nth(0).click();
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  await page.getByRole("button", { name: "Start voice in Dash" }).click();
  await expect(page.getByTestId("voice-transcript")).toContainText("ARMY voice reply", { timeout: 20000 });
  await page.getByTestId("voice-focus-back").click();
  const bubble = page.getByTestId("voice-orb-overlay");
  await expect(bubble).toBeVisible();
  await disjoint(bubble, page.getByTestId("attached-composer"));
  await shot("bubble-main");
  await tabs.nth(1).click();
  await expect(page.getByTestId("chats-pane")).toBeVisible();
  expect((await bubble.boundingBox())?.width).toBe(58);
  await disjoint(bubble, page.getByTestId("attached-composer"));
  await expect(page.getByTestId("voice-mic-bar")).toHaveCount(0);
  await expect(page.getByTestId("voice-live-caption"), "the bubble is the only call surface on Chats").toHaveCount(0);
  await shot("bubble-chats");
  await chat.click();
  await expect(page.getByTestId("chat-window")).toBeVisible();
  await disjoint(bubble, composer(page));
  await disjoint(bubble, page.getByTestId("composer-field"));
  await disjoint(bubble, page.getByTestId("composer-model-harness-controls"));
  await expect(page.getByTestId("window-voice-controls")).toHaveCount(0);
  await shot("bubble-chat");
  await send(page, "ARMY_EPHEMERAL_INBOX");
  await expect(page.frameLocator('iframe[title="gmail inbox card"]').locator('.eu-card[data-kind="inbox"]')).toBeVisible({ timeout: 30000 });
  await send(page, "ARMY_PERMISSION voice approval");
  const allow = page.getByTestId("permission-choice-army-allow-once");
  await disjoint(bubble, allow);
  await disjoint(bubble, page.getByTestId("permission-choice-army-reject-once"));
  await expect(page.getByTestId("voice-orb-badge")).toHaveText("1");
  const peek = page.getByTestId("voice-orb-peek");
  await expect(peek).toContainText("Needs OK");
  await disjoint(peek, page.getByTestId("chat-window-pill"));
  await disjoint(peek, page.getByRole("button", { name: "Close chat window", exact: true }));
  await disjoint(peek, allow);
  await disjoint(peek, page.getByTestId("permission-choice-army-reject-once"));
  await expect(page.getByTestId("voice-approval")).toHaveCount(0);
  await shot("bubble-pending");
  await expect(page.getByTestId("voice-orb-peek")).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByTestId("voice-orb-badge")).toHaveText("1");
  await bubble.click();
  await expect(bubble).toHaveCount(0);
  const stack = page.getByTestId("voice-focus-cards");
  await expect(stack.getByTestId("voice-approval")).toContainText("Needs OK");
  const gmail = stack.frameLocator('iframe[title="gmail inbox card"]');
  await expect(gmail.locator('.eu-card[data-kind="inbox"]')).toHaveCSS("background-color", "rgba(18, 20, 17, 0.82)");
  const controls = page.getByTestId("voice-focus-controls");
  await disjoint(page.getByTestId("voice-content"), controls);
  const orb = page.getByTestId("voice-content").getByTestId("agent-orb");
  await expect.poll(async () => Math.round((await orb.boundingBox())?.width ?? 0)).toBe(188);
  const hero = await orb.boundingBox();
  const approval = await stack.getByTestId("voice-approval").boundingBox();
  expect(hero && approval && hero.y + hero.height < approval.y).toBe(true);
  await shot("focus-pending");
  const openGmail = gmail.getByRole("button", { name: "Open in Gmail" });
  await openGmail.scrollIntoViewIfNeeded();
  await expect(openGmail).toBeInViewport();
  await disjoint(openGmail, controls);
  await shot("focus-card-scrolled");
  await stack.getByTestId("voice-approval-allow").click();
  await expect(stack.getByTestId("voice-approval")).toHaveCount(0);
  await expect.poll(async () => (await readFile(join(bridge.dir, "army-acp-permissions.jsonl"), "utf8").catch(() => ""))
    .includes('"optionId":"army-allow-once"')).toBe(true);
  await shot("focus-allowed");
  await page.getByTestId("voice-focus-back").click();
  await expect(bubble).toHaveAttribute("aria-label", /Open voice focus · (Listening|Speaking|Thinking|Hearing)/);
  await expect(page.getByTestId("voice-orb-badge")).toHaveCount(0);
  await expect(page.getByText("Allowed · confirmed by host", { exact: true })).toBeVisible();
  await expect.poll(() => bubble.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.width === 58 && element.contains(hit);
  })).toBe(true);
  await bubble.hover();
  const right = await bubble.boundingBox();
  if (!right) throw Error("Missing bubble before drag");
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
  await page.mouse.down();
  await page.mouse.move(34, right.y + right.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await bubble.boundingBox())?.x).toBeLessThan(40);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dash.voice.bubble-edge"))).toBe("left");
  await bubble.click();
  await page.getByTestId("voice-focus-back").click();
  await expect.poll(async () => (await bubble.boundingBox())?.x).toBeLessThan(40);
  await bubble.click({ delay: 650 });
  const menu = page.getByTestId("voice-bubble-menu");
  await menu.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(bubble).toHaveAttribute("aria-label", /Muted/);
  await bubble.click({ delay: 650 });
  await menu.getByRole("button", { name: "End", exact: true }).click();
  await expect(bubble).toHaveCount(0);
  await expect.poll(() => broker.calls().filter(call => call.method === "POST" && /\/sessions\/[^/]+\/end$/.test(call.path)).length).toBe(1);
});
