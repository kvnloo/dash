import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { test, expect, createBridge, openChat, chatRow, composer, send, type Bridge } from './fixtures';

const sessionId = 'army-fixture-session';
const savedPrompt = 'ARMY saved unknown owner must not become the live target';
const livePrompt = 'ARMY exact paired live owner continuation';
const liveTitle = basename(process.env.ARMY_BRIDGE_ROOT || resolve(__dirname, '../..'));

type Owner = { host: string; self: boolean; profile: string };
function record(value: unknown): value is Record<string, unknown> {
 return typeof value === 'object' && value !== null;
}
async function runningOwners(bridge: Bridge): Promise<Owner[]> {
 const token = (await readFile(join(bridge.dir, '.dash', 'token'), 'utf8')).trim();
 const response = await fetch(`http://127.0.0.1:${bridge.port}/roster`, { headers: { Authorization: `Bearer ${token}` } });
 expect(response.status).toBe(200);
 const body: unknown = await response.json();
 if (!record(body) || !Array.isArray(body.hosts)) throw Error('Real bridge roster must contain hosts');
 const owners: Owner[] = [];
 for (const host of body.hosts) {
  if (!record(host) || typeof host.id !== 'string' || !Array.isArray(host.agents)) continue;
  for (const agent of host.agents) {
   if (record(agent) && agent.kind === 'omp' && agent.sessionId === sessionId && agent.status === 'running' && typeof agent.id === 'string') {
    owners.push({ host: host.id, self: host.self === true, profile: agent.id });
   }
  }
 }
 await writeFile(join(bridge.dir, 'live-search-roster.json'), JSON.stringify(body, null, 2));
 return owners;
}

test('live search restores the paired OMP owner after local deletion without opening an ambiguous saved chat', async ({ page }, info) => {
 const peerSignal = info.outputPath('release-mbp-holder');
 const selfSignal = info.outputPath('release-groot-holder');
 const peer = await createBridge(false, { rosterHost: 'mbp', env: { ARMY_PERSIST_SESSION: '1', ARMY_SESSION_HOLDER_WAIT: peerSignal } });
 let bridge: Bridge | undefined;
 try {
  bridge = await createBridge(false, { rosterHost: 'groot', rosterPeer: peer, env: { ARMY_PERSIST_SESSION: '1', ARMY_SESSION_HOLDER_WAIT: selfSignal } });
  const paired = bridge;
  await openChat(page, paired);
  await expect(page.getByTestId('chat-window-badge')).toContainText('OMP');
  await send(page, savedPrompt);
  await expect(page.getByText('ARMY_STREAM_BEGIN ARMY_REPLY: ' + savedPrompt, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
  expect(await runningOwners(paired)).toEqual([]);

  // Emulate an upgraded saved chat that predates confirmed ACP host binding.
  // A new chat now records that binding from its authenticated session event.
  const savedRowId = await chatRow(page).getAttribute('data-testid');
  if (!savedRowId) throw Error('Missing real saved chat row');
  const savedId = savedRowId.slice('chat-row-'.length);
  await expect.poll(() => page.evaluate(id => {
   const entries = JSON.parse(localStorage.getItem('dash.conversations.index.v3') || '[]');
   return entries.some((c: { id: string; sessionId?: string; targetHostId?: string }) =>
    c.id === id && c.sessionId === 'army-fixture-session' && c.targetHostId === 'groot');
  }, savedId)).toBe(true);
  await page.evaluate(id => {
   const key = 'dash.conversations.index.v3';
   const entries = JSON.parse(localStorage.getItem(key)!);
   const chat = entries.find((c: { id: string }) => c.id === id);
   if (!chat?.endpointAddress) throw Error('Missing UI-owned durable source');
   delete chat.targetHostId; delete chat.profileId; chat.stale = true;
   for (const area of ['durable', 'cache']) {
    const file = `dash.${area}.files.v2/${encodeURIComponent(id)}.json`;
    const raw = localStorage.getItem(file);
    if (!raw) { if (area === 'durable') throw Error('Missing durable file'); continue; }
    const record = JSON.parse(raw);
    delete record.targetHostId; delete record.profileId; record.stale = true;
    localStorage.setItem(file, JSON.stringify(record));
   }
   localStorage.setItem(key, JSON.stringify(entries));
  }, savedId);
  await page.reload();
  await page.getByRole('tab').nth(1).click();
  await page.context().setOffline(true);
  await paired.stop();
  await writeFile(peerSignal, 'release\n');
  await expect.poll(() => runningOwners(peer), { timeout: 25000 }).toEqual([
   { host: 'mbp', self: true, profile: expect.stringMatching(/^omp:/) },
  ]);
  await writeFile(selfSignal, 'release\n');
  await paired.start();
  await expect.poll(async () => (await runningOwners(paired)).map(owner => owner.host).sort(), { timeout: 25000 }).toEqual(['groot', 'mbp']);
  await writeFile(info.outputPath('owners.json'), JSON.stringify(await runningOwners(paired), null, 2));
  await page.context().setOffline(false);

  const liveRow = page.getByTestId('chat-row-live:omp:' + sessionId);
  await expect(liveRow).toBeVisible({ timeout: 30000 });
  await liveRow.scrollIntoViewIfNeeded();
  const box = await liveRow.boundingBox();
  if (!box) throw Error('The native live chat row must have a visible long-press target');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const deleteAction = page.getByRole('button', { name: new RegExp(`^Delete ${liveTitle} from this phone(?:, \\d+ of \\d+)?$`) });
  try { await expect(deleteAction).toBeVisible(); } finally { await page.mouse.up(); }
  page.once('dialog', dialog => {
   expect(dialog.message()).toBe('Delete chat?\n\nThis removes it from this phone only.');
   void dialog.accept();
  });
  await deleteAction.click();
  await expect(liveRow).toHaveCount(0);
  await expect(chatRow(page)).toBeVisible();
  await expect(chatRow(page)).toContainText(savedPrompt.slice(0, 30));
  await composer(page).fill('/live ' + sessionId);
  const result = page.getByRole('button').filter({ hasText: liveTitle }).filter({ hasText: 'Chat' });
  await expect(result).toHaveCount(1, { timeout: 30000 });
  await expect(result).not.toContainText(savedPrompt);
  await expect(page.getByRole('button').filter({ hasText: savedPrompt })).toHaveCount(0);
  await result.click();
  await expect(composer(page)).toBeVisible();
  await expect(page.getByText('on groot', { exact: true })).toBeVisible();
  await expect(page.getByTestId('transcript-viewport')).not.toContainText(savedPrompt);
  await send(page, livePrompt);
  await expect(page.getByTestId('transcript-viewport').getByText('ARMY_STREAM_BEGIN ARMY_REPLY: ' + livePrompt, { exact: true })).toBeVisible();

  // The exact scoped conversation is reusable on the next search, including its reply.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await composer(page).fill('/live ' + sessionId);
  await expect(result).toHaveCount(1);
  await expect(result).toContainText(livePrompt);
  await result.click();
  await expect(composer(page)).toBeVisible();
  await expect(page.getByTestId('transcript-viewport')).toContainText(livePrompt);
  await expect(page.getByTestId('transcript-viewport')).not.toContainText(savedPrompt);

  const calls = await readFile(join(paired.dir, 'army-acp-calls.jsonl'), 'utf8');
  expect(calls).toContain('"method":"session/load"');
  expect(calls).toContain('"sessionId":"' + sessionId + '"');
  expect(peer.logs()).not.toContain('turn.start');
  await writeFile(info.outputPath('paired-acp-calls.jsonl'), calls);
  await page.screenshot({ path: info.outputPath('final.png') });
 } finally {
  await page.context().setOffline(false);
  if (bridge) {
   await writeFile(info.outputPath('bridge.log'), bridge.logs());
   await bridge.dispose();
  }
  await writeFile(info.outputPath('peer-bridge.log'), peer.logs());
  await peer.dispose();
 }
});
