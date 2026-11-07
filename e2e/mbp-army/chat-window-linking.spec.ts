import { test, expect, openChat, chatRow, send, web } from './fixtures';

test('chat row navigation never serializes its window rect and survives reload', async ({ page, bridge }) => {
  // The row's real press rect must remain in memory while the web route stays clean.
  await openChat(page, bridge);
  await expect(page.getByTestId('chat-window')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('window')).toBe(false);

  // A real ACP fixture turn proves this is the paired bridge, not a navigation mock.
  const prompt = 'ARMY_WINPARAM_1106 first window';
  await send(page, prompt);
  await expect(page.getByText(`ARMY_STREAM_BEGIN ARMY_REPLY: ${prompt}`, { exact: true })).toBeVisible();

  await page.reload();
  // The animation rect is intentionally not persisted; a restored Chat is full-screen.
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('tab').nth(1).click();
  await expect(page.getByTestId('chats-pane')).toBeVisible();

  // Normal click waits for scheduled web navigations: the old object-param path hung here.
  await chatRow(page).click();
  await expect(page.getByTestId('chat-window')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('window')).toBe(false);
});

test('legacy string window deep link degrades to full screen and row reopens', async ({ page, bridge }) => {
  await openChat(page, bridge);
  await page.goto(`${web}/Chat?window=%5Bobject%20Object%5D`, { waitUntil: 'domcontentloaded' });
  // A legacy URL can supply a string, but it cannot be treated as a window origin.
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await expect(page.getByTestId('chat-window')).toHaveCount(0);

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('tab').nth(1).click();
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await chatRow(page).click();
  await expect(page.getByTestId('chat-window')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('window')).toBe(false);
});
