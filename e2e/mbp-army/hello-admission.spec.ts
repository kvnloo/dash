import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, pair, composer, send } from './fixtures';

test('hello admission: OPEN without authenticated hello times out, retries and recovers through Settings', async ({ page, bridge }, testInfo) => {
  test.setTimeout(90000);
  await pair(page, bridge);
  const bun = process.env.ARMY_BUN || execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  const relay = spawn(bun, [join(__dirname, 'hello-relay.ts'), `http://127.0.0.1:${bridge.port}`], { stdio: ['pipe', 'pipe', 'pipe'] });
  let log = '';
  relay.stdout.on('data', chunk => { log += chunk.toString(); });
  relay.stderr.on('data', chunk => { log += chunk.toString(); });
  try {
    await expect.poll(() => /listening:\d+/.exec(log)?.[0], { timeout: 10000 }).toBeTruthy();
    const port = /listening:(\d+)/.exec(log)?.[1];
    if (!port) throw Error('Owned relay port missing');
    relay.stdin.write('allow\n');
    await expect.poll(() => log).toContain('"event":"allow"');
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${port}`);
    await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
    await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click();
    await composer(page).fill('ARMY hello admission draft');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const row = page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({ has: page.getByText('New chat', { exact: true }) });
    await expect(row).toHaveCount(1);
    relay.stdin.write('hold\n');
    await expect.poll(() => log).toContain('"event":"hold"');
    // The owned transport drops its admitted socket; the endpoint and draft owner stay fixed.
    relay.stdin.write('disconnect\n');
    await expect.poll(() => log).toContain('"event":"client-close","id":1');
    await expect.poll(() => log, { timeout: 5000 }).toContain('"event":"withheld-hello","id":2');
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeEnabled();
    // Only a real client close and new authenticated upstream connection prove
    // that the transport watchdog ran; no Settings attempt deadline is active.
    await expect.poll(() => log, { timeout: 11000 }).toContain('"event":"client-close","id":2');
    await expect.poll(() => log, { timeout: 4000 }).toContain('"event":"withheld-hello","id":3');
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
    relay.stdin.write('allow\n');
    await expect.poll(() => log.lastIndexOf('"event":"allow"') > log.lastIndexOf('"event":"hold"')).toBe(true);
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect.poll(() => log, { timeout: 5000 }).toContain('"event":"authenticated-hello","id":4');
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeHidden({ timeout: 10000 });
    await row.click();
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await expect(composer(page)).toHaveValue('ARMY hello admission draft');
    await send(page, 'ARMY_SLOW hello admission recovered');
    await expect(page.getByText(/ARMY_REPLY: ARMY_SLOW hello admission recovered/).first()).toBeVisible({ timeout: 20000 });
    const turns = await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8');
    expect(turns).toContain('ARMY_SLOW hello admission recovered');
    await writeFile(testInfo.outputPath('army-acp-turns.jsonl'), turns);
    await page.screenshot({ path: testInfo.outputPath('final.png') });
    expect(log).not.toContain('"event":"client-close","id":4');
  } finally {
    if (relay.exitCode === null && relay.signalCode === null) {
      relay.kill('SIGTERM');
      await once(relay, 'exit');
    }
    await writeFile(testInfo.outputPath('hello-relay.log'), log);
  }
});

test.describe('roster connection ownership', () => {
  test.use({ bridgeOptions: { phoneHosts: true } });

  test('roster response from a retired socket cannot replace the reconnected host list', async ({ page, bridge }, testInfo) => {
    test.setTimeout(90000);
    await pair(page, bridge);
    const bun = process.env.ARMY_BUN || execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
    const relay = spawn(bun, [join(__dirname, 'hello-relay.ts'), `http://127.0.0.1:${bridge.port}`], { stdio: ['pipe', 'pipe', 'pipe'] });
    let log = '';
    relay.stdout.on('data', chunk => { log += chunk.toString(); });
    relay.stderr.on('data', chunk => { log += chunk.toString(); });
    try {
      await expect.poll(() => /listening:\d+/.exec(log)?.[0]).toBeTruthy();
      const port = /listening:(\d+)/.exec(log)?.[1];
      if (!port) throw Error('Owned relay port missing');
      relay.stdin.write('allow\nhold-roster\n');
      await expect.poll(() => log).toContain('"event":"roster-armed"');
      await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
      await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${port}`);
      await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save and reconnect', exact: true })).toBeHidden();
      await expect.poll(() => log).toContain('"event":"roster-held"');
      await page.getByRole('tab', { name: 'Hosts', exact: true }).click();
      const phone = page.getByTestId('tree-row-host:galaxy-s22');
      await expect(phone).toContainText('Galaxy S22+');

      // Change the real discovery-command input, not an HTTP response or app store.
      const discovery = JSON.parse(await readFile(join(bridge.dir, 'tailscale.json'), 'utf8'));
      discovery.Peer.s22.HostName = 'ARMY current S22';
      await writeFile(join(bridge.dir, 'tailscale.json'), JSON.stringify(discovery));
      const token = (await readFile(join(bridge.dir, '.dash', 'token'), 'utf8')).trim();
      await expect.poll(async () => {
        const response = await fetch(`http://127.0.0.1:${bridge.port}/roster`, { headers: { Authorization: `Bearer ${token}` } });
        return response.text();
      }, { timeout: 25000 }).toContain('ARMY current S22');

      // Dropping the transport preserves the same Settings object on reconnect.
      relay.stdin.write('disconnect\n');
      await expect.poll(() => log).toContain('"event":"authenticated-hello","id":2');
      await expect(phone).toContainText('ARMY current S22');
      const oldResponse = page.waitForResponse(response => response.headers()['x-army-held-roster'] === '1');
      relay.stdin.write('release-roster\n');
      const released = await oldResponse;
      expect(await released.finished()).toBeNull();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(phone).toContainText('ARMY current S22');
      await expect(phone).not.toContainText('Galaxy S22+');
      await page.screenshot({ path: testInfo.outputPath('final.png') });
    } finally {
      if (relay.exitCode === null && relay.signalCode === null) {
        relay.kill('SIGTERM');
        await once(relay, 'exit');
      }
      await writeFile(testInfo.outputPath('roster-relay.log'), log);
    }
  });
});
