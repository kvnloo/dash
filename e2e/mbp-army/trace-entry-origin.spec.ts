import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect, pair } from './fixtures';

// Both origins use the real Expo web app and the authenticated isolated bridge.
// The Hermes source comes from the army's native session DB, never a route or store mock.
test('Orchestra Agent trace uses the real bridge count before opening Trace, then clears it on outage', async ({ page, bridge }) => {
  const bun = execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  execFileSync(bun, [join(__dirname, 'seed-trace-live.ts'), join(bridge.dir, '.hermes/state.db')]);
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page, bridge);
  await page.getByRole('tab').nth(2).click();

  const card = page.getByTestId('trace-entry').first();
  await expect(card).toBeVisible();
  // This must populate in Orchestra itself. The owner must not have to visit Trace first.
  await expect(card).toHaveAttribute('aria-label', /Agent trace: Live from bridge · 1 live · 0 cut · 0 needs OK/, { timeout: 30000 });
  await expect(card).not.toHaveAttribute('aria-label', /4 live|18 cut|23 ask|58 workers|12 h|Bundled snapshot/i);

  await card.click();
  await expect(page.getByTestId('trace-feed-live')).toBeVisible({ timeout: 25000 });
  await expect(page.getByTestId('row-hermes:.hermes:army-fixture-session')).toContainText('ARMY native fixture');
  await expect(page.getByText('Live · 1', { exact: true })).toBeVisible();

  await bridge.stop();
  await expect(page.getByTestId('trace-feed-unavailable')).toContainText('unavailable', { timeout: 25000 });
  await expect(page.getByTestId('trace-timeline')).toHaveCount(0);
});

test.describe('Trace card with no live source observations', () => {
  test.use({ persistSession: false });

  test('Orchestra labels the bundled timestamp and never presents its numbers as live', async ({ page, bridge }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await pair(page, bridge);
    await page.getByRole('tab').nth(2).click();

    const card = page.getByTestId('trace-entry').first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('aria-label', /Live trace unavailable.*Bundled snapshot · 2026-10-21 00:53 \(trace clock\).*not live/, { timeout: 30000 });
    const label = await card.getAttribute('aria-label');
    expect(label).not.toMatch(/4 live|18 cut|23 ask|58 workers|12 h|\basks?\b/i);

    await card.click();
    await expect(page.getByTestId('trace-feed-unavailable')).toContainText('No live sessions or source observations', { timeout: 20000 });
    await expect(page.getByTestId('trace-timeline')).toHaveCount(0);
  });
});
