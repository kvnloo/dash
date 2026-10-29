import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright/test';
import { test, expect, pair, openChat, composer, send } from './fixtures';

test.use({ viewport: { width: 390, height: 844 }, persistSession: false, bridgeOptions: { archiveClaude: true } });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

const card = (page: Page) => page.getByTestId('next-action-card');
const visibleText = (page: Page, text: string) => page.getByText(text, { exact: false }).filter({ visible: true }).first();

async function expectReadReplyFor(page: Page, chatTitle: string) {
  await expect(page.getByTestId('next-action-detail')).toContainText(chatTitle);
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

  await expect(card(page)).toContainText('permission', { timeout: 30_000 });
  const startsBeforeOpen = await turnEvents(bridge.dir);
  await page.getByTestId('next-action-do').click({ noWaitAfter: true });
  await expect(page.getByRole('heading', { name: 'Needs OK', exact: true })).toBeVisible();
  await expect(page.getByTestId('permission-choice-army-allow-once')).toBeVisible();
  expect(await readFile(join(bridge.dir, 'army-acp-permissions.jsonl'), 'utf8').catch(() => '')).toBe('');
  expect(await turnEvents(bridge.dir)).toBe(startsBeforeOpen);
  await toChats(page);
  await expect(card(page)).toContainText('permission');
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
