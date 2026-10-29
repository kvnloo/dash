import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright/test';
import { test, expect, pair, openChat, composer, send, createBridge, type Bridge } from './fixtures';

test.use({ viewport: { width: 390, height: 844 }, persistSession: false, bridgeOptions: { archiveClaude: true } });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

const card = (page: Page) => page.getByTestId('next-action-card');
const visibleText = (page: Page, text: string) => page.getByText(text, { exact: false }).filter({ visible: true }).first();

async function expectReadReplyFor(page: Page, chatTitle: string) {
  await expect(page.getByTestId('next-action-title')).toContainText(chatTitle);
}

async function toChats(page: Page) {
  const close = page.getByRole('button', { name: /^(Back|Close chat window)$/ }).first();
  if (await close.isVisible()) await close.click({ noWaitAfter: true });
  await page.getByRole('tab').nth(1).click({ noWaitAfter: true });
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('chats-pane')).toBeVisible();
}

async function newChat(page: Page) {
  await toChats(page);
  await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  await expect(composer(page)).toBeVisible();
}

async function turnEvents(dir: string, event: 'start' | 'end' = 'start') {
  const raw = await readFile(join(dir, 'army-acp-turns.jsonl'), 'utf8').catch(() => '');
  return raw.split('\n').filter(line => line.includes(`"event":"${event}"`)).length;
}

async function expectControlsAtPhoneSize(page: Page) {
  for (const id of ['next-action-do', 'next-action-later', 'next-action-skip', 'next-action-why']) {
    const control = page.getByTestId(id);
    await expect(control).toBeInViewport({ ratio: 1 });
    const bounds = await control.boundingBox();
    expect(bounds, `${id} has bounds`).not.toBeNull();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
}

test('Next up opens the exact completed background reply without sending and preserves the other chat draft', async ({ page, bridge }, info) => {
  await openChat(page, bridge);
  for (let index = 0; index < 8; index++) {
    await send(page, `Earlier attention history ${index}`);
    await expect(visibleText(page, `ARMY_REPLY: Earlier attention history ${index}`)).toBeVisible();
  }
  await send(page, 'ARMY_HOLD A attention reply');
  await expect(visibleText(page, 'ARMY_STREAM_BEGIN')).toBeVisible();

  await newChat(page);
  await composer(page).fill('B draft must survive attention navigation');
  await toChats(page);
  const aRow = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ hasText: 'Earlier attention history 0' });
  await aRow.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  const viewport = await page.getByTestId('transcript-viewport').boundingBox();
  if (!viewport) throw Error('No transcript viewport');
  await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
  await page.mouse.wheel(0, -10000);
  await expect(page.getByTestId('transcript-viewport').getByText('Earlier attention history 0', { exact: true })).toBeInViewport();
  await writeFile(join(bridge.dir, 'army-release'), '');
  await expect.poll(() => turnEvents(bridge.dir, 'end'), { timeout: 30_000 }).toBe(9);
  await toChats(page);

  await expect(card(page)).toContainText('Earlier attention history 0', { timeout: 30_000 });
  await expectControlsAtPhoneSize(page);
  const whyButton = page.getByTestId('next-action-why');
  await whyButton.click();
  await expect(page.getByTestId('next-action-reason')).toBeVisible();
  await whyButton.click();
  await expect(page.getByTestId('next-action-reason')).toHaveCount(0);

  const startsBeforeOpen = await turnEvents(bridge.dir);
  await page.getByTestId('next-action-do').click({ noWaitAfter: true });
  await expect(visibleText(page, 'ARMY_REPLY: ARMY_HOLD A attention reply')).toBeInViewport();
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeOpen);
  await page.screenshot({ path: info.outputPath('completed-reply-opened.png') });

  await toChats(page);
  await expect(card(page)).toHaveCount(0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await toChats(page);
  await expect(card(page)).toHaveCount(0);

  const draftRow = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ hasText: 'New chat' });
  await expect(draftRow).toHaveCount(1);
  await draftRow.click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue('B draft must survive attention navigation');
  await page.screenshot({ path: info.outputPath('draft-preserved.png') });
});

test('Next up Later survives reload, Skip dismisses only one completion, and a newer reply in that chat returns', async ({ page, bridge }) => {
  await pair(page, bridge);
  const firstChatTitle = 'ARMY archived Claude Code chat';
  await page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ hasText: firstChatTitle }).click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.clock.install();
  await send(page, 'ARMY_HOLD first background completion');
  await expect(visibleText(page, 'ARMY_STREAM_BEGIN')).toBeVisible();
  await newChat(page);
  await send(page, 'ARMY_HOLD second background completion');
  await expect(visibleText(page, 'ARMY_STREAM_BEGIN')).toBeVisible();
  await toChats(page);
  await writeFile(join(bridge.dir, 'army-release'), '');
  await expect.poll(() => turnEvents(bridge.dir, 'end'), { timeout: 30_000 }).toBe(2);
  await expect(card(page)).toContainText('second background completion');

  const startsBeforeLater = await turnEvents(bridge.dir);
  await page.getByTestId('next-action-later').click();
  await expectReadReplyFor(page, firstChatTitle);
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeLater);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await toChats(page);
  await expectReadReplyFor(page, firstChatTitle);
  const rows = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]');
  await page.getByTestId('next-action-skip').click();
  await expect(card(page)).toHaveCount(0);
  await expect(rows.filter({ hasText: firstChatTitle })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'second background completion' })).toHaveCount(1);
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeLater);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await toChats(page);
  await expect(card(page)).toHaveCount(0);

  await rows.filter({ hasText: firstChatTitle }).click({ noWaitAfter: true });
  await unlink(join(bridge.dir, 'army-release'));
  await send(page, 'ARMY_HOLD newer completion in the same chat');
  await expect(visibleText(page, 'ARMY_STREAM_BEGIN')).toBeVisible();
  await toChats(page);
  await writeFile(join(bridge.dir, 'army-release'), '');
  await expectReadReplyFor(page, firstChatTitle);
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeLater + 1);
  await page.getByTestId('next-action-do').click({ noWaitAfter: true });
  await expect(visibleText(page, 'ARMY_CLAUDE_REPLY: ARMY_HOLD newer completion in the same chat')).toBeInViewport();
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeLater + 1);
  await toChats(page);
  await expect(card(page)).toHaveCount(0);
  await page.clock.fastForward(60 * 60_000 + 30_000);
  await expect(card(page)).toContainText('second background completion');
});

test('Next up prioritizes a real pending ACP permission and Open never chooses it', async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, 'ARMY_HOLD background reply below permission');
  await expect(visibleText(page, 'ARMY_STREAM_BEGIN')).toBeVisible();
  await newChat(page);
  await send(page, 'ARMY_PERMISSION owner choice outranks reply');
  await toChats(page);
  await writeFile(join(bridge.dir, 'army-release'), '');

  await expect(card(page)).toContainText('owner choice outranks reply', { timeout: 30_000 });
  const startsBeforeOpen = await turnEvents(bridge.dir);
  await page.getByTestId('next-action-do').click({ noWaitAfter: true });
  await expect(page.getByRole('heading', { name: 'Needs OK', exact: true })).toBeVisible();
  await expect(page.getByTestId('permission-choice-army-allow-once')).toBeVisible();
  expect(await readFile(join(bridge.dir, 'army-acp-permissions.jsonl'), 'utf8').catch(() => '')).toBe('');
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeOpen);
  await toChats(page);
  await expect(card(page)).toContainText('owner choice outranks reply');
  await page.getByTestId('next-action-later').click();
  await expect(card(page)).toContainText('background reply below permission');
  const permissionChat = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ hasText: 'owner choice outranks reply' });
  await expect(permissionChat).toHaveCount(1);
  await permissionChat.click({ noWaitAfter: true });
  await page.getByTestId('permission-choice-army-allow-once').click();
  await expect.poll(async () => readFile(join(bridge.dir, 'army-acp-permissions.jsonl'), 'utf8').catch(() => '')).toContain('"response":{"outcome":{"outcome":"selected","optionId":"army-allow-once"}}');
  await expect(visibleText(page, 'ARMY_PERMISSION_SELECTED')).toBeVisible();
  await toChats(page);
  await expectReadReplyFor(page, 'ARMY_HOLD background reply below permission');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await toChats(page);
  await expectReadReplyFor(page, 'ARMY_HOLD background reply below permission');
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeOpen);
});

test('Next up surfaces a newer same-chat reply after the browser clock moves backward', async ({ page, bridge }) => {
  await openChat(page, bridge);
  await page.clock.install();
  await send(page, 'reply read before browser clock rollback');
  await expect(visibleText(page, 'ARMY_REPLY: reply read before browser clock rollback')).toBeInViewport();
  await page.clock.setSystemTime(new Date(Date.now() - 24 * 60 * 60_000));

  await send(page, 'ARMY_HOLD newer reply after browser clock rollback');
  await expect(visibleText(page, 'ARMY_STREAM_BEGIN')).toBeVisible();
  await newChat(page);
  await composer(page).fill('draft survives browser clock rollback attention');
  await toChats(page);
  await writeFile(join(bridge.dir, 'army-release'), '');
  await expect.poll(() => turnEvents(bridge.dir, 'end'), { timeout: 30_000 }).toBe(2);

  await expect(card(page)).toContainText('reply read before browser clock rollback');
  const startsBeforeOpen = await turnEvents(bridge.dir);
  await page.getByTestId('next-action-do').click({ noWaitAfter: true });
  await expect(visibleText(page, 'ARMY_REPLY: ARMY_HOLD newer reply after browser clock rollback')).toBeInViewport();
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeOpen);
  await toChats(page);
  await expect(card(page)).toHaveCount(0);

  const draftRow = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ hasText: 'New chat' });
  await expect(draftRow).toHaveCount(1);
  await draftRow.click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue('draft survives browser clock rollback attention');
});

test('Next up isolates unread replies by selected endpoint and opens the exact endpoint B reply', async ({ page, bridge: a }) => {
  const b = await createBridge(false, { archiveClaude: true });
  const wire: { endpoint: string; type: string }[] = [];
  page.on('websocket', socket => {
    const endpoint = new URL(socket.url()).host;
    socket.on('framereceived', frame => {
      try {
        const message: unknown = JSON.parse(String(frame.payload));
        if (typeof message === 'object' && message !== null && 'type' in message && typeof message.type === 'string') {
          wire.push({ endpoint, type: message.type });
        }
      } catch { /* Non-JSON transport frame. */ }
    });
  });
  const selectEndpoint = async (target: Bridge) => {
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${target.port}`);
    await page.getByLabel('Token', { exact: true }).fill((await readFile(join(target.dir, '.dash', 'token'), 'utf8')).trim());
    await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
    await expect.poll(() => wire.some(frame => frame.endpoint === `127.0.0.1:${target.port}` && frame.type === 'hello')).toBe(true);
  };
  try {
    await openChat(page, a);
    await send(page, 'ARMY_HOLD unread endpoint A reply');
    await expect(visibleText(page, 'ARMY_STREAM_BEGIN')).toBeVisible();
    await newChat(page);
    await composer(page).fill('endpoint A draft stays isolated');
    await toChats(page);
    await writeFile(join(a.dir, 'army-release'), '');
    await expect.poll(() => turnEvents(a.dir, 'end'), { timeout: 30_000 }).toBe(1);
    await expect(card(page)).toContainText('unread endpoint A reply');
    const aStarts = await turnEvents(a.dir);

    await selectEndpoint(b);
    await expect(card(page)).toHaveCount(0);
    const bChatTitle = 'ARMY archived Claude Code chat';
    const bRow = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ hasText: bChatTitle });
    await expect(bRow).toHaveCount(1);
    await bRow.click({ noWaitAfter: true });
    await send(page, 'ARMY_HOLD unread endpoint B reply');
    await expect(visibleText(page, 'ARMY_STREAM_BEGIN')).toBeVisible();
    await toChats(page);
    const draftRows = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ hasText: 'New chat' });
    const previousDraftIds = new Set(await draftRows.evaluateAll(rows => rows.map(row => row.getAttribute('data-testid'))));
    await newChat(page);
    await composer(page).fill('endpoint B draft survives attention navigation');
    await toChats(page);
    const newDraftIds = (await draftRows.evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')))).filter(id => !previousDraftIds.has(id));
    expect(newDraftIds).toHaveLength(1);
    const bDraftId = newDraftIds[0];
    if (!bDraftId) throw Error('The new endpoint B draft must have a rendered row identity');
    await writeFile(join(b.dir, 'army-release'), '');
    await expect.poll(() => turnEvents(b.dir, 'end'), { timeout: 30_000 }).toBe(1);

    await expect(card(page)).toContainText(bChatTitle);
    await expect(card(page)).not.toContainText('unread endpoint A reply');
    const bStarts = await turnEvents(b.dir);
    await page.getByTestId('next-action-do').click({ noWaitAfter: true });
    await expect(visibleText(page, 'ARMY_CLAUDE_REPLY: ARMY_HOLD unread endpoint B reply')).toBeInViewport();
    expect(await turnEvents(a.dir)).toBe(aStarts);
    expect(await turnEvents(b.dir)).toBe(bStarts);
    await toChats(page);
    await expect(card(page)).toHaveCount(0);

    await page.getByTestId(bDraftId).click({ noWaitAfter: true });
    await expect(composer(page)).toHaveValue('endpoint B draft survives attention navigation');
  } finally {
    await b.dispose();
  }
});
