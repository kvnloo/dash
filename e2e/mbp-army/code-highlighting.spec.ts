import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, send } from './fixtures';

test.use({ bridgeOptions: { generatedUI: true } });
test.afterEach(async ({ page }, info) => {
 if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('JSX and TSX replies preserve code and visibly distinguish syntax', async ({ page, bridge }) => {
 await openChat(page, bridge);
 await send(page, 'ARMY_CODE_TSX');
 for (const [language, source, tag] of [
  ['tsx', 'const card = <Panel title="Dash" />;', 'Panel'],
  ['jsx', 'const badge = <Badge label="Ready" />;', 'Badge'],
 ]) {
  await expect(page.getByRole('button', { name: `Copy ${language} code`, exact: true })).toBeVisible();
  const code = page.getByText(source, { exact: true });
  await expect(code).toBeVisible();
  const keyword = code.getByText('const', { exact: true });
  const component = code.getByText(tag, { exact: true });
  await expect(keyword).toBeVisible();
  await expect(component).toBeVisible();
  const keywordColor = await keyword.evaluate(element => getComputedStyle(element).color);
  const componentColor = await component.evaluate(element => getComputedStyle(element).color);
  expect(keywordColor).not.toBe(componentColor);
 }
 await expect.poll(async () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).toContain('"event":"end"');
});
