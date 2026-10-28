import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, chooseHarness, send } from './fixtures';

test.use({ bridgeOptions: { generatedUI: true } });
test.afterEach(async ({ page }, info) => {
 if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('OpenUI reply streams into accessible native catalog cards instead of source', async ({ page, bridge }) => {
 await openChat(page, bridge);
 await chooseHarness(page, 'Hermes');
 await send(page, 'ARMY_OPENUI_CATALOG ARMY_HOLD');
 await expect(page.getByRole('progressbar', { name: 'Building interface', exact: true })).toBeVisible();
 await expect(page.getByRole('heading', { name: 'ARMY native overview, card', exact: true })).toHaveCount(0);
 await writeFile(join(bridge.dir, 'army-release'), 'release generated reply');
 // These roles and names exist only in #484's native view, reached through #488's parser.
 await expect(page.getByRole('heading', { name: 'ARMY native overview, card', exact: true })).toBeVisible();
 await expect(page.getByLabel('ARMY selectable summary', { exact: true })).toBeVisible();
 await expect(page.getByLabel('Completed: 7', { exact: true })).toBeVisible();
 const progress = page.getByRole('progressbar', { name: 'Delivery, 75 percent', exact: true });
 await expect(progress).toHaveAttribute('aria-valuenow', '75');
 await expect(page.getByLabel('Item 1: Review evidence', { exact: true })).toBeVisible();
 await expect(page.getByRole('table').getByRole('columnheader', { name: 'Task', exact: true })).toBeVisible();
 await expect(page.getByRole('table').getByRole('cell', { name: 'Catalog wiring', exact: true })).toBeVisible();
 await expect(page.getByLabel('success callout: ARMY bounded catalog', { exact: true })).toBeVisible();
 await expect(page.getByText(/root = Stack/)).toHaveCount(0);
 await expect(page.getByRole('alert', { name: 'Interface could not be rendered', exact: true })).toHaveCount(0);
 await expect.poll(async () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).toContain('"event":"end"');
 await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
});

test('OpenUI reply rejects components outside the static catalog without exposing source', async ({ page, bridge }) => {
 await openChat(page, bridge);
 await send(page, 'ARMY_OPENUI_INVALID');
 await expect(page.getByRole('alert', { name: 'Interface could not be rendered', exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: 'ARMY forbidden action', exact: true })).toHaveCount(0);
 await expect(page.getByText(/root = Button/)).toHaveCount(0);
 await expect.poll(async () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).toContain('ARMY_OPENUI_INVALID');
});

for (const format of ['GenUI', 'OpenUI']) {
 test(`${format} JSON reply still renders a native card`, async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, format === 'GenUI' ? 'ARMY_GENUI' : 'ARMY_OPENUI_JSON');
  await expect(page.getByLabel(`card: ARMY legacy ${format}`, { exact: true })).toBeVisible();
  await expect(page.getByText(format === 'GenUI' ? 'ARMY JSON cards still render' : 'ARMY JSON alias still renders', { exact: true })).toBeVisible();
  await expect(page.getByText(/"version":1/)).toHaveCount(0);
  await expect.poll(async () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).toContain('"event":"end"');
 });
}
