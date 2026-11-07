import { test, expect, openChat, composer, send } from "./fixtures";

test("DeX simulation shows TV and Pad and Touchpad returns to TV", async ({ page, bridge }) => {
  await page.setViewportSize({ width: 1200, height: 780 });
  await openChat(page, bridge);
  await expect(page.getByTestId("dex-tv")).toHaveCount(0);
  await expect(page.getByTestId("dex-pad")).toHaveCount(0);
  await expect.poll(() => page.evaluate("typeof window.__dashDex?.simulate")).toBe("function");
  await page.evaluate("window.__dashDex?.simulate({ mode: 'dual', tv: { w: 1920, h: 1080 } })");
  await expect(page.getByTestId("dex-tv")).toBeVisible();
  await expect(page.getByTestId("dex-tv")).toContainText("1920 × 1080");
  await expect(page.getByTestId("dex-pad")).toBeVisible();
  const tv = await page.getByTestId("dex-tv").boundingBox();
  const pad = await page.getByTestId("dex-pad").boundingBox();
  expect(tv).not.toBeNull(); expect(pad).not.toBeNull();
  expect(pad!.x).toBeGreaterThanOrEqual(tv!.x + tv!.width);
  await page.screenshot({ path: test.info().outputPath("tv-and-pad.png") });
  await page.getByRole("button", { name: "Touchpad", exact: true }).click();
  await expect(page.getByTestId("dex-pad")).toHaveCount(0);
  await expect(page.getByTestId("dex-tv")).toBeVisible();
  await page.evaluate("window.__dashDex?.simulate({ mode: 'off' })");
  await expect(page.getByTestId("dex-tv")).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
  await send(page, "after DeX simulation");
  await expect(page.getByText(/ARMY_REPLY: after DeX simulation/).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("final.png") });
});
