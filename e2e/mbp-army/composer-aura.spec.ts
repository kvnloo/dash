import { test, expect, openChat, composer, send } from './fixtures';
import type { Locator } from 'playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// DA-057: the input bar's rim reacts to typing and travels while the agent works (after OMP/Tern's
// docked composer). Web evidence; the S25 recording is the device check.

const opacityOf = (el: Locator) => el.evaluate((node: Element) => Number(getComputedStyle(node).opacity));
const transformOf = (el: Locator) => el.evaluate((node: Element) => getComputedStyle(node).transform);

test('composer rim brightens while typing and sweeps while the agent works, then rests', async ({ page, bridge }, info) => {
  await openChat(page, bridge);
  await expect(page.getByTestId('composer-aura-idle')).toHaveCount(1);

  await composer(page).click();
  await expect(page.getByTestId('composer-aura-focused')).toHaveCount(1);
  const focusedRim = page.getByTestId('composer-aura-focused');
  await expect.poll(() => opacityOf(focusedRim)).toBeGreaterThan(0.2);
  const resting = await opacityOf(focusedRim);

  await page.keyboard.type('ARMY_HOLD aura while typing', { delay: 45 });
  const typingRim = page.getByTestId('composer-aura-typing');
  await expect(typingRim).toHaveCount(1);
  await expect.poll(() => opacityOf(typingRim)).toBeGreaterThan(resting + 0.2);
  await page.screenshot({ path: info.outputPath('typing.png') });
  // A pause ends the typing run; the rim settles back to the focused hairline.
  await expect(page.getByTestId('composer-aura-focused')).toHaveCount(1, { timeout: 3000 });

  await page.getByRole('button', { name: 'Send', exact: true }).click({ noWaitAfter: true });
  const transcript = page.getByTestId('transcript-viewport');
  await expect(transcript.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.getByTestId('composer-aura-working')).toHaveCount(1);
  const sweep = page.getByTestId('composer-aura-sweep');
  await expect(sweep).toHaveCount(1);
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) { seen.add(await transformOf(sweep)); await page.waitForTimeout(180); }
  expect(seen.size).toBeGreaterThan(2);
  // Still one live activity orb: the rim is the input bar's motion, not a second indicator.
  await expect(transcript.getByTestId('agent-orb')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('working.png') });

  await writeFile(join(bridge.dir, 'army-release'), 'release');
  await expect(transcript.getByText(/ARMY_REPLY:/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(page.getByTestId('composer-aura-working')).toHaveCount(0);
  await expect(sweep).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('rested.png') });

  const turns = await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8');
  expect(turns).toContain('ARMY_HOLD aura while typing');
});

test('composer rim never travels under reduce motion but still shows the agent is working', async ({ page, bridge }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openChat(page, bridge);
  await send(page, 'ARMY_HOLD aura reduced motion');
  const transcript = page.getByTestId('transcript-viewport');
  await expect(transcript.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
  await expect(page.getByTestId('composer-aura-working')).toHaveCount(1);
  const sweep = page.getByTestId('composer-aura-sweep');
  await expect(sweep).toHaveCount(1);
  const first = await transformOf(sweep);
  await page.waitForTimeout(700);
  expect(await transformOf(sweep)).toBe(first);
  await writeFile(join(bridge.dir, 'army-release'), 'release');
  await expect(transcript.getByText(/ARMY_REPLY:/).first()).toBeVisible();
  await expect(page.getByTestId('composer-aura-working')).toHaveCount(0);
});
