import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, openChat, composer, send } from "./fixtures";

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath("final.png") });
});

test("attached composer sends into the same ACP session after leaving Chat", async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, "ARMY_H108_FIRST");
  await expect(page.getByText("ARMY_REPLY: ARMY_H108_FIRST").first()).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer")).toBeVisible();
  await expect(page.getByTestId("attached-composer-target")).toContainText("OMP");

  await composer(page).fill("ARMY_H108_MAIN");
  await page.getByRole("button", { name: "Send", exact: true }).click({ noWaitAfter: true });
  // The fixture ACP peer receives this through the authenticated bridge, not an app debug seed.
  await expect.poll(async () => {
    const log = await readFile(join(bridge.dir, "army-acp-turns.jsonl"), "utf8").catch(() => "");
    return log.includes("ARMY_H108_FIRST") && log.includes("ARMY_H108_MAIN");
  }, { timeout: 20000 }).toBe(true);

  await page.getByRole("button", { name: "Open attached chat", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText("ARMY_REPLY: ARMY_H108_FIRST").first()).toBeVisible();
  await expect(page.getByText("ARMY_REPLY: ARMY_H108_MAIN").first()).toBeVisible({ timeout: 20000 });
});

test("attached composer keeps per-session draft across tab, search and reload", async ({ page, bridge }) => {
  await openChat(page, bridge);
  const draft = "ARMY_H108_UNSENT_SAME_SESSION";
  await composer(page).fill(draft);
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });

  await expect(page.getByTestId("attached-composer")).toBeVisible();
  await expect(composer(page)).toHaveValue(draft);
  await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer")).toBeVisible();
  await expect(composer(page)).toHaveValue(draft);

  await page.getByRole("button", { name: "Search chats and tools", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole("button", { name: "Return to attached session", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Return to attached session", exact: true }).click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue(draft);

  await expect.poll(() => page.evaluate(() => localStorage.getItem("dash.composerDrafts.v1"))).toContain(draft);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dash.activeId.v1"))).not.toBeNull();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("attached-composer")).toBeVisible({ timeout: 25000 });
  await expect(composer(page)).toHaveValue(draft);
});

test("attached composer switches only when a different chat is explicitly chosen", async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, "ARMY_H108_OMP_SCOPE");
  await expect(page.getByText("ARMY_REPLY: ARMY_H108_OMP_SCOPE").first()).toBeVisible({ timeout: 20000 });
  const reserved = "ARMY_H108_OMP_RESERVED_DRAFT";
  await composer(page).fill(reserved);
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer-target")).toContainText("OMP");
  await expect(composer(page)).toHaveValue(reserved);

  await page.getByRole("button", { name: "Open attached chat", exact: true }).click({ noWaitAfter: true });
  const options = page.getByRole("button", { name: "Options. Current surface: Chat", exact: true });
  await options.click({ noWaitAfter: true });
  await page.getByRole("button", { name: /^Harness,/ }).click({ noWaitAfter: true });
  await page.getByRole("button", { name: /Hermes/ }).last().click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue("");
  await send(page, "ARMY_H108_HERMES_SCOPE");
  await expect(page.getByText("ARMY_REPLY: ARMY_H108_HERMES_SCOPE").first()).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer-target")).toContainText("Hermes");

  // The old OMP row, not the app's default harness, determines the next attachment.
  const oldRow = page.getByTestId("chats-pane").locator('[data-testid^="chat-row-"]').filter({ hasText: "ARMY_H108_OMP_SCOPE" });
  await expect(oldRow).toHaveCount(1, { timeout: 20000 });
  await oldRow.click({ noWaitAfter: true });
  await expect(page.getByText("ARMY_REPLY: ARMY_H108_OMP_SCOPE").first()).toBeVisible();
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-composer-target")).toContainText("OMP");
  await expect(composer(page)).toHaveValue(reserved);
});
