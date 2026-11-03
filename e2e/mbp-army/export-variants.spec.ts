import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from './fixtures';

const execute = promisify(execFile);
const root = resolve(__dirname, '../..');

test('export variants change between Pair and debug workspace with the same warm Metro cache', async ({ page }, info) => {
 test.setTimeout(20 * 60 * 1000);
 const generated = info.outputPath('generated');
 const cache = join(generated, 'compiler-tmp');
 await mkdir(cache, { recursive: true });
 const servers: ChildProcess[] = [];
 try {
  for (const [index, debug] of ['0', '1', '0'].entries()) {
   const output = join(generated, `web-${index}-${debug}`);
   const result = await execute(process.env.ARMY_BUN || 'bun', [
    'node_modules/expo/bin/cli', 'export', '--platform', 'web', '--max-workers', '2', '--output-dir', output,
   ], { cwd: join(root, 'app'), timeout: 600000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, CI: '1', TMPDIR: cache, EXPO_PUBLIC_DEBUG: debug,
     EXPO_PUBLIC_DEBUG_AUTONAV: '0', EXPO_PUBLIC_DEMO: '0', EXPO_PUBLIC_DASH_VOICE_FAKE: '1' } });
   await writeFile(info.outputPath(`export-${index}.log`), result.stdout + result.stderr);
   const reservation = createServer();
   reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
   const address = reservation.address();
   if (!address || typeof address === 'string') throw Error('Missing loopback port');
   await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
   const server = spawn('python3', [join(root, 'e2e/mbp-army/serve.py'), output, String(address.port)], { stdio: 'ignore' });
   servers.push(server);
   const url = `http://127.0.0.1:${address.port}`;
   await expect.poll(async () => {
    if (server.exitCode !== null) throw Error('Isolated export server exited');
    try { return (await fetch(url)).status; } catch { return 0; }
   }).toBe(200);
   await page.goto(url, { waitUntil: 'domcontentloaded' });
   if (debug === '1') await expect(page.getByRole('tab', { name: 'Orchestra', exact: true })).toBeVisible();
   else await expect(page.getByPlaceholder('100.64.0.1', { exact: true })).toBeVisible();
   await page.screenshot({ path: info.outputPath(`variant-${index}-${debug}.png`) });
  }
 } finally {
  for (const server of servers) {
   if (server.exitCode === null && server.signalCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); }
  }
  await rm(generated, { recursive: true, force: true });
 }
});
