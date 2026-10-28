import { test, expect, pair } from './fixtures';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseOrchestra } from '../../shared/orchestra';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test.describe('Hermes child sessions are not top-level chats', () => {
  test.use({ bridgeOptions: { subagents: true }, viewport: { width: 390, height: 844 } });

  test('delegated Hermes children never become top-level chats and ended workers never mount in Orchestra', async ({ page, bridge }) => {
    await pair(page, bridge);
    const chats = page.getByTestId('chats-pane');
    const parent = chats.locator('[data-testid^=chat-row-]').filter({ hasText: 'ARMY native fixture' });
    await expect(parent).toHaveCount(1, { timeout: 30000 });

    // The real Hermes SQLite fixture has three parent_session_id children.
    // None of their titles belongs to an independent Chats row.
    for (const title of ['ARMY worker verify', 'ARMY worker review', 'ARMY worker done']) {
      await expect(chats.getByText(title, { exact: true })).toHaveCount(0);
    }

    await page.getByRole('tab').nth(2).click({ noWaitAfter: true });
    await expect(page.getByTestId('orchestra-graph')).toBeVisible();
    // The read-only history count survives, but a finished child has no rendered card or tree.
    await expect(page.getByText('subagent 3 · 1 live', { exact: true })).toHaveCount(1);
    await expect(page.getByText('ARMY worker done', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Lineage', exact: true }).click({ noWaitAfter: true });
    await expect(page.getByText('ARMY worker done', { exact: true })).toHaveCount(0);

    // The actual bridge supplies the lineage; this is not a mocked HTTP response.
    const token = (await readFile(join(bridge.dir, '.dash/token'), 'utf8')).trim();
    const response = await fetch(`http://127.0.0.1:${bridge.port}/orchestra/graph`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const graph = parseOrchestra(await response.json());
    if (!graph) throw Error('Orchestra response failed the shared protocol');
    const root = graph.nodes.find(node => node.sessionId === 'army-fixture-session');
    expect(root?.kind).toBe('chat');
    for (const sessionId of ['army-worker-verify', 'army-worker-review', 'army-worker-done']) {
      const child = graph.nodes.find(node => node.sessionId === sessionId);
      expect(child?.kind).toBe('subagent');
      expect(child?.parentId).toBe(root?.id);
    }
    expect(graph.nodes.find(node => node.sessionId === 'army-worker-done')?.state).toBe('done');
  });
});
