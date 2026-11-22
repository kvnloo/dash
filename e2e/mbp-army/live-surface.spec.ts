import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright/test';
import { test, expect, openChat, chooseHarness, send, composer, type Bridge } from './fixtures';

// Live surface (DA-066, PR #75): a Hermes chat's fast lane. The real bridge forwards live_* messages
// to a loopback z0bridge --fx stand-in (fixture-fx.ts); the libfx worker's fx0 controls render in
// Dash and every tap lands in the owning Hermes session as a receipt.
test.use({ bridgeOptions: { liveFx: true } });
test.afterEach(async ({ page }, info) => { if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') }); });

type FxEntry = { method?: string; path?: string; authorized?: boolean; body?: { intent?: { controlId: string; value: unknown; label?: string }; text?: string }; hermesReceipt?: { kind: string; decisions: string[]; hermes?: { child: string; messageId: number } } };
const fxLog = async (dir: string): Promise<FxEntry[]> => (await readFile(join(dir, 'army-fx.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line) as FxEntry);

async function openLive(page: Page, bridge: Bridge) {
  await openChat(page, bridge);
  await chooseHarness(page, 'Hermes');
  // A Hermes chat with one finished turn (scripted ACP peer), then the owner switches its surface.
  await send(page, 'ARMY live seed');
  await expect(page.getByText(/ARMY_REPLY: ARMY live seed/)).toBeVisible();
  await page.getByRole('button', { name: 'Options. Current surface: Chat', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Surface, Current: Chat · switch to Live surface', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('live-surface')).toBeVisible({ timeout: 15_000 });
  await expect(composer(page)).toHaveAttribute('placeholder', 'Live surface · quick reply');
}

test('Live surface: a Hermes chat asks for a control, the fx0 control renders under 2 s and the pick lands in Hermes', async ({ page, bridge }) => {
  await openLive(page, bridge);
  await expect(page.getByText(/fx worker · libfx army fixture → Hermes/)).toBeVisible();

  // Ask for a control: the clock runs from the Send tap to the tappable fx0 control on screen.
  await composer(page).fill('Give me a layout control for the dashboard');
  const started = Date.now();
  await page.getByRole('button', { name: 'Send', exact: true }).click({ noWaitAfter: true });
  const control = page.getByRole('radiogroup', { name: 'Pick a layout for the dashboard', exact: true });
  await expect(control).toBeVisible({ timeout: 2_000 });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(2_000);
  test.info().annotations.push({ type: 'fx0-control-ms', description: String(elapsed) });
  await expect(page.getByTestId('live-timing')).toContainText(/control \d+\.\d s/);
  await expect(page.getByRole('tab', { name: 'Version 2', exact: true })).toHaveAttribute('aria-selected', 'true');

  // The tap is a declared intent: z0bridge records it in the owning Hermes session, then the worker reacts.
  const grid = control.getByRole('radio', { name: /Grid layout/ });
  await grid.click({ noWaitAfter: true });
  await expect(grid).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Picked Grid layout', { exact: true })).toBeVisible();
  await expect(page.getByText('Applied Grid layout.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Version 3', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /^Receipts in Hermes: [23]$/ })).toBeVisible();
  await expect(page.getByText('Decided: layout = Grid layout', { exact: true })).toBeVisible();

  const entries = await fxLog(bridge.dir);
  expect(entries.filter(e => e.method).every(e => e.authorized), 'every z0bridge request carried the bearer').toBe(true);
  const intent = entries.find(e => e.method === 'POST' && e.path?.endsWith('/intents'));
  expect(intent?.body?.intent).toMatchObject({ controlId: 'layout', value: 'grid', label: 'Grid layout', surface: 'dash-live-surface' });
  const held = entries.find(e => e.hermesReceipt?.kind === 'intent');
  expect(held?.hermesReceipt?.decisions).toEqual(['layout = Grid layout']);
  // Bridge log: the answer reached Hermes (its child record and message id), and the control's latency.
  const logs = bridge.logs();
  expect(logs).toMatch(new RegExp(`live\\.intent .*control=layout receipt=intent hermesChild=fxw_fxw-army-1 hermesMessage=${held?.hermesReceipt?.hermes?.messageId}`));
  expect(logs).toMatch(/live\.control .*control=layout kind=choice ms=\d+/);
  expect(logs).toMatch(/live\.open .*worker=fxw-army-1 parent=\S+ attached=new artifacts=1/);
  expect(logs).not.toContain('Give me a layout control');
});

test('Live surface: versions, stage, Receipts in Hermes and Ask Hermes route through the owning session', async ({ page, bridge }) => {
  await openLive(page, bridge);
  await expect(page.getByRole('tab', { name: 'Version 1', exact: true })).toHaveAttribute('aria-selected', 'true');
  await send(page, 'Draft a dashboard');
  await expect(page.getByRole('tab', { name: 'Version 2', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Pick a layout and I will apply it.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Version 1', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('tab', { name: 'Version 1', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('live-artifact').locator('iframe').contentFrame().getByRole('heading', { name: 'Starter dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Open live artifact in stage', exact: true }).click({ noWaitAfter: true });
  // The stage shows the shown version (v1) full screen, then Back returns to the surface.
  await expect(page.getByTestId('live-surface')).toBeHidden();
  await expect(page.locator('iframe').last().contentFrame().getByText('fx0 design version 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).first().click({ noWaitAfter: true });
  await expect(page.getByTestId('live-surface')).toBeVisible();

  const receipts = page.getByRole('button', { name: 'Receipts in Hermes: 1', exact: true });
  await expect(receipts).toBeVisible();
  await receipts.click({ noWaitAfter: true });
  await expect(receipts.getByText(/^#\d+ turn · /)).toBeVisible();
  await receipts.click({ noWaitAfter: true });
  await expect(receipts.getByText(/^#\d+ turn · /)).toHaveCount(0);

  const ask = page.getByRole('switch', { name: 'Ask Hermes', exact: true });
  await ask.click({ noWaitAfter: true });
  await expect(ask).toHaveAttribute('aria-checked', 'true');
  await expect(composer(page)).toHaveAttribute('placeholder', 'Ask Hermes through the live surface');
  await send(page, 'When is the deploy window?');
  await expect(page.getByText('Ask Hermes: When is the deploy window?', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Hermes: Hermes says the deploy window is Thursday.')).toBeVisible();
  await expect(composer(page)).toHaveAttribute('placeholder', 'Live surface · quick reply');
  await expect(page.getByRole('button', { name: 'Receipts in Hermes: 2', exact: true })).toBeVisible();
  const turns = (await fxLog(bridge.dir)).filter(e => e.method === 'POST' && e.path?.endsWith('/turns'));
  expect(turns.at(-1)?.body?.text).toBe('Use the hermes tool to ask Hermes exactly this, then relay its answer in one or two sentences: When is the deploy window?');
  expect(bridge.logs()).toMatch(/live\.receipt .*receipt=ask_hermes hermesChild=fxw_fxw-army-1/);
});
