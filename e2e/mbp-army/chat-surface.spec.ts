import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { test, expect, pair, createBridge, web } from './fixtures';

test('Hermes surface selection follows the transcript or Live surface', async ({ page }, info) => {
  const token = randomUUID();
  const tokenFile = info.outputPath('broker.token');
  await mkdir(dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, token, { mode: 0o600 });
  const paths: string[] = [];
  const host = new URL(web).hostname;
  // Stand in for the external FX broker, not the Dash protocol or app. The real
  // bridge must attach a worker and return live_opened before the surface is ready.
  const broker = createServer((req, res) => {
    const path = new URL(req.url ?? '/', web).pathname;
    if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401).end(); return; }
    paths.push(path);
    const body = path === '/v1/sessions' ? (req.method === 'POST' ? { id: 'surface-parent' } : { sessions: [{ id: 'surface-worker' }] })
      : path === '/v1/sessions/fx/default/surface-worker' ? { id: 'surface-worker', parent: { id: 'surface-parent' } }
      : path.endsWith('/artifacts') ? { artifacts: [] }
      : path.endsWith('/receipts') ? { receipts: [] }
      : path === '/v1/harnesses' ? { harnesses: [{ id: 'fx', version: 'fixture' }] } : undefined;
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(body ?? {}));
  }).listen(0, host);
  await once(broker, 'listening');
  try {
    const addr = broker.address();
    if (!addr || typeof addr === 'string') throw Error('Fixture broker needs a TCP port');
    const bridge = await createBridge(true, { env: {
      DASH_Z0BRIDGE_URL: `http://${host}:${addr.port}`,
      DASH_Z0BRIDGE_TOKEN_FILE: tokenFile,
    } });
    try {
      await pair(page, bridge);
      await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click();
      await page.getByRole('button', { name: 'Choose harness', exact: true }).click();
      await page.getByRole('button', { name: 'Hermes', exact: true }).click();
      await page.getByRole('button', { name: 'Chat options', exact: true }).click();

      const surfaces = page.getByRole('tablist', { name: 'Chat surface' });
      const chat = surfaces.getByRole('tab', { name: 'Hermes chat' });
      const live = surfaces.getByRole('tab', { name: 'Live surface' });
      const selected = surfaces.getByRole('tab', { selected: true });
      const transcript = page.getByTestId('transcript-viewport');
      const liveView = page.getByTestId('live-surface');
      await expect(selected).toHaveCount(1);
      await expect(chat).toHaveAttribute('aria-selected', 'true');
      await expect(transcript).toBeVisible();
      await page.screenshot({ path: info.outputPath('hermes-chat.png') });

      await live.click();
      await expect(selected).toHaveCount(1);
      await expect(live).toHaveAttribute('aria-selected', 'true');
      await expect(transcript).toHaveCount(0);
      await expect(liveView).toBeVisible();
      await page.screenshot({ path: info.outputPath('live-surface.png') });

      await live.click();
      await expect(live).toHaveAttribute('aria-selected', 'true');
      await chat.click();
      await expect(selected).toHaveCount(1);
      await expect(chat).toHaveAttribute('aria-selected', 'true');
      await expect(transcript).toBeVisible();
      expect(paths.filter(path => path === '/v1/sessions/fx/default/surface-worker/artifacts')).toHaveLength(1);

      // Opening the same chat from the list uses the window dock's Surface picker.
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByTestId('chats-pane').getByRole('button', { name: /^Hermes · idle New chat / }).click();
      const options = page.getByRole('radiogroup', { name: 'Surface options' });
      const showChoices = async (surface: string) => {
        await page.getByRole('button', { name: 'Options. Current surface: ' + surface, exact: true }).click();
        await expect(options).toBeVisible();
      };
      await showChoices('Chat');
      await expect(options.getByRole('radio', { checked: true })).toHaveCount(1);
      await expect(options.getByRole('radio', { name: 'Hermes chat' })).toBeChecked();
      await page.screenshot({ path: info.outputPath('window-hermes-chat.png') });
      await options.getByRole('radio', { name: 'Live surface' }).click();
      await expect(liveView).toBeVisible();
      await showChoices('Live surface');
      await expect(options.getByRole('radio', { checked: true })).toHaveCount(1);
      await expect(options.getByRole('radio', { name: 'Live surface' })).toBeChecked();
      await page.screenshot({ path: info.outputPath('window-live-surface.png') });
      await options.getByRole('radio', { name: 'Hermes chat' }).click();
      await expect(transcript).toBeVisible();
    } finally {
      await bridge.dispose();
      await writeFile(info.outputPath('bridge.log'), bridge.logs());
    }
  } finally {
    broker.close();
    broker.closeAllConnections();
    await once(broker, 'close');
  }
});
