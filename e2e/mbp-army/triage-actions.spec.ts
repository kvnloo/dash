// #541: Triage is interactive. A real board blocker (the read-only Kanban collector over a seeded
// work.db) is handed to an agent from its detail: with no chat open, a new chat opens with the
// unblock prompt drafted (never auto-sent); Send delivers it to the fixture ACP agent.
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, pair, composer } from './fixtures';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('triage counts running and blocked work and hands a blocker to an agent as a drafted prompt (#541)', async ({ page, bridge }, info) => {
  const bun = execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  execFileSync(bun, [join(__dirname, 'seed-priority-board.ts'), join(bridge.dir, 'work.db'), String(Math.floor(Date.now() / 1000))]);
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page, bridge);
  await page.getByRole('tab').nth(2).click();
  await page.getByRole('button', { name: 'Triage', exact: true }).click();
  const list = page.getByTestId('live-triage-list');
  await expect(list.getByText('Fixture current board blocker', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('triage-counts')).toContainText(/\d+ needs you · [1-9]\d* blocked · [1-9]\d* running/);

  await list.getByRole('button', { name: 'Open Fixture current board blocker', exact: true }).click();
  const detail = page.getByTestId('triage-detail');
  await expect(detail.getByRole('button', { name: 'Open Quick mode', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('detail.png') });
  await detail.getByRole('button', { name: 'Hand Fixture current board blocker to an agent', exact: true }).click();
  await expect(composer(page)).toBeVisible();
  await expect(composer(page)).toHaveValue(/^\[Dash · Quick action · Unblock\] Fixture current board blocker\nSource: /);
  const turns = () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8').catch(() => '');
  expect(await turns(), 'drafted, not sent').not.toContain('Fixture current board blocker');
  await page.getByRole('button', { name: 'Send', exact: true }).click({ noWaitAfter: true });
  await expect.poll(turns, { timeout: 20000 }).toContain('Fixture current board blocker');
});
