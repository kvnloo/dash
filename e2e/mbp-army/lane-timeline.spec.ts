// DA-077: the z0live lane timeline on the Voice (live call) screen.
// Real Expo web app + real authenticated bridge reading a z0live session JSONL the test appends to,
// exactly as the broker would. Proves the bridge fold, the 1 Hz poll and the panel's layout and taps;
// never a real broker, real lanes or a real model.
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, pair } from './fixtures';

const row = (type: string, data: Record<string, unknown>, ts = Date.now() / 1000) => JSON.stringify({ type, ts, data }) + '\n';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('z0live lane timeline shows each lane live step, elapsed time and expandable handoff, collapsed by default', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dir = join(bridge.dir, 'z0live');
  await mkdir(dir, { recursive: true });
  const session = join(dir, 'army-lanes.jsonl');
  const started = Date.now() / 1000 - 75;
  await writeFile(session,
    row('app_state', { source: 'connected' }, started)
    + row('lane_attached', { lane: 'fast', name: 'Fast', model: 'army-fast-1' }, started)
    + row('lane_attached', { lane: 'small', name: 'Small', model: 'army-small-1' }, started)
    + row('lane_attached', { lane: 'large', name: 'Large', model: 'army-large-1' }, started)
    + row('lane_attached', { lane: 'council', name: 'Council', model: '3 models' }, started)
    + row('lane_step', { lane: 'large', step: 'Planning the refactor' }, started)
    + row('lane_step', { lane: 'fast', step: 'Reading the diff' }));

  await pair(page, bridge);
  await page.getByRole('tab').nth(0).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Expand', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('voice-caption')).toBeVisible();

  // Collapsed by default: one summary line, no rows, and it stays clear of the hero orb.
  const panel = page.getByTestId('lane-timeline');
  const summary = page.getByTestId('lane-timeline-summary');
  await expect(page.getByTestId('lane-timeline-summary-text')).toHaveText('4 lanes · 2 working · Fast: Reading the diff', { timeout: 15000 });
  await expect(page.getByTestId('lane-timeline-rows')).toHaveCount(0);
  const collapsed = await panel.boundingBox();
  expect(collapsed?.height, 'collapsed panel is a single line').toBeLessThanOrEqual(48);
  const orb = await page.getByRole('img', { name: /^Dash voice / }).boundingBox();
  expect(orb && collapsed && collapsed.y >= orb.y + orb.height, 'panel sits below the orb, never over it').toBe(true);
  await page.screenshot({ path: info.outputPath('lanes-collapsed.png') });

  // Expanded: one row per lane with name + model, current step and a ticking elapsed clock.
  await summary.click({ noWaitAfter: true });
  await expect(summary).toHaveAttribute('aria-label', /Hide lanes$/);
  for (const [id, name, model] of [['fast', 'Fast', 'army-fast-1'], ['small', 'Small', 'army-small-1'], ['large', 'Large', 'army-large-1'], ['council', 'Council', '3 models']]) {
    await expect(page.getByTestId(`lane-name-${id}`)).toHaveText(`${name} · ${model}`);
  }
  await expect(page.getByTestId('lane-step-large')).toHaveText('Planning the refactor');
  await expect(page.getByTestId('lane-step-small')).toHaveText('Idle · attached');
  await expect(page.getByTestId('lane-elapsed-large')).toHaveText(/^1m \d\ds$/);
  const first = await page.getByTestId('lane-elapsed-fast').textContent();
  await expect.poll(() => page.getByTestId('lane-elapsed-fast').textContent(), { message: 'elapsed ticks without new events' }).not.toBe(first);

  // Live update from the bridge: a new step, then a handoff, appear without any tap.
  await appendFile(session, row('lane_step', { lane: 'small', step: 'Checking the tests' }));
  await expect(page.getByTestId('lane-step-small')).toHaveText('Checking the tests', { timeout: 10000 });
  const result = 'PR 701 merged into staging.\nArmy receipt green for the exact commit.\nNo follow-ups.';
  await appendFile(session, row('lane_handoff', { lane: 'fast', summary: 'PR 701 merged, receipt green', result }));
  await expect(page.getByTestId('lane-step-fast')).toHaveText('Idle · handed back', { timeout: 10000 });
  await expect(page.getByTestId('lane-handoff-line-fast')).toHaveText('↳ PR 701 merged, receipt green');
  await expect(page.getByTestId('lane-elapsed-fast')).toHaveText(/^\d+s ago$/);
  await expect(page.getByTestId('lane-result-fast')).toHaveCount(0);
  const line = await page.getByTestId('lane-handoff-fast').boundingBox();
  expect(line?.height, 'handoff is one line until tapped').toBeLessThanOrEqual(32);
  await expect(page.getByTestId('lane-timeline-summary-text')).toHaveText('4 lanes · 2 working · Fast handed back');

  // Tap the handoff for the full result, tap again to fold it back to one line.
  await page.getByTestId('lane-handoff-fast').click({ noWaitAfter: true });
  await expect(page.getByTestId('lane-result-fast')).toHaveText(result, { useInnerText: true });
  await expect(page.getByTestId('lane-handoff-fast')).toHaveAttribute('aria-label', /Hide full result$/);
  await page.screenshot({ path: info.outputPath('lanes-expanded.png') });
  // Expanded with a full result open, the panel still leaves the title clear of the header and ends above Start voice.
  const back = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
  const title = await page.getByText('Dash voice', { exact: true }).boundingBox();
  expect(back && title && title.y >= back.y + back.height, 'title stays below the header').toBe(true);
  const open = await panel.boundingBox();
  const start = await page.getByRole('button', { name: 'Start voice in Dash', exact: true }).boundingBox();
  expect(open && start && open.y + open.height <= start.y, 'panel ends above the controls').toBe(true);
  await page.getByTestId('lane-handoff-fast').click({ noWaitAfter: true });
  await expect(page.getByTestId('lane-result-fast')).toHaveCount(0);

  // A failed lane says so; a detached lane leaves; collapsing returns to the single line.
  await appendFile(session, row('lane_error', { lane: 'council', message: 'Rate limited' }) + row('lane_detached', { lane: 'large' }));
  await expect(page.getByTestId('lane-step-council')).toHaveText('Failed · Rate limited', { timeout: 10000 });
  await expect(page.getByTestId('lane-row-large')).toHaveCount(0);
  await summary.click({ noWaitAfter: true });
  await expect(page.getByTestId('lane-timeline-rows')).toHaveCount(0);
  await expect(page.getByTestId('lane-timeline-summary-text')).toHaveText('3 lanes · 1 working · 1 failed · Council failed');

  // The call's session ends: the panel goes away.
  await appendFile(session, row('app_state', { source: 'session_end' }));
  await expect(panel).toHaveCount(0, { timeout: 10000 });
});
