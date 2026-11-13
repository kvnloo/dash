import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright/test';
import { test, expect, openChat, chatRow, composer, send, createBridge, type Bridge } from './fixtures';

async function selectEndpoint(page: Page, bridge: Bridge) {
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${bridge.port}`);
  await page.getByLabel('Token', { exact: true }).fill((await readFile(join(bridge.dir, '.dash', 'token'), 'utf8')).trim());
  await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
  await chatRow(page).click();
  await expect(page.getByTestId('chat-window')).toBeVisible();
}

test('endpoint switch parks A stream and queue, B receives neither, A resumes once', async ({ page, bridge: a }, info) => {
  const b = await createBridge();
  const wire: { endpoint: string; direction: string; type: string; id?: string; sessionId?: string; text?: string; turns?: { id: string; seq: number }[] }[] = [];
  page.on('websocket', socket => {
    const endpoint = new URL(socket.url()).host;
    const record = (direction: string, payload: string | Buffer) => {
      try {
        const m = JSON.parse(String(payload));
        wire.push({ endpoint, direction, type: m.type, id: m.id, sessionId: m.sessionId, text: m.text, turns: m.turns });
      } catch { /* Non-JSON transport frame. */ }
    };
    socket.on('framesent', f => record('out', f.payload));
    socket.on('framereceived', f => record('in', f.payload));
  });
  const prompt = 'ARMY_HOLD endpoint A owned stream';
  const queued = 'endpoint A queued draft';
  const starts = async (bridge: Bridge) => {
    try { return (await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => row.event === 'start'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  };
  try {
    await openChat(page, a);
    await send(page, prompt);
    await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
    await expect.poll(() => wire.find(f => f.direction === 'in' && f.type === 'session')?.sessionId).toBeTruthy();
    const session = wire.find(f => f.direction === 'in' && f.type === 'session')!.sessionId;
    const first = wire.find(f => f.direction === 'out' && f.type === 'chat' && f.text === prompt)!;
    await composer(page).fill(queued);
    await page.getByRole('button', { name: 'Queue', exact: true }).click();
    await selectEndpoint(page, b);
    await expect.poll(() => wire.some(f => f.endpoint === `127.0.0.1:${b.port}` && f.type === 'hello')).toBe(true);
    await expect(page.getByText(/This chat belongs to/).first()).toBeVisible();
    // A completes while B is selected. Only a later A attach may apply its completion.
    await writeFile(join(a.dir, 'army-release'), 'release\n');
    await expect.poll(async () => (await readFile(join(a.dir, 'army-acp-turns.jsonl'), 'utf8')).includes('"event":"end"')).toBe(true);
    expect(wire.filter(f => f.endpoint === `127.0.0.1:${b.port}` && f.direction === 'out' && ['attach', 'chat'].includes(f.type))).toEqual([]);
    expect(await starts(b)).toEqual([]);
    await selectEndpoint(page, a);
    await expect(page.getByText(`ARMY_STREAM_BEGIN ARMY_REPLY: ${queued}`, { exact: true })).toBeVisible({ timeout: 30000 });
    expect(wire.filter(f => f.endpoint === `127.0.0.1:${a.port}` && f.direction === 'out' && f.type === 'attach' && f.turns?.some(turn => turn.id === first.id))).toHaveLength(1);
    const replay = wire.filter(f => f.direction === 'out' && f.type === 'chat' && f.text === queued);
    expect(replay).toHaveLength(1);
    expect(replay[0].sessionId).toBe(session);
    expect((await starts(a)).filter(row => row.text === prompt)).toHaveLength(1);
    expect((await starts(a)).filter(row => row.text === queued)).toHaveLength(1);
    expect(await starts(b)).toEqual([]);
  } finally {
    await writeFile(info.outputPath('endpoint-wire.json'), JSON.stringify(wire, null, 2));
    await b.dispose();
  }
});
