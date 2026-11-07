import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, pair } from './fixtures';

// Real source files in this test's isolated bridge HOME, never route/store mocks.
test('Triage lists live blockers and roadmap priorities, opens an item and labels stale evidence', async ({ page, bridge }, info) => {
  const now = Date.now();
  const bun = execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  execFileSync(bun, [join(__dirname, 'seed-priority-board.ts'), join(bridge.dir, 'work.db'), String(Math.floor(now / 1000))]);
  const directory = join(bridge.dir, '.local/state/dash');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'roadmap.json'), JSON.stringify({ id: 'army', title: 'Fixture roadmap', updated: new Date(now).toISOString(), items: [
    { id: 'decision', title: 'Choose fixture release', stage: 'candidate', area: 'Army', detail: 'Review the release evidence', evidence: 'Fixture contract', next: 'Approve fixture release', attention: 'you', priority: 'P0', updatedAt: now },
    { id: 'stale', title: 'Outdated fixture decision', stage: 'planned', area: 'Army', detail: '', evidence: '', next: 'Do not treat as current', attention: 'you', priority: 'P0', updatedAt: now - 60000 },
  ] }));
  const supervision = join(directory, 'supervision');
  await mkdir(supervision, { recursive: true });
  const generated_at = new Date(now).toISOString();
  await writeFile(join(supervision, 'state.json'), JSON.stringify({ generated_at, workers: [{ id: 'army-blocked', goal: 'Running fixture awaits credentials', phase: 'blocked', updated_at: generated_at, meta: {} }], findings: [] }));
  await writeFile(join(supervision, 'needs-kevin.json'), JSON.stringify({ schema: 'z0.fsm.needs-kevin/v1', generated_at, size: 1, items: [{ id: 'owner', worker: 'army-owner', goal: 'Fixture owner decision', why: 'Requires owner input', recommended_action: 'Choose an option', options: [], evidence_path: 'fixture-contract', phase: 'waiting-on-you' }] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page, bridge);
  await page.getByRole('tab').nth(2).click();
  await expect(page.getByTestId('orchestra-graph')).toBeInViewport({ ratio: 1 });
  await page.getByRole('button', { name: 'Triage', exact: true }).click();
  const list = page.getByTestId('live-triage-list');
  await expect(list.getByText('Fixture current board blocker', { exact: true })).toBeVisible();
  await expect(list.getByTestId('triage-item-kanban:configured:army-board-blocked')).toContainText('Running · blocked');
  await expect(list.getByText('Running fixture awaits credentials', { exact: true })).toBeVisible();
  await expect(list.getByText('Fixture owner decision', { exact: true })).toBeVisible();
  await expect(list.getByText('Choose fixture release', { exact: true })).toBeVisible();
  const stale = list.getByTestId('triage-item-roadmap:stale');
  await expect(stale).toContainText('Stale');
  await expect(list.getByRole('button').last()).toHaveAccessibleName('Open Outdated fixture decision');
  await expect(list.getByTestId('triage-item-roadmap:decision')).toContainText('ago');
  await expect(list.getByRole('button').first()).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('triage-list.png') });
  await list.getByRole('button', { name: 'Open Choose fixture release', exact: true }).click();
  await expect(page.getByTestId('triage-detail')).toContainText('Approve fixture release');
  await expect(page.getByTestId('triage-detail')).toContainText('Fixture contract');
  await expect(page.getByTestId('triage-detail').getByText('Approve fixture release', { exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Close triage item', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('triage-open.png') });
  // Removing an ask at the source must remove it on the next foreground poll.
  await page.getByRole('button', { name: 'Close triage item', exact: true }).click();
  await writeFile(join(directory, 'roadmap.json'), JSON.stringify({ id: 'army', title: 'Fixture roadmap', updated: new Date().toISOString(), items: [] }));
  await expect(list.getByText('Choose fixture release', { exact: true })).toHaveCount(0, { timeout: 25000 });
  const running = list.getByTestId('triage-item-kanban:configured:army-board-running');
  await expect(running).toContainText('Fixture current running work');
  await expect(running).toContainText('Running · board status');
  await running.click();
  await expect(page.getByTestId('triage-detail')).toContainText('Process liveness is not independently verified');
  await expect(page.getByTestId('triage-detail')).not.toContainText('Old resolved blocker');
  await expect(page.getByTestId('triage-detail')).not.toContainText('Old resolved failure');
  await page.getByRole('button', { name: 'Close triage item', exact: true }).click();
});

test('Agent Trace loads the bridge live session and clears it on unavailable', async ({ page, bridge }, info) => {
  const bun = execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  execFileSync(bun, [join(__dirname, 'seed-trace-live.ts'), join(bridge.dir, '.hermes/state.db')]);
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page, bridge);
  await page.getByRole('tab').nth(2).click();
  await expect(page.getByTestId('orchestra-graph')).toBeInViewport({ ratio: 1 });
  await page.getByTestId('trace-entry').click();
  await expect(page.getByTestId('trace-feed-live')).toBeVisible();
  const session = page.getByTestId('row-hermes:.hermes:army-fixture-session');
  await expect(session).toContainText('ARMY native fixture');
  await expect(page.getByText('Live · 1', { exact: true })).toBeVisible();
  await session.scrollIntoViewIfNeeded();
  await expect(session).toBeInViewport();
  await expect(page.getByText('bundled snapshot', { exact: false })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('trace-live.png') });
  await bridge.stop();
  await expect(page.getByTestId('trace-feed-unavailable')).toContainText('unavailable', { timeout: 25000 });
  await expect(page.getByTestId('trace-timeline')).toHaveCount(0);
  await expect(session).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('trace-unavailable.png') });
});

test.describe('Trace without native sessions', () => {
  test.use({ persistSession: false });
  test('Agent Trace reports unavailable when the live bridge has no source observations', async ({ page, bridge }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await pair(page, bridge);
    await page.getByRole('tab').nth(2).click();
    await expect(page.getByTestId('orchestra-graph')).toBeInViewport({ ratio: 1 });
    await page.getByTestId('trace-entry').click();
    await expect(page.getByTestId('trace-feed-unavailable')).toContainText('No live sessions or source observations');
    await expect(page.getByTestId('trace-timeline')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('trace-empty.png') });
  });
});
