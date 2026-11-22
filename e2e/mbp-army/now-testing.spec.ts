import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test, expect, pair } from './fixtures';
import type { Page } from 'playwright/test';

// DA-004 / dash#107: after a turbo promotion the phone says which feature to test and opens its
// screen. turbo-promote stamps app/src/lib/build-info.json with scripts/turbo/now_testing.py; Metro
// bakes that file into the bundle. Here the real stamper runs on a fixture worktree, and the web
// export's baked build-info.json object is replaced by its output, as Metro would bundle it.
const root = resolve(__dirname, '../..');
const BAKED = /\{"?sha"?:null,"?builtAtMs"?:null\}/g;

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, '-c', 'user.name=army', '-c', 'user.email=army@example.invalid', ...args], { encoding: 'utf8' }).trim();
}

/** A promoted worktree: base commit, then the change under test. Returns the stamped build-info.json. */
async function promote(dir: string, change: { file?: string; message: string[] }, note = ''): Promise<{ sha: string; json: string }> {
  await mkdir(join(dir, 'app/src/screens/panes'), { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  await writeFile(join(dir, 'README.md'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'chore: preview base');
  if (change.file) { await mkdir(dirname(join(dir, change.file)), { recursive: true }); await writeFile(join(dir, change.file), '// army change\n'); git(dir, 'add', '.'); }
  git(dir, 'commit', '-q', '--allow-empty', ...change.message.flatMap(m => ['-m', m]));
  const sha = git(dir, 'rev-parse', 'HEAD');
  const json = execFileSync('python3', [join(root, 'scripts/turbo/now_testing.py'), '--repo', dir, '--sha', sha, '--base', 'HEAD~1',
    '--built-at-ms', String(Date.now()), '--note', note], { encoding: 'utf8' }).trim();
  return { sha, json };
}

/** Serve the web export with this build-info.json baked in; returns how many objects were replaced. */
async function bake(page: Page, json: string): Promise<() => number> {
  let replaced = 0;
  await page.route(url => url.pathname.includes('/_expo/static/js/') && url.pathname.endsWith('.js'), async route => {
    const response = await route.fetch();
    const body = await response.text();
    const next = body.replace(BAKED, () => { replaced++; return json; });
    await route.fulfill({ response, body: next });
  });
  return () => replaced;
}

const card = (page: Page) => page.getByTestId('now-testing-card');

test('now testing: a promoted feature with a Dash-Screen trailer shows its card and opens that screen once', async ({ page, bridge, errors }, info) => {
  const { sha, json } = await promote(info.outputPath('worktree'), { message: ['feat(settings): beta toggle spacing', 'Now-Testing: ARMY beta toggle spacing\nDash-Screen: dash://settings\nNow-Steps: scroll to Beta and flip In-app feedback'] });
  const stamped: unknown = JSON.parse(json);
  expect(stamped).toEqual({ sha, builtAtMs: expect.any(Number), testing: { feature: 'ARMY beta toggle spacing', screen: 'dash://settings', steps: 'scroll to Beta and flip In-app feedback' } });

  await pair(page, bridge);
  await expect(card(page)).toHaveCount(0); // the plain export bakes no build to test
  const replaced = await bake(page, json);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(card(page)).toBeVisible({ timeout: 60000 });
  expect(replaced(), 'exactly one baked build-info.json object').toBe(1);
  await expect(card(page).getByText('ARMY beta toggle spacing', { exact: true })).toBeVisible();
  await expect(card(page).getByText(`NOW TESTING · ${sha.slice(0, 7)}`, { exact: true })).toBeVisible();
  await expect(card(page).getByText('scroll to Beta and flip In-app feedback', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('card.png') });

  await card(page).getByRole('button', { name: 'Open Settings to test', exact: true }).click({ noWaitAfter: true });
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'In-app feedback', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('opened-settings.png') });

  // Once opened, the same promoted commit does not ask again on the next launch.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').nth(1).waitFor({ timeout: 60000 });
  await expect(card(page)).toHaveCount(0);
  expect(errors.filter(error => error.startsWith('PAGEERROR'))).toEqual([]);
});

test('now testing: the screen is inferred from the changed files and the deep link opens the Hosts pane', async ({ page, bridge, errors }, info) => {
  const { json } = await promote(info.outputPath('worktree'), { file: 'app/src/screens/panes/HostsPane.tsx', message: ['fix(hosts): collapse offline hosts'] }, 'ARMY hosts collapse');
  const stamped: unknown = JSON.parse(json);
  expect(stamped).toMatchObject({ testing: { feature: 'ARMY hosts collapse', screen: 'dash://hosts' } });

  await pair(page, bridge);
  await expect(page.getByRole('tab', { name: 'Chats', exact: true })).toHaveAttribute('aria-selected', 'true');
  await bake(page, json);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(card(page)).toBeVisible({ timeout: 60000 });
  await expect(card(page).getByText('ARMY hosts collapse', { exact: true })).toBeVisible();
  await card(page).getByRole('button', { name: 'Open Hosts to test', exact: true }).click({ noWaitAfter: true });
  await expect(card(page)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Hosts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Hosts workspace', exact: true })).toBeVisible();
  expect(errors.filter(error => error.startsWith('PAGEERROR'))).toEqual([]);
});

test('now testing: Dismiss hides the card without navigating, and a promote without a screen offers no deep link', async ({ page, bridge }, info) => {
  const { json } = await promote(info.outputPath('worktree'), { file: 'shared/army.ts', message: ['refactor(shared): army only'] });
  const stamped: unknown = JSON.parse(json);
  expect(stamped).toMatchObject({ testing: { feature: 'refactor(shared): army only' } });
  expect(stamped).not.toHaveProperty('testing.screen');

  await pair(page, bridge);
  await bake(page, json);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(card(page)).toBeVisible({ timeout: 60000 });
  await expect(card(page).getByRole('button', { name: /to test$/ })).toHaveCount(0);
  await card(page).getByRole('button', { name: 'Dismiss now testing', exact: true }).click({ noWaitAfter: true });
  await expect(card(page)).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').nth(1).waitFor({ timeout: 60000 });
  await expect(card(page)).toHaveCount(0);
});
