import { test, expect, openChat, send, web } from './fixtures';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test.afterEach(async ({ page }, info) => {
 if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test('bare transcript URL and positioned source file open on tap', async ({ page, bridge }) => {
 await mkdir(join(bridge.dir, 'notes'));
 await writeFile(join(bridge.dir, 'notes', 'army.md'), 'first line\nARMY_POSITIONED_SOURCE\nthird line\n');
 const destination = new URL('/#army-link-target', web).href;
 await openChat(page, bridge);
 await send(page, 'ARMY_CHAT_LINKS ' + destination);
 const file = page.getByRole('link', { name: 'notes/army.md:2:3', exact: true });
 await expect(file).toBeVisible();
 await expect(page.getByRole('link', { name: 'notes/army.md:1', exact: true })).toHaveCount(0);
 await file.click();
 const preview = page.getByTestId('file-link-preview');
 await expect(preview).toContainText('line 2:3');
 await expect(preview).toContainText('ARMY_POSITIONED_SOURCE');
 await page.getByRole('button', { name: 'Close file preview', exact: true }).click();
 await expect(preview).toHaveCount(0);
 const link = page.getByRole('link', { name: destination, exact: true });
 const popup = page.waitForEvent('popup');
 await link.click();
 const external = await popup;
 await expect(external).toHaveURL(destination);
 await external.close();
});

test('slash and at prompts reach the ACP agent verbatim', async ({ page, bridge }) => {
 await openChat(page, bridge);
 for (const prompt of ['/compact', '@file']) {
  await send(page, prompt);
  await expect(page.getByText('ARMY_STREAM_BEGIN ARMY_REPLY: ' + prompt, { exact: true })).toBeVisible();
  const events = (await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).trim().split('\n');
  expect(events.map(line => JSON.parse(line))).toContainEqual(expect.objectContaining({ event: 'start', text: prompt }));
 }
});
