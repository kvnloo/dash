import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, openChat, chatRow, composer, send } from './fixtures';

test('hello admission: OPEN without authenticated hello times out, retries and recovers through Settings', async ({ page, bridge }, testInfo) => {
  test.setTimeout(90000);
  await openChat(page, bridge);
  await composer(page).fill('ARMY hello admission draft');
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click();
  const bun = process.env.ARMY_BUN || execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  const relay = spawn(bun, [join(__dirname, 'hello-relay.ts'), `http://127.0.0.1:${bridge.port}`], { stdio: ['pipe', 'pipe', 'pipe'] });
  let log = '';
  relay.stdout.on('data', chunk => { log += chunk.toString(); });
  relay.stderr.on('data', chunk => { log += chunk.toString(); });
  try {
    await expect.poll(() => /listening:\d+/.exec(log)?.[0], { timeout: 10000 }).toBeTruthy();
    const port = /listening:(\d+)/.exec(log)?.[1];
    if (!port) throw Error('Owned relay port missing');
    await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Address', exact: true }).fill(`127.0.0.1:${port}`);
    await page.getByRole('button', { name: 'Save and reconnect', exact: true }).click();
    await expect.poll(() => log, { timeout: 5000 }).toContain('"event":"withheld-hello","id":1');
    await expect(page.getByRole('button', { name: 'Connecting…', exact: true })).toBeVisible();
    // The Settings form has its own deadline. Only a real client close and new
    // authenticated upstream connection prove that the transport watchdog ran.
    await expect.poll(() => log, { timeout: 11000 }).toContain('"event":"client-close","id":1');
    await expect.poll(() => log, { timeout: 4000 }).toContain('"event":"withheld-hello","id":2');
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible();
    relay.stdin.write('allow\n');
    await expect.poll(() => log).toContain('"event":"allow"');
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect.poll(() => log, { timeout: 5000 }).toContain('"event":"authenticated-hello","id":3');
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeHidden({ timeout: 10000 });
    await chatRow(page).click();
    await expect(page.getByTestId('chat-window')).toBeVisible();
    await expect(composer(page)).toHaveValue('ARMY hello admission draft');
    await send(page, 'ARMY_SLOW hello admission recovered');
    await expect(page.getByText(/ARMY_REPLY: ARMY_SLOW hello admission recovered/).first()).toBeVisible({ timeout: 20000 });
    const turns = await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8');
    expect(turns).toContain('ARMY_SLOW hello admission recovered');
    await writeFile(testInfo.outputPath('army-acp-turns.jsonl'), turns);
    await page.screenshot({ path: testInfo.outputPath('final.png') });
    expect(log).not.toContain('"event":"client-close","id":3');
  } finally {
    if (relay.exitCode === null && relay.signalCode === null) {
      relay.kill('SIGTERM');
      await once(relay, 'exit');
    }
    await writeFile(testInfo.outputPath('hello-relay.log'), log);
  }
});
