import { test, expect, createBridge, pair, openChat, send, composer, LONG_HERMES_TITLE } from './fixtures';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright/test';

async function leaveChat(page: Page) {
  const window = page.getByTestId('chat-window');
  if (await window.isVisible()) {
    await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
    await expect(window).toBeHidden();
  } else await page.getByRole('button', { name: 'Back', exact: true }).click();
  await composer(page).fill('');
  await page.getByRole('tab').nth(1).click();
  await expect(page.getByTestId('chats-pane')).toBeVisible();
}

for (const owner of ['legacy', 'foreign', 'unscoped']) for (const activation of ['list', 'search']) {
  test(`saved ${owner} native chat coexists with resumable ${activation} rows`, async ({ page }, info) => {
    const bridge = await createBridge(true, { env: { ARMY_LONG_HERMES: '2' } });
    const wire: { type: string; text?: string; sessionId?: string }[] = [];
    page.on('websocket', socket => socket.on('framesent', frame => {
      try { const m = JSON.parse(String(frame.payload)); wire.push({ type: m.type, text: m.text, sessionId: m.sessionId }); } catch { /* Non-JSON frame. */ }
    }));
    try {
      await pair(page, bridge);
      const pane = page.getByTestId('chats-pane');
      const titled = pane.locator('[data-testid^="chat-row-"]').filter({ has: page.getByText(LONG_HERMES_TITLE, { exact: true }) });
      await titled.click();
      await expect(page.getByText(/^ARMY hermes answer 002 /)).toBeVisible();
      const draft = `preserve ${owner} native draft`;
      await composer(page).fill(draft);
      // External upgrade input comes from the real UI's durable files, not a debug store.
      await expect.poll(() => page.evaluate(({ draft }) => {
        const entries = JSON.parse(localStorage.getItem('dash.conversations.index.v3') || '[]');
        const chat = entries.find((c: { sessionId?: string }) => c.sessionId === 'army-long-hermes');
        const drafts = JSON.parse(localStorage.getItem('dash.composerDrafts.v1') || '{}');
        return chat && drafts[chat.id]?.text === draft;
      }, { draft })).toBeTruthy();
      await page.evaluate(({ owner }) => {
        const key = 'dash.conversations.index.v3';
        const entries = JSON.parse(localStorage.getItem(key)!);
        const chat = entries.find((c: { sessionId?: string }) => c.sessionId === 'army-long-hermes');
        if (!chat?.endpointAddress) throw Error('Missing UI-owned durable source');
        if (owner === 'legacy') delete chat.endpointAddress;
        else if (owner === 'foreign') chat.endpointAddress = 'other-computer.invalid:1234';
        else { delete chat.targetHostId; delete chat.profileId; chat.stale = true; }
        for (const area of ['durable', 'cache']) {
          const file = `dash.${area}.files.v2/${encodeURIComponent(chat.id)}.json`;
          const raw = localStorage.getItem(file);
          if (!raw) { if (area === 'durable') throw Error('Missing durable file'); continue; }
          const record = JSON.parse(raw);
          if (owner === 'legacy') delete record.endpointAddress;
          else if (owner === 'foreign') record.endpointAddress = chat.endpointAddress;
          else { delete record.targetHostId; delete record.profileId; record.stale = true; }
          localStorage.setItem(file, JSON.stringify(record));
        }
        localStorage.setItem(key, JSON.stringify(entries));
      }, { owner });
      await page.reload();
      const close = page.getByRole('button', { name: 'Close chat window', exact: true });
      if (await close.isVisible()) await close.click();
      await page.getByRole('tab').nth(1).click();
      const savedRow = titled.filter({ has: page.getByLabel('Saved local history', { exact: true }) });
      const nativeRow = titled.filter({ hasNot: page.getByLabel('Saved local history', { exact: true }) });
      await expect(savedRow).toHaveCount(1);
      await expect(nativeRow).toHaveCount(1);
      await savedRow.click();
      await expect(composer(page)).toHaveValue(draft);
      await expect(page.getByText(/^ARMY hermes answer 002 /)).toBeVisible();
      if (owner === 'unscoped') await expect(page.getByText(/This saved session has no verified host/)).toBeVisible();
      await leaveChat(page);
      if (activation === 'search') {
        await composer(page).fill(LONG_HERMES_TITLE);
        const current = page.getByRole('button').filter({ has: page.getByText(LONG_HERMES_TITLE, { exact: true }) }).filter({ has: page.getByText(/^Chat · (?!saved local)/) });
        await expect(page.getByText('Chat · saved local', { exact: true })).toBeVisible();
        await current.click();
        await expect(page.getByRole('heading', { name: LONG_HERMES_TITLE, exact: true })).toBeVisible();
      } else {
        await nativeRow.click();
        await expect(page.getByTestId('chat-window')).toBeVisible();
      }
      const prompt = `resume current ${owner} native session`;
      await send(page, prompt);
      await expect(page.getByText(`ARMY_STREAM_BEGIN ARMY_REPLY: ${prompt}`, { exact: true })).toBeVisible();
      expect(wire.filter(m => m.type === 'chat' && m.text === prompt).map(m => m.sessionId)).toEqual(['army-long-hermes']);
      await leaveChat(page);
      await savedRow.click();
      await expect(composer(page)).toHaveValue(draft);
      await leaveChat(page);
      // Use ordinary global chat search; each selected row retains its actual identity.
      const search = composer(page);
      await search.fill(LONG_HERMES_TITLE);
      await expect(page.getByText('Chat · saved local', { exact: true })).toBeVisible();
      await expect(page.getByText(LONG_HERMES_TITLE, { exact: true }).count()).resolves.toBeGreaterThanOrEqual(2);
      const durable = await page.evaluate(() => JSON.parse(localStorage.getItem('dash.conversations.index.v3')!));
      expect(durable.filter((c: { sessionId?: string }) => c.sessionId === 'army-long-hermes')).toHaveLength(2);
      if (owner !== 'unscoped') expect(durable.find((c: { endpointAddress?: string }) => c.endpointAddress !== `127.0.0.1:${bridge.port}`)?.endpointAddress).toBe(owner === 'legacy' ? undefined : 'other-computer.invalid:1234');
      else expect(durable.filter((c:{endpointAddress?:string;sessionId?:string})=>c.sessionId==='army-long-hermes'&&c.endpointAddress===`127.0.0.1:${bridge.port}`)).toHaveLength(2);
      const starts = (await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(starts.filter(row => row.event === 'start' && row.text === prompt)).toHaveLength(1);
      await writeFile(info.outputPath('legacy-recovery-wire.json'), JSON.stringify(wire));
    } finally { await bridge.dispose(); }
  });
}

for (const owner of ['legacy', 'foreign', 'current']) {
  test(`harness search reuses only current endpoint empty chat ${owner}`, async ({ page, bridge }) => {
    await openChat(page, bridge);
    await composer(page).fill(`preserve empty ${owner} draft`);
    await expect.poll(() => page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('dash.conversations.index.v3') || '[]');
      return rows.find((c: { harness?: string; sessionId?: string; targetHostId?: string }) => c.harness === 'omp' && !c.sessionId && !c.targetHostId)?.id;
    })).toBeTruthy();
    await expect.poll(() => page.evaluate(({ owner }) => {
      const drafts = JSON.parse(localStorage.getItem('dash.composerDrafts.v1') || '{}');
      return Object.values(drafts).some(d => d !== null && typeof d === 'object' && 'text' in d && d.text === `preserve empty ${owner} draft`);
    }, { owner })).toBe(true);
    const originalId = await page.evaluate(({ owner }) => {
      const key = 'dash.conversations.index.v3';
      const rows = JSON.parse(localStorage.getItem(key)!);
      const chat = rows.find((c: { harness?: string; sessionId?: string; targetHostId?: string }) => c.harness === 'omp' && !c.sessionId && !c.targetHostId);
      if (owner === 'legacy') delete chat.endpointAddress;
      if (owner === 'foreign') chat.endpointAddress = 'other-computer.invalid:1234';
      const file = `dash.durable.files.v2/${encodeURIComponent(chat.id)}.json`;
      const record = JSON.parse(localStorage.getItem(file)!);
      if (owner === 'legacy') delete record.endpointAddress;
      if (owner === 'foreign') record.endpointAddress = chat.endpointAddress;
      localStorage.setItem(file, JSON.stringify(record));
      localStorage.setItem(key, JSON.stringify(rows));
      return chat.id;
    }, { owner });
    await page.reload();
    const close = page.getByRole('button', { name: 'Close chat window', exact: true });
    if (await close.isVisible()) await close.click();
    await composer(page).fill('/harness OMP');
    await page.getByRole('button').filter({ has: page.getByText('OMP', { exact: true }) }).filter({ has: page.getByText('Harness', { exact: true }) }).click();
    await expect(page.getByRole('heading', { name: 'New chat', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(({ originalId, owner }) => {
      const selected = localStorage.getItem('dash.activeId.v1');
      return Boolean(selected) && (owner === 'current' ? selected === originalId : selected !== originalId);
    }, { originalId, owner })).toBe(true);
    if (owner === 'current') await expect(composer(page)).toHaveValue(`preserve empty ${owner} draft`);
    else {
      await expect(composer(page)).toHaveValue('');
      await leaveChat(page);
      await page.getByTestId(`chat-row-${originalId}`).click();
      await expect(composer(page)).toHaveValue(`preserve empty ${owner} draft`);
    }
  });
}
