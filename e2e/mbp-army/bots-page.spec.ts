import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, pair, type Bridge } from './fixtures';
import type { Page } from 'playwright/test';

test.afterEach(async ({ page }, info) => {
 if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

// Real Hermes profile configs that the bridge's own bot discovery reads (bridge/src/bots.ts).
// No gateway runs, so every channel is honestly "Not running".
async function seedBots(bridge: Bridge) {
 const hermes = join(bridge.dir, '.hermes');
 await writeFile(join(hermes, 'config.yaml'), 'platforms:\n  telegram:\n    enabled: true\n  discord:\n    enabled: true\n');
 await mkdir(join(hermes, 'profiles', 'courier'), { recursive: true });
 await writeFile(join(hermes, 'profiles', 'courier', 'config.yaml'), 'gateway:\n  platforms:\n    slack:\n      enabled: true\n');
 const token = (await readFile(join(bridge.dir, '.dash', 'token'), 'utf8')).trim();
 await expect.poll(async () => {
  const response = await fetch(`http://127.0.0.1:${bridge.port}/roster`, { headers: { Authorization: `Bearer ${token}` } });
  const text = JSON.stringify(await response.json());
  return text.includes('hermes-bot:default') && text.includes('hermes-bot:courier');
 }, { timeout: 15000, message: 'bridge roster must report both seeded bots' }).toBe(true);
}

async function openBotsPage(page: Page, bridge: Bridge) {
 await seedBots(bridge);
 await pair(page, bridge);
 await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
 await page.getByRole('button', { name: 'Bots page prototype', exact: true }).click();
 await expect(page.getByTestId('bots-page')).toBeVisible();
}

test('bots page shows every reported bot as a gem, as an orrery and in the host tree', async ({ page, bridge }, info) => {
 await openBotsPage(page, bridge);
 await expect(page.getByTestId('bots-page-summary')).toHaveText('2 bots on 1 host · 0 live');
 const table = page.getByRole('tab', { name: 'Table view', exact: true });
 await expect(table).toHaveAttribute('aria-selected', 'true');
 const courier = page.getByRole('button', { name: /^courier on .+, Not running$/ });
 const fallback = page.getByRole('button', { name: /^default on .+, Not running$/ });
 await expect(courier).toBeVisible();
 await expect(fallback).toBeVisible();
 await expect(page.getByTestId(/^bot-gem-/)).toHaveCount(2);
 await expect(courier).toContainText('Co');
 await expect(fallback).toContainText('De');
 await page.screenshot({ path: info.outputPath('bots-table.png') });

 const orrery = page.getByRole('tab', { name: 'Orrery view', exact: true });
 await orrery.click();
 await expect(orrery).toHaveAttribute('aria-selected', 'true');
 await expect(page.getByTestId(/^bot-gem-/)).toHaveCount(0);
 await expect(page.getByTestId(/^bot-orrery-/)).toHaveCount(1);
 await expect(page.getByTestId(/^bot-planet-/)).toHaveCount(2);
 await expect(page.getByTestId(/^bot-orrery-/)).toContainText('2 bots');
 await page.screenshot({ path: info.outputPath('bots-orrery.png') });

 const tree = page.getByRole('tab', { name: 'Tree view', exact: true });
 await tree.click();
 await expect(tree).toHaveAttribute('aria-selected', 'true');
 const host = page.getByTestId(/^tree-row-host:/).first();
 await expect(host).toContainText('2 bots');
 await host.click({ noWaitAfter: true });
 await expect(page.getByTestId(/^tree-row-.+:bot:hermes-bot:courier$/)).toContainText('Slack not running');
 await page.screenshot({ path: info.outputPath('bots-tree.png') });
});

test('a bot gem opens its simple page with honest channels; only a bot with a harness offers chat', async ({ page, bridge }, info) => {
 await openBotsPage(page, bridge);
 await page.getByRole('button', { name: /^courier on .+, Not running$/ }).click();
 const botPage = page.getByTestId('bot-page');
 await expect(botPage).toBeVisible();
 await expect(page.getByRole('heading', { name: 'courier', exact: true })).toBeVisible();
 await expect(botPage.getByTestId('bot-channel-slack')).toContainText('Not running');
 await expect(botPage.getByText(/does not list a harness for this bot/)).toBeVisible();
 await expect(botPage.getByRole('button', { name: /^Chat with/ })).toHaveCount(0);
 await page.screenshot({ path: info.outputPath('bot-page-courier.png') });

 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await expect(botPage).toHaveCount(0);
 await expect(page.getByTestId(/^bot-gem-/)).toHaveCount(2);

 await page.getByRole('button', { name: /^default on .+, Not running$/ }).click();
 await expect(botPage.getByTestId('bot-channel-telegram')).toContainText('Not running');
 await expect(botPage.getByTestId('bot-channel-discord')).toContainText('Not running');
 await page.screenshot({ path: info.outputPath('bot-page-default.png') });
 await botPage.getByRole('button', { name: 'Chat with default', exact: true }).click();
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await expect(page.getByTestId('chat-window').getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
});
