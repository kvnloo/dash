import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from 'playwright/test';
import { test, expect, pair, chooseHarness, send, web } from './fixtures';

test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.6,
  hasTouch: true,
  colorScheme: 'light',
  persistSession: false,
  bridgeOptions: { generatedUI: true, env: { ARMY_PERSIST_SESSION: "1" } },
});

const picks = [
  { app: 'gmail', kind: 'inbox', surface: 'rgb(31, 31, 31)' },
  { app: 'github', kind: 'triage', surface: 'rgb(13, 17, 23)' },
  { app: 'stripe', kind: 'receipt', surface: 'rgb(25, 29, 48)' },
  { app: 'spotify', kind: 'player', surface: 'rgb(18, 18, 18)' },
];

async function shot(target: Locator | Page, name: string, info: TestInfo) {
  const dir = process.env.ARMY_CARD_SCREENSHOTS;
  if (dir) await mkdir(dir, { recursive: true });
  await target.screenshot({ path: dir ? join(dir, name + '.png') : info.outputPath(name + '.png'), animations: 'disabled' });
}

function frame(page: Page, title: string) {
  const selector = `iframe[title="${title}"]`;
  return { iframe: page.locator(selector), card: page.frameLocator(selector).locator('.eu-card') };
}

async function assertFit(iframe: Locator, card: Locator) {
  await expect(card).toBeVisible();
  await iframe.scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const bounds = await iframe.boundingBox();
    if (!bounds) return null;
    return card.evaluate((el, host) => {
      const rect = el.getBoundingClientRect();
      return {
        verticalOverflow: Math.max(0, Math.round(rect.bottom - host.height - 1)),
        horizontalOverflow: Math.max(0, Math.round(Math.max(rect.right, document.documentElement.scrollWidth) - host.width - 1)),
      };
    }, bounds);
  }).toEqual({ verticalOverflow: 0, horizontalOverflow: 0 });
}

for (const style of ['Dash', 'App']) {
  test(`Card style ${style} draws phone-sized cards in chat on a light OS`, async ({ page, bridge }, info) => {
    await pair(page, bridge);
    if (style === 'App') {
      await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
      await page.getByRole('radiogroup', { name: 'Card style' }).getByRole('radio', { name: 'App' }).click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
    }
    await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByTestId('chats-pane').getByText('New chat', { exact: true }).click();
    await chooseHarness(page, 'Hermes');
    for (const { app, kind, surface } of picks) {
      await send(page, kind === 'inbox' ? 'ARMY_EPHEMERAL_INBOX' : `ARMY_EPHEMERAL_KIND:${kind}:${app}`);
      const { iframe, card } = frame(page, `${app} ${kind} card`);
      await expect(card).toHaveCSS('background-color', style === 'Dash' ? 'rgba(18, 20, 17, 0.82)' : surface);
      await assertFit(iframe, card);
      if (kind === 'inbox') {
        await expect(card.locator('.eu-hint')).toBeHidden();
        await expect(card.getByRole('button', { name: 'Pin card' })).toBeHidden();
        await expect(card.locator('xpath=ancestor::body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        const query = card.locator('.eu-verb');
        await expect(query).toHaveText(style === 'Dash' ? '“invoice”' : 'invoice');
        expect(await query.evaluate(el => el.scrollWidth === el.clientWidth && getComputedStyle(el).whiteSpace === 'nowrap')).toBe(true);
        const highlight = card.locator('.subj mark').first();
        await expect(highlight).toHaveCSS('padding-left', '0px');
        expect(await highlight.evaluate(el => Math.abs(el.getBoundingClientRect().left - (el.parentElement?.getBoundingClientRect().left ?? 0)))).toBeLessThan(1);
        if (style === 'App') {
          await expect(card.getByRole('heading', { name: 'Top results' })).toBeVisible();
          const unread = card.locator('.inbox li.unread').first();
          const read = card.locator('.inbox li:not(.unread)').first();
          await expect(unread.locator('b')).toHaveCSS('color', 'rgb(255, 255, 255)');
          await expect(read.locator('b')).toHaveCSS('font-weight', '400');
          expect(await card.locator('.inbox li').evaluateAll(rows =>
            rows.every(row => getComputedStyle(row, '::after').content.includes('☆')))).toBe(true);
        }
        await expect(card.locator('.inbox li').first()).toHaveCSS('font-size', '15px');
        await expect(card.getByRole('button', { name: 'Open in Gmail' })).toHaveCSS('min-height', '44px');
        await shot(page, `${app}-chat-${style.toLowerCase()}`, info);
        await shot(iframe, `${app}-${style.toLowerCase()}`, info);
        await card.getByRole('button', { name: 'Open in Gmail' }).click();
        await page.getByRole('button', { name: /^Send to agent: Open this search in Gmail/ }).click();
        await expect.poll(() => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).toContain('eui.inbox.open');
        await assertFit(iframe, card);
      } else {
        if (kind === 'receipt') await expect(card.getByText('$1,240.00', { exact: true })).toBeVisible();
        await shot(iframe, `${app}-${style.toLowerCase()}`, info);
      }
    }
  });
}

test('Card gallery switches styles live, follows Blueprint and remembers the preference', async ({ page, bridge }, info) => {
  await pair(page, bridge);
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
  await page.getByRole('radio', { name: 'Blueprint' }).click();
  await page.getByRole('button', { name: 'Card gallery', exact: true }).click();
  await page.getByTestId('gallery-kind-inbox').click();
  const picker = page.getByRole('radiogroup', { name: 'Card style' });
  const gmail = frame(page, 'fixture inbox/gmail');
  const unknown = frame(page, 'fixture inbox/outlook');
  await expect(picker.getByRole('radio', { name: 'Dash' })).toBeChecked();
  await expect(gmail.card).toHaveCSS('background-color', 'rgba(18, 24, 32, 0.88)');
  await assertFit(gmail.iframe, gmail.card);
  await shot(page, 'gallery-dash', info);
  await picker.getByRole('radio', { name: 'App' }).click();
  await expect(gmail.card).toHaveCSS('background-color', 'rgb(31, 31, 31)');
  await expect(unknown.card).toHaveCSS('background-color', 'rgba(18, 24, 32, 0.88)');
  await assertFit(gmail.iframe, gmail.card);
  await shot(page, 'gallery-app', info);
  await page.goto(`${web}/gallery?page=5`);
  await expect(picker.getByRole('radio', { name: 'App' })).toBeChecked();
});
