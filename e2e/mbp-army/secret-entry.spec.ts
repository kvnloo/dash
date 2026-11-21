// Secure sudo entry (#559/#560). The test plays the agent: it calls the bridge's loopback
// /secret/sudo (what `dash-sudo` does) with the bridge token. The phone UI shows the exact command
// and user@host on a full-screen entry with masked dots and hold-to-reveal; the password is sealed in
// the browser (X25519/HKDF/AES-GCM) and the real bridge opens it and writes it only into a fake
// `sudo` (first on the bridge's PATH) that checks `-k -S -p "" --` and the exact password line.
import { test, expect, openChat, type Bridge } from './fixtures';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const PASSWORD = 'army pw-7!x';
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

async function fakeSudo(bridge: Bridge) {
  await writeFile(join(bridge.dir, 'bin', 'sudo'), [
    '#!/bin/sh',
    '[ "$1" = -k ] && [ "$2" = -S ] && [ "$3" = -p ] && [ "$4" = "" ] && [ "$5" = -- ] || { echo "army-sudo: bad flags" >&2; exit 90; }',
    'shift 5',
    'IFS= read -r pw',
    `[ "$pw" = '${PASSWORD}' ] || { echo "Sorry, try again." >&2; exit 1; }`,
    'if IFS= read -r more; then echo "army-sudo: stdin stayed open" >&2; exit 91; fi',
    'echo ran > "$HOME/army-sudo-ran"',
    'exec "$@"',
  ].join('\n') + '\n', { mode: 0o700 });
}

async function askSudo(bridge: Bridge, argv: string[]) {
  const port = /notices\s+http:\/\/127\.0\.0\.1:(\d+)\/notice/.exec(bridge.logs())?.[1];
  if (!port) throw Error('bridge printed no loopback listener');
  const token = (await readFile(join(bridge.dir, '.dash', 'token'), 'utf8')).trim();
  return fetch(`http://127.0.0.1:${port}/secret/sudo`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ argv, cwd: bridge.dir, reason: 'army secure sudo journey' }),
  }).then(async r => ({ status: r.status, body: await r.json() as { outcome: string; exitCode: number | null; stdout: string; stderr: string } }));
}

test('secure sudo: masked full-screen entry with hold-to-reveal runs only the shown command and never exposes the password', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge);
  await fakeSudo(bridge);
  const answer = askSudo(bridge, ['echo', 'army-sudo-ran']);

  const entry = page.getByTestId('secret-entry');
  await expect(entry).toBeVisible();
  await expect(page.getByTestId('secret-command')).toHaveText('$ sudo echo army-sudo-ran');
  await expect(page.getByTestId('secret-account')).toContainText('@');
  await expect(page.getByText('Reason given: army secure sudo journey')).toBeVisible();
  const run = page.getByRole('button', { name: 'Run with sudo', exact: true });
  await expect(run).toBeDisabled();

  await page.getByTestId('secret-dots').click();
  await page.keyboard.type(PASSWORD);
  const dots = page.getByTestId('secret-dots');
  await expect(dots).toHaveText('•'.repeat(PASSWORD.length));
  await expect(page.getByText(PASSWORD, { exact: true }), 'no visible plain text while not held').toHaveCount(0);
  const reveal = page.getByTestId('secret-reveal');
  const box = await reveal.boundingBox();
  if (!box) throw Error('reveal control has no layout');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(dots).toHaveText(PASSWORD);
  await page.screenshot({ path: info.outputPath('revealed.png') });
  await page.mouse.up();
  await expect(dots).toHaveText('•'.repeat(PASSWORD.length));
  await page.screenshot({ path: info.outputPath('masked.png') });

  await run.click({ noWaitAfter: true });
  const result = await answer;
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ outcome: 'delivered', exitCode: 0, stdout: 'army-sudo-ran\n' });
  await expect(entry).toHaveCount(0);
  await access(join(bridge.dir, 'army-sudo-ran'));
  expect(JSON.stringify(result.body)).not.toContain(PASSWORD);
  expect(bridge.logs(), 'bridge log never carries the password or the command').not.toContain(PASSWORD);
  expect(bridge.logs()).not.toContain('army-sudo-ran');
});

test('secure sudo: Decline on the phone refuses the agent and sudo never runs', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge);
  await fakeSudo(bridge);
  const answer = askSudo(bridge, ['touch', '/should-not-run']);
  await expect(page.getByTestId('secret-command')).toHaveText('$ sudo touch /should-not-run');
  await page.getByRole('button', { name: 'Decline sudo request', exact: true }).click({ noWaitAfter: true });
  const result = await answer;
  expect(result.body).toMatchObject({ outcome: 'cancelled', exitCode: null, stdout: '' });
  await expect(page.getByTestId('secret-entry')).toHaveCount(0);
  await expect(access(join(bridge.dir, 'army-sudo-ran'))).rejects.toThrow();
});
