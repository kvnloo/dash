import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { test, expect, pair } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

// #538: Zero and the agent trace are one card, anchored to the main input, on every Main tab.
test('one Zero card above the main input carries the live agent trace, tucks away and comes back', async ({ page, bridge }, info) => {
  const bun = execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  execFileSync(bun, [join(__dirname, 'seed-trace-live.ts'), join(bridge.dir, '.hermes/state.db')]);
  await pair(page, bridge);
  const zero = page.getByTestId('zero-card');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const trace = zero.getByTestId('trace-entry');

  for (const tab of [1, 2, 0]) {
    await page.getByRole('tab').nth(tab).click({ noWaitAfter: true });
    await expect(page.getByRole('tab').nth(tab)).toHaveAttribute('aria-selected', 'true');
    // Exactly one card, and the trace lives inside it: no separate trace card anywhere on Main.
    await expect(zero).toHaveCount(1);
    await expect(page.getByTestId('trace-entry')).toHaveCount(1);
    await expect(trace).toBeVisible();
  }

  await expect(zero.getByText('Zero', { exact: true })).toBeVisible();
  await expect(zero.getByTestId('zero-card-host')).toContainText(/online · \d+ live · \d+ sessions/);
  // Real bridge trace counts, not the bundled sample.
  await expect(trace).toHaveAttribute('aria-label', /Agent trace: Live from bridge · 1 live · 0 cut · 0 needs OK/, { timeout: 30_000 });

  // Anchored: the card sits directly on the main input.
  const card = await zero.boundingBox();
  const bar = await input.boundingBox();
  if (!card || !bar) throw Error('Zero card or main input has no box');
  const gap = bar.y - (card.y + card.height);
  expect(gap, 'Zero card bottom to main input top').toBeGreaterThanOrEqual(0);
  expect(gap, 'only the input pill padding between them').toBeLessThanOrEqual(40);
  expect(card.y + card.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: info.outputPath('zero-card-shown.png') });

  // Tuck: the trace goes away, the one-line Zero row stays above the input, and it survives a reload.
  await zero.getByRole('button', { name: 'Tuck Zero card', exact: true }).click({ noWaitAfter: true });
  await expect(trace).toHaveCount(0);
  await expect(zero).toHaveAttribute('aria-label', 'Zero card, tucked');
  const tucked = await zero.boundingBox();
  if (!tucked) throw Error('Tucked Zero card has no box');
  expect(tucked.height).toBeLessThan(card.height);
  await page.screenshot({ path: info.outputPath('zero-card-tucked.png') });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(zero).toHaveAttribute('aria-label', 'Zero card, tucked', { timeout: 30_000 });
  await expect(trace).toHaveCount(0);

  // It comes back, and tapping the nested trace opens the live Trace screen.
  await zero.getByRole('button', { name: 'Show Zero card', exact: true }).click({ noWaitAfter: true });
  await expect(trace).toBeVisible();
  await trace.click({ noWaitAfter: true });
  await expect(page.getByTestId('trace-feed-live')).toBeVisible({ timeout: 25_000 });
});
