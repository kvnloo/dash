import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, chooseHarness, send } from './fixtures';
import { EPHEMERAL_KINDS } from '../../app/src/vendor/ephemeral-ui/kinds.generated';

// kvnloo/ephemeral-ui cards: the reply names kit kinds through the openui-lang catalog, and the
// app draws the repo's own card (pinned kit) in a sandboxed frame. A kind and app the shared card
// catalog (vendored catalog.json) has a fixture for draws that fixture, the card every app draws.
test.use({ bridgeOptions: { generatedUI: true } });
type Fixture = { id: string; state: string; card: { kind: string; app: string } };
const catalog: { version: string; kinds: { kind: string; fixtures: Fixture[] }[] } = JSON.parse(readFileSync(join(__dirname, '../../app/src/vendor/ephemeral-ui/catalog.json'), 'utf8'));
// The fixture a chat card draws (app/src/lib/ephemeral-catalog.ts catalogFixtureFor): first sample or example, else input.
const chatFixture = (fixtures: Fixture[], app: string) => ['sample', 'example', 'input'].map(s => fixtures.find(f => f.card.app === app && f.state === s)).find(Boolean);
test.afterEach(async ({ page }, info) => {
 // Match the army convention: no fullPage stitching. A full-page screenshot of a chat
 // holding ten sandboxed kit frames is a multi-hundred-MB Chromium raster, and it broke
 // unrelated army specs under worker load on a 4-vCPU runner.
 if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

const card = (page: import('@playwright/test').Page, app: string, kind: string) => page.frameLocator(`iframe[title="${app} ${kind} card"]`);

test('ephemeral-ui inbox card renders, its control answers in place, and Send to agent hands typed ids back', async ({ page, bridge }) => {
 await openChat(page, bridge);
 await chooseHarness(page, 'Hermes');
 await send(page, 'ARMY_EPHEMERAL_INBOX');
 const inbox = card(page, 'gmail', 'inbox');
 await expect(inbox.locator('.eu-card[data-kind="inbox"][data-app="gmail"]')).toBeVisible();
 await expect(inbox.getByText('Invoice #4471 is due Nov 14')).toBeVisible();
 await expect(page.getByText(/EphemeralCard\(/)).toHaveCount(0);
 await expect(page.getByText(`ephemeral-ui · catalog v${catalog.version} · inbox/gmail · same as catalog`, { exact: true })).toBeVisible();
 await inbox.getByRole('button', { name: 'Open in Gmail', exact: true }).click();
 await expect(page.getByRole('button', { name: /^Send to agent: / })).toHaveCount(1);
 // The kit's own loop: the user's handoff and the agent acknowledgement stream into the card.
 await expect(inbox.locator('.lp-line.you')).toContainText('Open this search in Gmail');
 const handoff = page.getByRole('button', { name: 'Send to agent: Open this search in Gmail', exact: true });
 await expect(handoff).toBeVisible();
 await handoff.click();
 await expect(page.getByText('Sent to agent: Open this search in Gmail', { exact: true })).toBeVisible();
 await expect.poll(async () => readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).toContain('eui.inbox.open');
});

test('ephemeral-ui card with an app that does not list the kind is rejected without source', async ({ page, bridge }) => {
 await openChat(page, bridge);
 await send(page, 'ARMY_EPHEMERAL_INVALID');
 await expect(page.getByRole('alert', { name: 'Interface could not be rendered', exact: true })).toBeVisible();
 await expect(page.locator('iframe[title$=" card"]')).toHaveCount(0);
 await expect(page.getByText(/EphemeralCard\(/)).toHaveCount(0);
});

// Every kind in the shared catalog gets its own chat journey: the agent's reply names the kind and the app of
// the kind's first catalog fixture, and the chat draws that fixture with the catalog's props.
test('every shared catalog kind is a kind the chat draws', () => {
 expect(catalog.kinds.map(k => k.kind).sort()).toEqual([...EPHEMERAL_KINDS].sort());
});
for (const { kind, fixtures } of catalog.kinds) {
 const app = fixtures[0]!.card.app;
 const fixture = chatFixture(fixtures, app)!;
 test(`ephemeral-ui ${kind} card renders in chat from catalog fixture ${fixture.id}`, async ({ page, bridge }) => {
  await openChat(page, bridge);
  await send(page, `ARMY_EPHEMERAL_KIND:${kind}:${app}`);
  await expect(page.getByText(`Here is the ${kind} card.`, { exact: true })).toBeVisible();
  await expect(page.locator('iframe[title$=" card"]')).toHaveCount(1);
  const frame = page.frameLocator(`iframe[title="${app} ${kind} card"]`);
  const card = frame.locator(`.eu-card[data-kind="${kind}"]`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(frame.getByRole('alert')).toHaveCount(0);
  // Props parity with the catalog, stated in the card footer.
  await expect(page.getByText(`ephemeral-ui · catalog v${catalog.version} · ${fixture.id} · same as catalog`, { exact: true })).toBeVisible({ timeout: 30_000 });
  const body = await card.innerText();
  expect(body.trim().length).toBeGreaterThan(0);
  expect(body).not.toMatch(/\bundefined\b|\bNaN\b/);
  // Kinds that need data (fleet, intel-suite, ops) draw the catalog's example, not their empty state.
  await expect(frame.getByText(/data unavailable|could not be drawn|snapshot: \d{3}/i)).toHaveCount(0);
  await expect(page.getByText(/EphemeralCard\(/)).toHaveCount(0);
  await expect(page.getByRole('alert', { name: 'Interface could not be rendered', exact: true })).toHaveCount(0);
 });
}
