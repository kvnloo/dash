// Real web app -> authenticated bridge -> deterministic fixture ACP agent.
import { test, expect, openChat, send, web } from "./fixtures";

function watchNetwork(page: import("playwright/test").Page, bridgePort: number): string[] {
  const outside: string[] = [];
  const allowed = new Set([new URL(web).host, "127.0.0.1:" + bridgePort]);
  page.on("request", request => {
    const url = new URL(request.url());
    if (["http:", "https:", "ws:", "wss:"].includes(url.protocol) && !allowed.has(url.host)) outside.push(url.origin);
  });
  return outside;
}

async function openSelfCheck(page: import("playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Close chat window", exact: true }).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Bridge details", exact: true }).first().click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Edit bridge", exact: true }).click({ noWaitAfter: true });
  await page.getByRole("button", { name: "Device self-check", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId("device-check-report")).toBeVisible();
}

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath("final.png") });
});

test("device self-check reports Skia, missing native modules and bridge model reason without external hosts", async ({ page, bridge }) => {
  const outside = watchNetwork(page, bridge.port);
  await openChat(page, bridge);
  await send(page, "ARMY_DEVICE_CHECK real fixture turn");
  await expect(page.getByText(/ARMY_REPLY: ARMY_DEVICE_CHECK/).first()).toBeVisible();
  await openSelfCheck(page);
  const report = page.getByTestId("device-check-report");
  await expect(report).toContainText("Skia: ok");
  await expect(report).toContainText("DashStylus: missing - rebuild the APK");
  await expect(report).toContainText(/Bridge STT: unavailable - .*model/i);
  await expect(report).toContainText("nativeVoice: enabled");
  await expect(page.getByRole("button", { name: "Copy report" })).toBeVisible();
  expect(outside).toEqual([]);
});

test.describe("bridge native voice disabled", () => {
  test.use({ bridgeOptions: { env: { DASH_NATIVE_VOICE: "0" } } });
  test("device self-check follows bridge nativeVoice disabled environment", async ({ page, bridge }) => {
    const outside = watchNetwork(page, bridge.port);
  await openChat(page, bridge);
    await send(page, "ARMY_DEVICE_CHECK_DISABLED real fixture turn");
    await expect(page.getByText(/ARMY_REPLY: ARMY_DEVICE_CHECK_DISABLED/).first()).toBeVisible();
    await openSelfCheck(page);
    const report = page.getByTestId("device-check-report");
    await expect(report).toContainText("nativeVoice: disabled on bridge");
    await expect(report).toContainText("Skia: ok");
    expect(outside).toEqual([]);
  });
});
