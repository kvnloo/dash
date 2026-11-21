// #507: the main bar stays attached to the chat's agent and offers a small on-demand popup with the
// last message or two. Collapsed by default, so Main keeps no standing copy of the transcript.
import { test, expect, openChat, composer, send } from "./fixtures";

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath("final.png") });
});

test("attached composer pops up the last exchange on demand and opens the chat from it", async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge);
  await send(page, "ARMY_LAST_EXCHANGE question");
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_LAST_EXCHANGE question").first()).toBeVisible({ timeout: 20000 });
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });

  const attached = page.getByTestId("attached-composer");
  await expect(attached).toBeVisible();
  await expect(attached.getByText(/ARMY_REPLY:/), "collapsed by default: no standing transcript copy").toHaveCount(0);
  const toggle = page.getByRole("button", { name: "Show last messages", exact: true });
  await toggle.click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-last-you")).toHaveText("You: ARMY_LAST_EXCHANGE question");
  await expect(page.getByTestId("attached-last-agent")).toContainText("ARMY_REPLY: ARMY_LAST_EXCHANGE question");
  await expect(page.getByTestId("attached-last-agent")).toContainText(/^OMP: /);
  await page.screenshot({ path: info.outputPath("last-exchange.png") });
  await page.getByRole("button", { name: "Hide last messages", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-last-exchange")).toHaveCount(0);

  // Sending from Main collapses it; reopening shows the newest exchange.
  await page.getByRole("button", { name: "Show last messages", exact: true }).click({ noWaitAfter: true });
  await composer(page).fill("ARMY_LAST_EXCHANGE follow-up");
  await page.getByRole("button", { name: "Send", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-last-exchange")).toHaveCount(0);
  await page.getByRole("button", { name: "Show last messages", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("attached-last-agent")).toContainText("ARMY_REPLY: ARMY_LAST_EXCHANGE follow-up", { timeout: 20000 });
  await page.getByTestId("attached-last-exchange").click({ noWaitAfter: true });
  await expect(page.getByTestId("transcript-viewport").getByText("ARMY_REPLY: ARMY_LAST_EXCHANGE follow-up").first()).toBeVisible();
});
