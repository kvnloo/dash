import { test, expect, openChat, composer, send } from "./fixtures";

test("DeX simulation shows TV and Pad and Touchpad returns to TV", async ({ page, bridge }) => {
  await page.setViewportSize({ width: 1200, height: 780 });
  await openChat(page, bridge);
  await expect(page.getByTestId("dex-tv")).toHaveCount(0);
  await expect(page.getByTestId("dex-pad")).toHaveCount(0);
  // The DeX-sized window shows the wide desk layout: left rail, Chats column, side panels.
  const wide = async () => {
    await expect(page.getByTestId("desk-shell")).toBeVisible();
    await expect(page.getByTestId("desk-rail").getByRole("tab")).toHaveCount(9);
    await expect(page.getByTestId("desk-panel-chats")).toBeVisible();
    await expect(page.getByTestId("desk-panel-needs")).toBeVisible();
    const rail = await page.getByTestId("desk-rail").boundingBox();
    const chats = await page.getByTestId("desk-panel-chats").boundingBox();
    const center = await page.getByTestId("desk-center").boundingBox();
    const needs = await page.getByTestId("desk-panel-needs").boundingBox();
    if (!rail || !chats || !center || !needs) throw Error("desk columns have no layout");
    expect(rail.x + rail.width).toBeLessThanOrEqual(chats.x + 1);
    expect(chats.x + chats.width).toBeLessThanOrEqual(center.x + 1);
    expect(center.x + center.width).toBeLessThanOrEqual(needs.x + 1);
  };
  await wide();
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
  await wide();
  await send(page, "after DeX simulation");
  await expect(page.getByText(/ARMY_REPLY: after DeX simulation/).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("final.png") });
});
