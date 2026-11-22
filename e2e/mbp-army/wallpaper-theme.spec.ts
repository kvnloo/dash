import { chatRow, composer, expect, openChat, test } from "./fixtures";

// Web proves the theme's UI and compositing layers, not Android's live WallpaperService.
test("Wallpaper glass stays selected and reveals the backdrop behind a usable chat", async ({ page, bridge }, info) => {
  await openChat(page, bridge);
  const chat = page.getByTestId("chat-window");
  const scrim = page.getByTestId("wallpaper-glass-scrim");
  const closeChat = page.getByRole("button", { name: "Close chat window", exact: true });
  const settings = page.getByRole("button", { name: "Open settings", exact: true }).first();
  const toggle = page.getByRole("switch", { name: "Wallpaper glass", exact: true });
  const back = page.getByRole("button", { name: "Back", exact: true }).last();
  const chats = page.getByRole("tab").nth(1);
  await expect(scrim).toHaveCount(0);
  await expect(chat).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await closeChat.click({ noWaitAfter: true });
  await settings.click({ noWaitAfter: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click({ noWaitAfter: true });
  await expect(toggle).toBeChecked();
  await back.click({ noWaitAfter: true });
  await chatRow(page).click({ noWaitAfter: true });

  await expect(scrim).toHaveCSS("background-color", "rgba(8, 9, 8, 0.8)");
  await expect(chat).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await composer(page).fill("Wallpaper glass fixture chat");
  await page.getByRole("button", { name: "Send", exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
  expect(bridge.logs()).toMatch(/ws\.chat .*harness=omp/);
  await page.screenshot({ path: info.outputPath("wallpaper-glass-web-preview.png") });

  await closeChat.click({ noWaitAfter: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await chats.click({ noWaitAfter: true });
  await expect(scrim).toBeVisible();
  await settings.press("Enter");
  await expect(toggle).toBeChecked();
  await toggle.click({ noWaitAfter: true });
  await expect(toggle).not.toBeChecked();
  await back.click({ noWaitAfter: true });
  await expect(scrim).toHaveCount(0);
  // Settings back can return to the default workspace; select Chats explicitly.
  await chats.click({ noWaitAfter: true });
  await expect(chats).toHaveAttribute("aria-selected", "true");
  await expect(composer(page)).toBeInViewport();
});
