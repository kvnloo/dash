import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';

const root = resolve(__dirname, '../..');
const script = join(root, 'scripts/turbo/verify-served.sh');
const expected = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

type Identity = { manifest?: string; bundle?: string };

async function verify(identity: Identity) {
 const requests: string[] = [];
 const server = createServer((req, res) => {
  const path = req.url ?? '/';
  requests.push(path);
  if (path === '/status') { res.end('packager-status:running'); return; }
  if (path === '/') {
   const address = server.address();
   if (!address || typeof address === 'string') { res.writeHead(500).end(); return; }
   res.end(JSON.stringify({
    extra: { expoClient: {
     extra: identity.manifest === undefined ? {} : { dashBuild: { sha: identity.manifest } },
     _internal: { projectRoot: `/releases/${expected}/app` },
    } },
    launchAsset: { url: `http://127.0.0.1:${address.port}/advertised.bundle?platform=android` },
   }));
   return;
  }
  if (path === '/advertised.bundle?platform=android') {
   res.end(identity.bundle === undefined ? '// no build identity' : `{"sha":"${identity.bundle}"}`);
   return;
  }
  res.writeHead(404).end();
 });
 const listening = Promise.withResolvers<void>();
 server.once('error', listening.reject);
 server.listen(0, '127.0.0.1', () => listening.resolve());
 await listening.promise;
 try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Metro fixture did not bind a TCP port');
  const result = Promise.withResolvers<{ code: number | null; stdout: string; stderr: string }>();
  const child = spawn('bash', [script, '--host', '127.0.0.1', '--port', String(address.port), '--sha', expected], {
   cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('error', result.reject);
  child.once('close', code => result.resolve({ code, stdout, stderr }));
  return { ...await result.promise, requests };
 } finally {
  const closed = Promise.withResolvers<void>();
  server.close(error => error ? closed.reject(error) : closed.resolve());
  await closed.promise;
 }
}

for (const scenario of [
 { name: 'matching manifest and baked identity passes', identity: { manifest: expected, bundle: expected }, pass: true },
 { name: 'mismatched manifest identity fails', identity: { manifest: other, bundle: expected }, pass: false },
 { name: 'missing manifest identity fails even when release directory matches', identity: { bundle: expected }, pass: false },
 { name: 'wrong baked identity fails', identity: { manifest: expected, bundle: other }, pass: false },
 { name: 'missing baked identity fails', identity: { manifest: expected }, pass: false },
]) {
 test(`served identity: ${scenario.name}`, async () => {
  const result = await verify(scenario.identity);
  expect(result.requests).toContain('/advertised.bundle?platform=android');
  if (scenario.pass) {
   expect(result.code, result.stderr).toBe(0);
   expect(result.stdout).toMatch(/^PASS$/m);
  } else {
   expect(result.code, result.stderr).not.toBe(0);
   expect(result.stdout).toMatch(/^FAILED$/m);
   expect(result.stdout).not.toMatch(/^PASS$/m);
  }
 });
}
