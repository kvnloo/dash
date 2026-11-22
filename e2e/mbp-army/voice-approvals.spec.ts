// DA-058: approvals during a z0live call. A pending Needs OK or sudo request takes the live caption
// line; saying "allow once" or tapping it resolves it, and sudo opens the #670 entry over the call.
// Real Expo web app + real authenticated bridge + fixture ACP agent + loopback z0live fixture broker
// + scripted web peer. Proves browser state and the bridge side effects only, never Android audio,
// native WebRTC, a real model or real sudo (a fake `sudo` first on the bridge's PATH checks the line).
import { test as base, expect, pair, send, composer, type Bridge } from "./fixtures";
import { startFixtureZ0liveBroker, type FixtureZ0liveBroker } from "./fixture-z0live-broker";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright/test";

const test = base.extend<{ voiceBroker: FixtureZ0liveBroker }>({
  voiceBroker: async ({}, use) => {
    const broker = await startFixtureZ0liveBroker();
    try { await use(broker); } finally { await broker.stop(); }
  },
  bridgeOptions: async ({ voiceBroker }, use) => {
    await use({ identity: true, env: { DASH_NATIVE_VOICE: "1", DASH_Z0LIVE_BROKER: voiceBroker.origin, DASH_ARMY_VOICE_WEB: "1" } });
  },
});

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath("final.png") });
});

const PASSWORD = "army pw-7!x";
const selected = async (bridge: Bridge) => (await readFile(join(bridge.dir, "army-acp-permissions.jsonl"), "utf8").catch(() => ""))
  .split("\n").filter(line => line.includes('"optionId":"army-allow-once"')).length;
const asks = (broker: FixtureZ0liveBroker) => broker.calls().filter(call => call.method === "POST" && call.path === "/v1/tools/ask_z0");
const ends = (broker: FixtureZ0liveBroker) => broker.calls().filter(call => call.method === "POST" && /^\/v1\/sessions\/[^/]+\/end$/.test(call.path));

/** Tokens and the scripted utterance for the web peer, then pair and wait for the attached Hermes chat. */
async function pairForVoice(page: Page, bridge: Bridge, broker: FixtureZ0liveBroker, say: string): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  const dash = bridge.identityToken();
  const z0live = bridge.identityToken({ aud: "z0live", scope: "z0live:voice" });
  broker.authorize(z0live);
  await page.addInitScript((settings: { dash: string; z0live: string; say: string }) => {
    Object.defineProperty(window, "__dashVoiceArmy", { value: { dash: settings.dash, z0live: settings.z0live, identity: { credentialId: "cred_armyapprove1" } }, configurable: true });
    Object.defineProperty(window, "__dashVoiceSay", { value: settings.say, configurable: true });
  }, { dash, z0live, say });
  await pair(page, bridge);
  const hermes = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]').filter({ hasText: "ARMY native fixture" });
  await expect(hermes).toHaveCount(1, { timeout: 30000 });
  // Opening the Hermes chat once makes it the attached voice target, as in voice.spec.ts.
  await hermes.click({ noWaitAfter: true });
  await expect(page.getByTestId("chat-window")).toBeVisible();
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
}
/** Start the call from full-screen Voice through the normal Main UI. */
async function startCall(page: Page): Promise<void> {
  await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Expand", exact: true }).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Start voice in Dash", exact: true }).click({ noWaitAfter: true });
}
async function permissionInNewChat(page: Page): Promise<void> {
  await page.getByRole("tab").nth(1).click({ noWaitAfter: true });
  await page.getByRole("button", { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  await expect(composer(page)).toBeVisible();
  await send(page, "ARMY_PERMISSION voice approval");
  await expect(page.getByTestId("permission-choice-army-allow-once")).toBeVisible({ timeout: 15000 });
}

test("saying allow once during a live call resolves the pending Needs OK in the caption line without asking the agent", async ({ page, bridge, voiceBroker }, info) => {
  await pairForVoice(page, bridge, voiceBroker, "allow once");
  await permissionInNewChat(page);
  // The scripted peer speaks once the provider answer arrives; hold it until the request is on screen.
  const releaseAnswer = voiceBroker.holdAnswer();
  await startCall(page);
  const approval = page.getByTestId("voice-approval");
  await expect(approval, "full-screen Voice shows the request in the live caption line").toContainText("Needs OK");
  await expect(page.getByTestId("voice-approval-allow")).toBeVisible();
  await page.screenshot({ path: info.outputPath("needs-ok-on-voice.png") });
  releaseAnswer();

  await expect.poll(() => selected(bridge), { timeout: 20000, message: "the agent received allow_once" }).toBe(1);
  await expect(approval).toHaveCount(0);
  await expect(page.getByTestId("voice-transcript")).toContainText("allow once");
  await expect(page.getByTestId("voice-transcript")).toContainText("Allowed once");
  await expect(page.getByTestId("voice-phase")).toHaveAttribute("aria-label", "Voice status: listening");
  expect(asks(voiceBroker), "an approval command is never dispatched to the agent as a request").toHaveLength(0);
  expect(ends(voiceBroker), "the call kept going").toHaveLength(0);
  await page.getByRole("button", { name: "Back to chat · call keeps going" }).click({ noWaitAfter: true });
  await expect(page.getByText(/ARMY_PERMISSION_SELECTED/).first()).toBeVisible({ timeout: 15000 });
  await page.getByTestId("voice-end").click({ noWaitAfter: true });
  await expect.poll(() => ends(voiceBroker).length).toBe(1);
});

test("tapping Allow once in the live caption line resolves a Needs OK that arrives during the call", async ({ page, bridge, voiceBroker }, info) => {
  await pairForVoice(page, bridge, voiceBroker, "ARMY voice hello");
  await startCall(page);
  await page.getByRole("button", { name: "Back to chat · call keeps going" }).click({ noWaitAfter: true });
  await expect(page.getByTestId("voice-live-caption")).toHaveText("Dash · ARMY voice reply", { timeout: 20000 });
  await permissionInNewChat(page);

  const approval = page.getByTestId("voice-approval");
  await expect(approval).toContainText("Needs OK");
  await expect(page.getByTestId("voice-live-caption"), "the request takes the caption line").toHaveCount(0);
  const box = await page.getByTestId("voice-caption-strip").boundingBox();
  expect(box?.height, "still one short line").toBeLessThanOrEqual(40);
  await page.screenshot({ path: info.outputPath("needs-ok-strip.png") });
  await page.getByTestId("voice-approval-allow").click({ noWaitAfter: true });
  await expect.poll(() => selected(bridge), { timeout: 15000, message: "the agent received allow_once" }).toBe(1);
  await expect(approval).toHaveCount(0);
  await expect(page.getByText(/ARMY_PERMISSION_SELECTED/).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("voice-live-caption")).toHaveText("Dash · ARMY voice reply");
  await expect(page.getByTestId("voice-phase")).toHaveAttribute("aria-label", /^Voice status: (listening|hearing|thinking|speaking)/);
  expect(asks(voiceBroker)).toHaveLength(1);
  expect(ends(voiceBroker)).toHaveLength(0);
  await page.getByTestId("voice-end").click({ noWaitAfter: true });
});

async function fakeSudo(bridge: Bridge) {
  await writeFile(join(bridge.dir, "bin", "sudo"), [
    "#!/bin/sh",
    'if [ "$1" = -k ] && [ "$2" = -n ] && [ "$3" = -l ]; then echo "sudo: a password is required" >&2; exit 1; fi',
    '[ "$1" = -k ] && [ "$2" = -S ] && [ "$3" = -p ] && [ "$4" = "" ] && [ "$5" = -- ] || { echo "army-sudo: bad flags" >&2; exit 90; }',
    "shift 5",
    "IFS= read -r pw",
    `[ "$pw" = '${PASSWORD}' ] || { echo "Sorry, try again." >&2; exit 1; }`,
    'echo ran > "$HOME/army-sudo-ran"',
    'exec "$@"',
  ].join("\n") + "\n", { mode: 0o700 });
}
/** What `dash-sudo` does on the host: ask the bridge's loopback /secret/sudo with the bridge token. */
async function askSudo(bridge: Bridge, argv: string[]) {
  const port = /notices\s+http:\/\/127\.0\.0\.1:(\d+)\/notice/.exec(bridge.logs())?.[1];
  if (!port) throw Error("bridge printed no loopback listener");
  const token = (await readFile(join(bridge.dir, ".dash", "token"), "utf8")).trim();
  return fetch(`http://127.0.0.1:${port}/secret/sudo`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ argv, cwd: bridge.dir, reason: "army voice sudo journey" }),
  }).then(async r => ({ status: r.status, body: await r.json() as { outcome: string; exitCode: number | null; stdout: string } }));
}

test("a sudo request during a live call waits in the caption line and opens the sealed entry without leaving voice", async ({ page, bridge, voiceBroker }, info) => {
  await pairForVoice(page, bridge, voiceBroker, "ARMY voice hello");
  await fakeSudo(bridge);
  await startCall(page);
  await page.getByRole("button", { name: "Back to chat · call keeps going" }).click({ noWaitAfter: true });
  await expect(page.getByTestId("voice-live-caption")).toHaveText("Dash · ARMY voice reply", { timeout: 20000 });

  const answer = askSudo(bridge, ["echo", "army-sudo-ran"]);
  const approval = page.getByTestId("voice-approval");
  await expect(approval).toContainText("sudo · $ sudo echo army-sudo-ran");
  await expect(page.getByTestId("secret-entry"), "the entry does not cover the call by itself").toHaveCount(0);
  await page.screenshot({ path: info.outputPath("sudo-strip.png") });
  await page.getByTestId("voice-approval-sudo").click({ noWaitAfter: true });

  const entry = page.getByTestId("secret-entry");
  await expect(entry).toBeVisible();
  await expect(page.getByTestId("secret-command")).toHaveText("$ sudo echo army-sudo-ran");
  await expect(page.getByTestId("voice-phase"), "the call is still live under the entry")
    .toHaveAttribute("aria-label", /^Voice status: (listening|hearing|thinking|speaking)/);
  await page.getByTestId("secret-dots").click();
  await page.keyboard.type(PASSWORD);
  await expect(page.getByTestId("secret-dots")).toHaveText("•".repeat(PASSWORD.length));
  await page.screenshot({ path: info.outputPath("sudo-entry-over-call.png") });
  await page.getByRole("button", { name: "Run with sudo", exact: true }).click({ noWaitAfter: true });

  const result = await answer;
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ outcome: "delivered", exitCode: 0, stdout: "army-sudo-ran\n" });
  await access(join(bridge.dir, "army-sudo-ran"));
  await expect(entry).toHaveCount(0);
  await expect(approval).toHaveCount(0);
  await expect(page.getByTestId("voice-phase")).toHaveAttribute("aria-label", /^Voice status: (listening|hearing|thinking|speaking)/);
  expect(ends(voiceBroker), "the call never ended for sudo").toHaveLength(0);
  expect(bridge.logs()).not.toContain(PASSWORD);
  await page.getByTestId("voice-end").click({ noWaitAfter: true });
  await expect.poll(() => ends(voiceBroker).length).toBe(1);
});
