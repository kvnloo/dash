import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, openChat, chatRow, composer, send } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 } });

test("composer harness chooser is attached to the input and never sends a turn", async ({ page, bridge }) => {
  await openChat(page, bridge);
  const draft = "A draft stays while the harness chooser opens";
  await composer(page).fill(draft);
  const chooser = page.getByTestId("composer-harness-button");
  await expect(chooser).toBeVisible();
  await chooser.click({ noWaitAfter: true });
  const close = page.getByRole("button", { name: "Close harness picker" });
  await expect(close).toBeVisible();
  await close.click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue(draft);
  await chooser.click({ noWaitAfter: true });
  await page.getByRole("button", { name: /^Hermes/ }).last().click({ noWaitAfter: true });
  await expect(page.getByTestId("composer-harness-button")).toContainText(/hermes/i);
  expect(bridge.logs()).not.toContain("turn.start");
});

test("composer model edit applies ACP set_model before prompting and rejects unsupported models", async ({ page, bridge }) => {
  await openChat(page, bridge);
  const editModel = page.getByTestId("composer-model-button");
  await editModel.click({ noWaitAfter: true });
  const input = page.getByTestId("composer-model-input");
  await input.fill("invalid model");
  await expect(page.getByRole("button", { name: "Apply model" })).toBeDisabled();
  await input.fill("army/custom-model");
  await page.getByRole("button", { name: "Apply model" }).click({ noWaitAfter: true });
  await expect(editModel).toContainText("Requested · army/custom-model");

  await send(page, "ARMY_H120 selected model");
  await expect(page.getByText(/ARMY_REPLY: ARMY_H120 selected model/)).toBeVisible({ timeout: 15000 });
  const path = join(bridge.dir, "army-acp-calls.jsonl");
  await expect.poll(async () => (await readFile(path, "utf8")).includes('"modelId":"army/custom-model"')).toBe(true);
  const calls = (await readFile(path, "utf8")).trim().split("\n");
  const setModel = calls.findIndex(line => line.includes('"method":"session/set_model"') && line.includes('"modelId":"army/custom-model"'));
  const prompted = calls.findIndex(line => line.includes('"method":"session/prompt"'));
  expect(setModel).toBeGreaterThan(-1);
  expect(prompted).toBeGreaterThan(setModel);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("tab").nth(1).click({ noWaitAfter: true });
  await chatRow(page).click({ noWaitAfter: true });
  await expect(page.getByTestId("composer-model-button")).toContainText("army/custom-model");
  await page.getByTestId("composer-model-button").click({ noWaitAfter: true });
  await page.getByTestId("composer-model-input").fill("army-unsupported");
  await page.getByRole("button", { name: "Apply model" }).click({ noWaitAfter: true });
  await send(page, "ARMY_H120 must not run unsupported model");
  await expect(page.getByText(/harness did not accept the selected model/i)).toBeVisible({ timeout: 15000 });
  const after = (await readFile(path, "utf8")).trim().split("\n");
  expect(after.filter(line => line.includes('"method":"session/prompt"'))).toHaveLength(
    calls.filter(line => line.includes('"method":"session/prompt"')).length,
  );
  expect(after.some(line => line.includes('"method":"session/set_model"') && line.includes('"modelId":"army-unsupported"'))).toBe(true);
});

test("composer shows only estimated live token speed and expires after the turn", async ({ page, bridge }) => {
  await openChat(page, bridge);
  await expect(page.getByTestId("composer-stat-rate")).toHaveCount(0);
  await send(page, "ARMY_RATE_STREAM honest samples");
  const rate = page.getByTestId("composer-stat-rate");
  await expect(rate).toContainText(/≈\d+(?:\.\d+)? tok\/s/, { timeout: 12000 });
  await expect(rate).not.toContainText(/^\d+(?:\.\d+)? tok\/s$/);
  await expect(page.getByText(/ARMY_REPLY: ARMY_RATE_STREAM honest samples/)).toBeVisible({ timeout: 15000 });
  // The finished rate is retained only for five seconds, then the chip disappears.
  await expect(rate).toHaveCount(0, { timeout: 9000 });
});
