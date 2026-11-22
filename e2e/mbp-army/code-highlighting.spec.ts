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

// #518: more grammars, and hierarchy inside the one-accent palette: keywords gold, comments dim italic.
test('Go, Rust, SQL and YAML replies highlight keywords and dim italic comments', async ({ page, bridge }) => {
 await openChat(page, bridge);
 await send(page, 'ARMY_CODE_MORE');
 const style = (el: import('playwright/test').Locator) => el.evaluate(element => { const s = getComputedStyle(element); return { color: s.color, italic: s.fontStyle === 'italic' }; });
 const colors: string[] = [];
 for (const [language, keyword, comment] of [['go', 'func', '// entry'], ['rust', 'fn', '// entry'], ['sql', 'SELECT', '-- entry'], ['yml', 'name', '# entry']] as const) {
  await expect(page.getByRole('button', { name: `Copy ${language} code`, exact: true })).toBeVisible();
  const block = page.getByRole('button', { name: `Copy ${language} code`, exact: true }).locator('xpath=ancestor::*[.//*[contains(text(), "entry")]][1]');
  const kw = block.getByText(keyword, { exact: true }).first();
  const cm = block.getByText(comment, { exact: true }).first();
  const k = await style(kw), c = await style(cm);
  expect(c.italic, `${language} comment is italic`).toBe(true);
  expect(k.italic, `${language} keyword is upright`).toBe(false);
  expect(k.color, `${language} keyword and comment differ`).not.toBe(c.color);
  if (language !== 'yml') colors.push(k.color);
 }
 expect(new Set(colors).size, 'one accent: every language keyword uses the same gold').toBe(1);
 await expect.poll(async () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).toContain('"event":"end"');
});
