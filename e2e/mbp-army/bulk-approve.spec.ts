// Bulk approve from Quick mode (A12). Two real ACP permission requests (fixture agent,
// ARMY_PERMISSION) in two chats are allowed once together, and three bulk-safe upstream gate
// proposals (real GateStore, dry run) are approved in one exact-body decision. Cancel keeps both.
import { test, expect, openChat, send, composer, type Bridge } from './fixtures';
import type { Page } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.env.ARMY_BRIDGE_ROOT || resolve(__dirname, '../..');
const bun = process.env.ARMY_BUN || execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

function seedGate(bridge: Bridge, n: number) {
  const script = `const { GateStore } = await import(${JSON.stringify(root + '/bridge/src/gate/store.ts')});
const store = new GateStore(process.env.DASH_GATE_DIR);
for (let i = 0; i < ${n}; i++) await store.propose({kind:'issue_comment',target:{repo:'example/army-fixture',number:10+i},body:'ARMY_BULK_FIXTURE '+i,evidence:[{label:'fixture',url_or_path:'https://example.invalid/bulk'}],origin:{agent:'army-bulk',session:'isolated',created_at:new Date().toISOString()}},[{path:'CONTRIBUTING.md',text:'Tests and clear reproduction are required.'}]);`;
  execFileSync(bun, ['-e', script], { env: { ...process.env, DASH_GATE_DIR: join(bridge.dir, 'gate') }, cwd: root });
}

async function toChats(page: Page) {
  const close = page.getByRole('button', { name: /^(Back|Close chat window)$/ }).first();
  if (await close.isVisible()) await close.click({ noWaitAfter: true });
  await page.getByRole('tab').nth(1).click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane')).toBeVisible();
}

async function permissionChat(page: Page, text: string) {
  await send(page, text);
  await expect(page.getByTestId('permission-choice-army-allow-once')).toBeVisible();
}

const selected = async (dir: string) => (await readFile(join(dir, 'army-acp-permissions.jsonl'), 'utf8').catch(() => ''))
  .split('\n').filter(line => line.includes('"optionId":"army-allow-once"')).length;

test('quick mode approves several pending approvals at once: two Needs OK requests and three bulk-safe upstream items', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge);
  await permissionChat(page, 'ARMY_PERMISSION bulk one');
  await toChats(page);
  await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  await expect(composer(page)).toBeVisible();
  await permissionChat(page, 'ARMY_PERMISSION bulk two');
  seedGate(bridge, 2);
  await toChats(page);

  const label = page.getByTestId('spen-mode-label').first();
  for (let tap = 0; tap < 3 && (await label.textContent()) !== 'Quick'; tap++) await page.getByTestId('spen-mode-pill').first().click({ noWaitAfter: true });
  await expect(page.getByTestId('mode-surface-quick')).toBeVisible();
  const count = page.getByTestId('quick-approvals-count');
  await expect(count).toHaveText('2 need OK · 3 upstream bulk-safe (dry run)', { timeout: 15_000 });

  // Cancel changes nothing.
  await page.getByRole('button', { name: 'Allow all 2 pending requests once', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('quick-approvals')).toContainText('Allow once, in 2 chats');
  await page.getByRole('button', { name: 'Cancel bulk allow', exact: true }).click({ noWaitAfter: true });
  await expect(count).toHaveText('2 need OK · 3 upstream bulk-safe (dry run)');
  expect(await selected(bridge.dir)).toBe(0);

  await page.getByRole('button', { name: 'Allow all 2 pending requests once', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Confirm allow 2 once', exact: true }).click({ noWaitAfter: true });
  await expect.poll(() => selected(bridge.dir), { timeout: 15_000 }).toBe(2);
  await expect(count).toHaveText('0 need OK · 3 upstream bulk-safe (dry run)', { timeout: 15_000 });
  await page.screenshot({ path: info.outputPath('allowed.png') });

  await page.getByRole('button', { name: 'Approve 3 bulk-safe upstream items', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Confirm approve 3 upstream items', exact: true }).click({ noWaitAfter: true });
  await expect(count).toHaveText('0 need OK · 0 upstream bulk-safe (dry run)', { timeout: 15_000 });
  await expect(page.getByTestId('quick-approvals-note')).toHaveText('Approved 3 upstream items (posting is separate).');
});
