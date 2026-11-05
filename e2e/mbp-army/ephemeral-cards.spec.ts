import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, chooseHarness, send } from './fixtures';
import { EPHEMERAL_KINDS } from '../../app/src/vendor/ephemeral-ui/kinds.generated';

// kvnloo/ephemeral-ui cards: the reply names card.v0 kinds through the openui-lang catalog, and the
// app draws the repo's own card (pinned kit, synthetic fixtures) in a sandboxed frame.
test.use({ bridgeOptions: { generatedUI: true, env: { ARMY_EPHEMERAL_KINDS: EPHEMERAL_KINDS.join(',') } } });
test.afterEach(async ({ page }, info) => {
 if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png'), fullPage: true });
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
 await expect(page.getByText('ephemeral-ui · inbox · gmail · kit sample data', { exact: true })).toBeVisible();
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

for (const batch of [0, 1, 2, 3, 4]) {
 test(`ephemeral-ui card.v0 kinds ${batch * 10 + 1}-${batch * 10 + 10} all draw the repo card`, async ({ page, bridge }) => {
  test.setTimeout(180_000);
  await openChat(page, bridge);
  await send(page, `ARMY_EPHEMERAL_BATCH_${batch}`);
  const kinds = EPHEMERAL_KINDS.slice(batch * 10, batch * 10 + 10);
  await expect(page.locator('iframe[title$=" card"]')).toHaveCount(kinds.length);
  for (const kind of kinds) {
   const frame = page.frameLocator(`iframe[title$=" ${kind} card"]`);
   await expect(frame.locator(`.eu-card[data-kind="${kind}"]`)).toBeVisible({ timeout: 30_000 });
   await expect(frame.getByRole('alert')).toHaveCount(0);
  }
  await expect(page.getByRole('alert', { name: 'Interface could not be rendered', exact: true })).toHaveCount(0);
 });
}
