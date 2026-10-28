// COV-G08: Real Expo web app -> authenticated Bun bridge -> fixture ACP agent.
// Extra regression journeys for wired controls; no socket mocks or debug store seeding.
import { test, expect, openChat, pair, composer, send } from './fixtures';

test('G08 window dock target switcher opens and closes without moving original actions', async ({ page, bridge }) => {
  await openChat(page, bridge);
  const dock = page.getByTestId('chat-window-dock');
  await expect(dock.getByTestId('chat-window-badge')).toBeVisible();
  await expect(dock.getByTestId('chat-window-options')).toBeVisible();
  await expect(dock.getByTestId('chat-window-close')).toBeVisible();
  const badge = dock.getByTestId('target-switcher-badge');
  await expect(badge).toBeVisible();
  await badge.click({ noWaitAfter: true });
  await expect(page.getByRole('heading', { name: 'Switch target', exact: true })).toBeVisible();
  await expect(page.getByLabel('Available hosts, harnesses, profiles, sessions and models')).toBeVisible();
  await page.getByTestId('target-switcher-close').click({ noWaitAfter: true });
  await expect(page.getByRole('heading', { name: 'Switch target', exact: true })).toHaveCount(0);
  await expect(dock.getByTestId('chat-window-badge')).toBeVisible();
  await expect(dock.getByTestId('chat-window-close')).toBeVisible();
});

test('G08 transcript scroll reveals jump control then resumes latest-follow', async ({ page, bridge }) => {
  await pair(page, bridge);
  await page.getByRole('button', { name: 'Create new chat', exact: true }).first().click({ noWaitAfter: true });
  await expect(composer(page)).toBeVisible();
  await send(page, 'ARMY_HANG ARMY_R07_SLOW g08 quick scroll');
  await expect(page.getByText(/ARMY_SLOW_CHUNK_08/).filter({ visible: true }).first()).toBeVisible({ timeout: 20000 });
  const viewport = page.getByTestId('transcript-viewport');
  const bounds = await viewport.boundingBox();
  if (!bounds) throw Error('Transcript viewport missing');
  await page.mouse.move(bounds.x + bounds.width * 0.45, bounds.y + bounds.height * 0.5);
  for (let index = 0; index < 5; index += 1) {
    await page.mouse.wheel(0, -2500);
    await page.waitForTimeout(120);
  }
  const jump = viewport.getByTestId('quick-scroll-button');
  await expect(jump).toBeVisible({ timeout: 6000 });
  await expect(jump).toHaveAttribute('aria-label', /^Jump to latest/);
  await jump.click({ noWaitAfter: true });
  await expect(jump).toHaveCount(0);
  await expect.poll(() => viewport.evaluate(root => {
    const list = Array.from(root.querySelectorAll('div')).find(
      element => /(auto|scroll)/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight + 4,
    );
    return list ? list.scrollHeight - list.clientHeight - list.scrollTop : Infinity;
  })).toBeLessThanOrEqual(60);
});

test('G08 reconnect notice appears on real bridge loss and clears after authenticated hello', async ({ page, bridge }) => {
  await openChat(page, bridge);
  await expect(page.getByTestId('pc-reconnect-notice')).toHaveCount(0);
  await bridge.stop();
  // Main behind the window mounts its own notice; assert the one in the chat window.
  const notice = page.getByTestId('chat-window').getByTestId('pc-reconnect-notice');
  await expect(notice).toBeVisible({ timeout: 15000 });
  await expect(notice.getByTestId('pc-reconnect-action')).toHaveAttribute('aria-label', /Retry connection now\.$/);
  await expect(notice.getByText('Retry now', { exact: true })).toBeVisible();
  await bridge.start();
  await expect(notice).toHaveCount(0, { timeout: 30000 });
});
