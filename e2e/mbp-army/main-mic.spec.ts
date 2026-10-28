import { test, expect, pair, openChat } from "./fixtures";

// C01 owns BridgeOptions.env; C03 supplies the model-free, deterministic STT engine.
const fixtureOptions = { pm: false, env: { DASH_STT_ENGINE: "fixture" } };
test.use({
  bridgeOptions: fixtureOptions,
  launchOptions: {
    args: [
      "--disable-dev-shm-usage",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("main mic tap then tap inserts the real bridge STT fixture transcript", async ({ page, bridge, errors }) => {
  await pair(page, bridge);
  const field = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(field).toBeVisible();
  await page.getByRole("button", { name: "Dictate", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText("Listening · tap Stop when finished", { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Stop dictation", exact: true }).click({ noWaitAfter: true });
  await expect(field).toHaveValue("ARMY heard you", { timeout: 20000 });
  expect(errors.filter(error => error.startsWith("PAGEERROR"))).toEqual([]);
});

test("main mic hold and slide up opens Voice and attempts Live autostart", async ({ page, bridge, errors }) => {
  await pair(page, bridge);
  const mic = page.getByRole("button", { name: "Dictate", exact: true });
  const box = await mic.boundingBox();
  if (!box) throw Error("Main mic has no hit target");
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(300); // The production MicButton activates its picker after 220 ms.
  await page.mouse.move(x, y - 72, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByText("Dash voice", { exact: true })).toBeVisible();
  // A paired army bridge has no owner identity/live broker. Autostart must reach a visible
  // readiness failure, not leave the idle "Realtime voice inside Dash" caption untouched.
  await expect(page.getByTestId("voice-caption")).toContainText(
    /Pair Dash with z0bridge identity|Open a Hermes chat once|Microphone in use|Bridge lacks native voice|Voice bootstrap failed|Native voice disabled|Voice target not confirmed/i,
    { timeout: 20000 },
  );
  expect(errors.filter(error => error.startsWith("PAGEERROR"))).toEqual([]);
});

test("chat composer mic still dictates through the real bridge fixture", async ({ page, bridge, errors }) => {
  await openChat(page, bridge);
  const field = page.getByTestId("composer-field").getByRole("textbox", { name: "Message", exact: true });
  const controls = page.getByTestId("composer-controls");
  await controls.getByRole("button", { name: "Dictate", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText("Listening · tap Stop when finished", { exact: true })).toBeVisible({ timeout: 20000 });
  await controls.getByRole("button", { name: "Stop dictation", exact: true }).click({ noWaitAfter: true });
  await expect(field).toHaveValue("ARMY heard you", { timeout: 20000 });
  expect(errors.filter(error => error.startsWith("PAGEERROR"))).toEqual([]);
});
