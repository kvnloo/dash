import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hostname } from 'node:os';
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
 // The fixture `hermes` answers ACP only. Let `hermes gateway list` report a running courier
 // profile, as the real CLI does, so the roster lists the agent behind that bot.
 const bin = join(bridge.dir, 'bin');
 await writeFile(join(bin, 'hermes-acp'), await readFile(join(bin, 'hermes'), 'utf8'), { mode: 0o700 });
 await writeFile(join(bin, 'hermes'), '#!/bin/sh\nif [ "$1" = gateway ] && [ "$2" = list ]; then printf \'  \\342\\234\\223 courier\\n\'; exit 0; fi\nexec "$(dirname "$0")/hermes-acp" "$@"\n', { mode: 0o700 });
 const token = (await readFile(join(bridge.dir, '.dash', 'token'), 'utf8')).trim();
 await expect.poll(async () => {
  const response = await fetch(`http://127.0.0.1:${bridge.port}/roster`, { headers: { Authorization: `Bearer ${token}` } });
  const text = JSON.stringify(await response.json());
  return text.includes('hermes-bot:default') && text.includes('hermes-bot:courier') && text.includes('"hermes:courier"');
 }, { timeout: 15000, message: 'bridge roster must report both seeded bots and the courier profile agent' }).toBe(true);
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
 // Staging's Hosts tree is Host → Harness → Profile/Bot → Chat (12dc5dbd): both bots sit under Hermes.
 const host = page.getByTestId(/^tree-row-host:/).first();
 await expect(host).toContainText('harnesses');
 await host.click({ noWaitAfter: true });
 const hermes = page.getByTestId(/^tree-row-[^:]+:harness:hermes$/);
 await hermes.click({ noWaitAfter: true });
 await expect(page.getByTestId(/^tree-row-[^:]+:hermes:profile:courier$/)).toContainText('Slack not running');
 await expect(page.getByTestId(/^tree-row-[^:]+:hermes:profile:default$/)).toBeVisible();
 await page.screenshot({ path: info.outputPath('bots-tree.png') });
});

test('a bot gem opens its simple page with honest channels and chats; it offers only actions Dash can take', async ({ page, bridge }, info) => {
 await openBotsPage(page, bridge);
 await page.getByRole('button', { name: /^courier on .+, Not running$/ }).click();
 const botPage = page.getByTestId('bot-page');
 await expect(botPage).toBeVisible();
 await expect(page.getByRole('heading', { name: 'courier', exact: true })).toBeVisible();
 await expect(botPage.getByTestId('bot-channel-slack')).toContainText('Not running');
 // The bridge lists the courier profile bot as a Hermes spawn target (DA-085, bridge/src/bots.ts),
 // so its page offers the one action that works: a new chat in that profile, and no refusal note.
 await expect(botPage.getByRole('button', { name: 'Chat with courier', exact: true })).toBeVisible();
 await expect(botPage.getByTestId('bot-start-note')).toHaveCount(0);
 await expect(botPage.getByText('No chats with this bot on its host.', { exact: true })).toBeVisible();
 await page.screenshot({ path: info.outputPath('bot-page-courier.png') });

 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await expect(botPage).toHaveCount(0);
 await expect(page.getByTestId(/^bot-gem-/)).toHaveCount(2);

 await page.getByRole('button', { name: /^default on .+, Not running$/ }).click();
 await expect(page.getByRole('heading', { name: 'default', exact: true })).toBeVisible();
 await expect(botPage.getByTestId('bot-channel-telegram')).toContainText('Not running');
 await expect(botPage.getByTestId('bot-channel-discord')).toContainText('Not running');
 await expect(botPage.getByTestId('bot-start-note')).toContainText('does not list a harness for this bot');
 const session = botPage.getByTestId(/^bot-session-hermes:session:default:/).first();
 await expect(session).toBeVisible();
 await page.screenshot({ path: info.outputPath('bot-page-default.png') });
 const label = await session.getAttribute('aria-label');
 const title = label?.replace(/^Open chat /, '') ?? '';
 expect(title.length).toBeGreaterThan(0);
 await session.click();
 // The full Chat screen on that Hermes session: its title, the host and a ready composer.
 await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
 await expect(page.getByText(`on ${hostname()}`, { exact: true })).toBeVisible();
 await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
 await expect(botPage).toBeHidden();
});
