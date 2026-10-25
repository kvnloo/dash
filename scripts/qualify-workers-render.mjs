// Isolated browser proof of the actual hook + strip; no phone or shared service.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { identityFixture } from '../shared/identity-fixture.test-helper.ts';
import { sessionWorkersHttp } from '../bridge/src/hermes-workers.ts';

const out = 'qualification';
await mkdir(out, { recursive: true });
const bootstrapPath = 'app/src/bootstrap.web.tsx';
const original = await readFile(bootstrapPath, 'utf8');
const sources = ['app/src/components/WorkersStrip.tsx', 'app/src/lib/session-workers.ts'];
const hashes = Object.fromEntries(await Promise.all(sources.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const proofPath = 'app/workers-proof.tsx';
const authority = identityFixture();
const access = authority.token();
const credential = `z0bc.cred_0123456789abcdef.${'x'.repeat(43)}`;
const workers = [
  { id: 'test-worker', title: 'Verify unit tests', phase: 'tool', tool: 'terminal', startedAt: Date.now() - 30000, lastActivityAt: Date.now() },
  { id: 'review-worker', title: 'Review transport repair', phase: 'thinking', startedAt: Date.now() - 20000, lastActivityAt: Date.now() },
];
let completed = false;
let minted = 0;
let rejected = 0;
let accepted = 0;
let browser;
let server;
try {
  await writeFile(proofPath, `import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSessionWorkers, WorkersStrip } from './src/components/WorkersStrip';
import type { Settings } from './src/model';
export default function WorkersProof() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [session, setSession] = useState('parent');
  useEffect(() => { void fetch('/proof-settings').then(r => r.json()).then(setSettings); }, []);
  const workers = useSessionWorkers(settings, true, 'clean', session);
  return <View style={{ flex: 1, backgroundColor: '#080908', justifyContent: 'flex-end', paddingBottom: 24 }}>
    <Text style={{ color: '#B4AFA3', padding: 16 }}>Delegation fixture · not a live model turn</Text>
    <WorkersStrip workers={workers} />
    <Pressable accessibilityRole="button" accessibilityLabel="Other chat" onPress={() => setSession('other')}><Text style={{ color: 'white', padding: 16 }}>Other chat</Text></Pressable>
    <Text style={{ color: '#B4AFA3', padding: 16 }}>Unsent draft remains here.</Text>
  </View>;
}
`);
  await writeFile(bootstrapPath, original.replace('import("../App")', 'import("../workers-proof")'));
  const build = Bun.spawn(['bun', 'node_modules/expo/bin/cli', 'export', '--platform', 'web', '--output-dir', '../qualification/web'], {
    cwd: 'app', env: { ...process.env, EXPO_PUBLIC_DASH_TURBO: '1' }, stdout: Bun.file(`${out}/export.log`), stderr: 'stdout',
  });
  assert.equal(await build.exited, 0, 'Expo export failed; see export.log');
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    const result = sessionWorkersHttp(request, request.headers.get('authorization') === `Bearer ${access}`, (_, session) => !completed && session === 'parent' ? workers : []);
    if (result) { if (result.status === 200) accepted++; else rejected++; return result; }
    if (url.pathname === '/proof-settings') return Response.json({
      address: `127.0.0.1:${server.port}`, token: '', harness: 'hermes', inAppFeedback: true,
      identity: { url: 'http://100.64.0.1:4788', issuer: authority.issuer, kid: authority.kid, credentialId: 'cred_0123456789abcdef' },
    });
    const file = Bun.file(`${out}/web${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`);
    return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
  } });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await context.addInitScript(value => localStorage.setItem('dash.z0bridge.cred_0123456789abcdef', value), credential);
  await context.route('http://100.64.0.1:4788/**', async route => {
    if (route.request().url().endsWith('/jwks.json')) return route.fulfill({ json: authority.jwks });
    assert.equal(route.request().headers().authorization, `Bearer ${credential}`);
    minted++;
    return route.fulfill({ json: { access_token: access, token_type: 'Bearer', scope: 'dash:chat', aud: 'dash', expires_in: 120 } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const strip = page.getByRole('button', { name: '2 subagents working', exact: true });
  await strip.waitFor({ timeout: 120000 });
  for (const width of [390, 412, 640]) {
    await page.setViewportSize({ width, height: 915 });
    await strip.click();
    await page.getByRole('treeitem', { name: /Verify unit tests/ }).waitFor();
    const bounds = await strip.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: `${out}/workers-expanded-${width}.png` });
    await strip.click();
    await page.screenshot({ path: `${out}/workers-collapsed-${width}.png` });
  }
  completed = true;
  await strip.waitFor({ state: 'hidden', timeout: 10000 });
  completed = false;
  await strip.waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Other chat', exact: true }).click();
  assert.equal(await strip.count(), 0, 'Old chat workers leaked into another chat');
  assert(minted > 0 && accepted > 0);
  assert.equal(rejected, 0);
  assert.deepEqual(errors, []);
  await writeFile(`${out}/render.json`, JSON.stringify({ hashes, fixture: true, widths: [390, 412, 640], minted, accepted, rejected, errors, assertions: ['identity-only authorization', 'visible count', 'expanded tree', 'completion removes strip', 'chat switch hides previous workers'] }, null, 2));
  console.log('Worker indicator rendered proof PASS');
} finally {
  await browser?.close();
  server?.stop(true);
  await writeFile(bootstrapPath, original);
  await rm(proofPath, { force: true });
}
