import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createBridge, expect, LONG_HERMES_TITLE, pair, test } from './fixtures';

test('reopening a native chat refreshes source text for the same message id', async ({ page }, info) => {
  const bridge = await createBridge(true, { env: { ARMY_LONG_HERMES: '30' } });
  const oldPrompt = 'ARMY hermes prompt 001';
  const currentPrompt = 'ARMY reopened current prompt 001';
  try {
    await pair(page, bridge);
    const row = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]')
      .filter({ has: page.getByText(LONG_HERMES_TITLE, { exact: true }) });
    await expect(row).toHaveCount(1);
    const rail = page.getByRole('slider', { name: 'Prompt navigator', exact: true });
    const preview = page.getByLabel('Turn preview', { exact: true });
    const selectFirst = async () => {
      await expect(rail.getByTestId('rail-tick')).toHaveCount(30);
      const box = await rail.boundingBox();
      if (!box) throw Error('Source prompt rail has no rendered bounds');
      await page.mouse.click(box.x + box.width / 2, box.y + 1);
    };

    await row.click();
    await expect(page.getByText(/^ARMY hermes answer 030 /)).toBeVisible();
    await selectFirst();
    await expect(preview).toContainText(oldPrompt);
    // Ensure this older source row has moved from the rail-only page into the list.
    await page.getByRole('button', { name: 'Jump', exact: true }).click();
    await page.getByRole('button', { name: 'Close turn preview', exact: true }).click();
    await expect(page.getByTestId('transcript-viewport').getByText(oldPrompt, { exact: true })).toBeInViewport();

    // Rewrite the *same native row*: the id, timestamp and keyset cursor do not change.
    const writer = spawn(process.env.ARMY_BUN || 'bun', ['-e', `
      const { Database } = require('bun:sqlite');
      const [path, oldText, newText] = process.argv.slice(1);
      const db = new Database(path);
      db.exec('PRAGMA busy_timeout=5000');
      const changed = db.query('UPDATE messages SET content=? WHERE session_id=? AND role=? AND content=?')
        .run(newText, 'army-long-hermes', 'user', oldText).changes;
      db.close();
      process.exit(changed === 1 ? 0 : 1);
    `, join(bridge.dir, '.hermes', 'state.db'), oldPrompt, currentPrompt], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    writer.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const [code] = await once(writer, 'exit');
    expect(code, stderr || 'native source update failed').toBe(0);

    // Closing only changes presentation; the cached conversation id survives.
    // A new visit must not reuse its former listed or unlisted native text.
    await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText(/^ARMY hermes answer 030 /)).toBeVisible();
    await selectFirst();
    await expect(preview).toContainText(currentPrompt, { timeout: 12_000 });
    await expect(preview).not.toContainText(oldPrompt);
    await page.getByRole('button', { name: 'Jump', exact: true }).click();
    await page.getByRole('button', { name: 'Close turn preview', exact: true }).click();
    await expect(page.getByTestId('transcript-viewport').getByText(currentPrompt, { exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('final.png') });
  } finally {
    await bridge.dispose();
  }
});
