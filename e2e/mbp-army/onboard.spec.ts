// One-command onboarding (#564): scripts/onboard.sh on a fresh HOME installs the bridge (+ Metro) as
// launchd agents or systemd user services, lists the harnesses it found, and the real web app pairs
// from the link it prints. The service managers are fixture-service-manager.ts: it starts exactly
// what the written plist/unit says (program, environment, working folder, log), nothing more.
// Native acceptance on a Mac and a phone is not claimed by these journeys.
import { test, expect, web, chooseHarness, composer } from './fixtures';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.env.ARMY_BRIDGE_ROOT || resolve(__dirname, '../..');
const bun = process.env.ARMY_BUN || execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
// Codex runs through the pinned codex-acp adapter; whether it is ready depends only on that install in this checkout.
const codexAdapter = existsSync(join(root, 'bridge', 'acp-adapters', 'node_modules', '.bin', 'codex-acp'));
const ready = ['OMP', 'Hermes', 'Claude Code', ...(codexAdapter ? ['Codex'] : [])];
const missing = ['Grok', 'Pi', 'fx', ...(codexAdapter ? [] : ['Codex'])];
const readyLine = new RegExp(`^harnesses \\(${ready.length} of 7 ready\\)$`, 'm');

type Home = { dir: string; bin: string; env: Record<string, string>; bridgeEnv: string[] };

async function freePort(): Promise<number> {
 const server = createServer();
 await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
 const address = server.address();
 await new Promise<void>(r => server.close(() => r()));
 if (!isRecord(address) || typeof address.port !== 'number') throw Error('no free port');
 return address.port;
}

/** A fresh machine: an empty HOME with only the agent CLIs this journey installs on PATH. */
async function freshHome(): Promise<Home> {
 const dir = await mkdtemp(join(process.env.ARMY_TMP || tmpdir(), 'dash-onboard-'));
 const bin = join(dir, 'bin');
 await mkdir(bin); await mkdir(join(dir, 'tmp')); await mkdir(join(dir, 'work'));
 const agent = (extra = '') => '#!/bin/sh\nexec ' + quote(bun) + ' ' + quote(join(__dirname, 'fixture-agent.ts')) + extra + '\n';
 for (const name of ['omp', 'hermes']) await writeFile(join(bin, name), agent(), { mode: 0o700 });
 for (const name of ['claude', 'claude-agent-acp']) await writeFile(join(bin, name), agent(' claude'), { mode: 0o700 });
 for (const tool of ['launchctl', 'systemctl', 'plutil']) await writeFile(join(bin, tool), '#!/bin/sh\nexec ' + quote(bun) + ' ' + quote(join(__dirname, 'fixture-service-manager.ts')) + ' ' + tool + ' "$@"\n', { mode: 0o700 });
 await writeFile(join(bin, 'tailscale'), '#!/bin/sh\nexit 1\n', { mode: 0o700 }); // not signed in to a tailnet
 const env = { HOME: dir, TMPDIR: join(dir, 'tmp'), PATH: bin + ':' + dirname(bun) + ':/usr/bin:/bin', XDG_CONFIG_HOME: join(dir, '.config'), XDG_STATE_HOME: join(dir, '.local', 'state'), LANG: 'C.UTF-8', USER: 'army' };
 // Loopback verification mode instead of a tailnet address (bridge/PAIRING.md), plus the army's isolation.
 const bridgeEnv = ['DASH_HOST=127.0.0.1', 'DASH_ALLOW_LOOPBACK=1', 'DASH_ALLOWED_ORIGINS=' + web, 'DASH_ENABLE_LEGACY_CLI=0', 'DASH_STT_MODEL=' + join(dir, 'no-model'),
  'HERMES_HOME=' + join(dir, '.hermes'), 'DASH_HERMES_ROOT=' + join(dir, '.hermes'), 'DASH_KANBAN_DB=' + join(dir, 'work.db'), 'DASH_FLEET_REGISTRY=' + join(dir, 'fleet.yaml'), 'DASH_Z0LIVE_SESSIONS=' + join(dir, 'z0live')];
 return { dir, bin, env, bridgeEnv };
}

async function onboard(h: Home, args: string[], timeoutMs = 240000): Promise<{ code: number | null; out: string }> {
 const child = spawn('bash', [join(root, 'scripts', 'onboard.sh'), ...args], { cwd: h.dir, env: h.env, stdio: ['ignore', 'pipe', 'pipe'] });
 let out = '';
 child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
 const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
 const code = await new Promise<number | null>(r => child.on('exit', c => r(c)));
 clearTimeout(timer);
 return { code, out };
}

/** Whatever a journey left running under the fixture service manager is stopped. */
async function stopLeftovers(h: Home): Promise<void> {
 const state = join(h.dir, '.army-services');
 if (!existsSync(state)) return;
 for (const f of await readdir(state)) if (f.endsWith('.pid')) { try { process.kill(-Number(await readFile(join(state, f), 'utf8')), 'SIGKILL'); } catch { /* gone */ } }
}

const plist = (file: string): Record<string, unknown> => {
 const parsed: unknown = JSON.parse(execFileSync('python3', ['-I', '-c', 'import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', file], { encoding: 'utf8' }));
 if (!isRecord(parsed)) throw Error('plist root');
 return parsed;
};

async function stateFile(h: Home): Promise<{ link: string; expoGoLink?: string; harnesses: { id: string; ready: boolean }[]; profile: string }> {
 const raw: unknown = JSON.parse(await readFile(join(h.dir, '.dash', 'onboard.json'), 'utf8'));
 if (!isRecord(raw) || !isRecord(raw.pair) || typeof raw.pair.link !== 'string' || !Array.isArray(raw.harnesses) || typeof raw.profile !== 'string') throw Error('onboard.json shape');
 const harnesses = raw.harnesses.filter(isRecord).map(x => ({ id: String(x.id), ready: x.ready === true }));
 return { link: raw.pair.link, ...(typeof raw.pair.expoGoLink === 'string' ? { expoGoLink: raw.pair.expoGoLink } : {}), harnesses, profile: raw.profile };
}

const refused = async (port: number) => fetch(`http://127.0.0.1:${port}/`).then(() => false, () => true);

test.describe.configure({ mode: 'parallel' });
test.afterEach(async ({ page }, info) => { if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') }); });

test('one command on a fresh Mac installs bridge and Metro launch agents, lists harnesses, and the phone pairs from the printed link', async ({ page }, info) => {
 test.setTimeout(420000);
 const h = await freshHome();
 const port = await freePort(), metroPort = await freePort();
 // A hand-written Studio plist is kept, not silently lost.
 const agents = join(h.dir, 'Library', 'LaunchAgents');
 await mkdir(agents, { recursive: true });
 const manual = '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>dev.kvnloo.dash-bridge</string>'
  + '<key>EnvironmentVariables</key><dict><key>DASH_TURN_TIMEOUT_MS</key><string>900000</string><key>PATH</key><string>/opt/army-agents/bin:/usr/bin</string></dict></dict></plist>\n';
 await writeFile(join(agents, 'dev.kvnloo.dash-bridge.plist'), manual);
 try {
  // App deps and ACP adapters are already installed in the army checkout; their install paths need a network.
  const run = await onboard(h, ['--full', '--platform', 'darwin', '--skip', 'app-deps,adapters', '--port', String(port), '--metro-port', String(metroPort), '--cwd', join(h.dir, 'work'), ...h.bridgeEnv.flatMap(e => ['--env', e])]);
  await writeFile(info.outputPath('onboard.log'), run.out);
  expect(run.code, run.out).toBe(0);
  expect(run.out).toMatch(/^hardware\s+darwin \S+ · .+ · \d+ cores · [\d.]+ GiB/m);
  expect(run.out).toMatch(/^profile\s+full$/m);
  expect(run.out).toContain('kept       from the existing ' + join(agents, 'dev.kvnloo.dash-bridge.plist') + ': DASH_TURN_TIMEOUT_MS');
  expect(run.out).toMatch(readyLine);
  for (const name of ready) expect(run.out).toMatch(new RegExp(`^  ready\\s+${name}\\s+/`, 'm'));
  for (const name of missing) expect(run.out).toMatch(new RegExp(`^  missing\\s+${name}\\s`, 'm'));
  expect(run.out).toContain('healthy    bridge ws://127.0.0.1:' + port + '/ws');
  expect(run.out).toContain('healthy    Metro http://127.0.0.1:' + metroPort);
  expect(run.out).not.toContain(await readFile(join(h.dir, '.dash', 'bootstrap-token'), 'utf8').then(t => t.trim()));

  // The launch agents launchd would load: absolute Bun, captured PATH (harness CLIs survive launchd's bare PATH).
  expect(await readFile(join(agents, 'dev.kvnloo.dash-bridge.plist.before-onboard'), 'utf8')).toBe(manual);
  const bridgePlist = plist(join(agents, 'dev.kvnloo.dash-bridge.plist'));
  expect(bridgePlist.Label).toBe('dev.kvnloo.dash-bridge');
  expect(bridgePlist.ProgramArguments).toEqual([expect.stringMatching(/bun$/), 'run', 'index.ts']);
  expect(bridgePlist.WorkingDirectory).toBe(join(root, 'bridge'));
  expect(bridgePlist.KeepAlive).toBe(true); expect(bridgePlist.RunAtLoad).toBe(true);
  const benv = isRecord(bridgePlist.EnvironmentVariables) ? bridgePlist.EnvironmentVariables : {};
  expect(String(benv.PATH).split(':')).toContain(h.bin);
  expect(String(benv.PATH).split(':')).toContain('/opt/army-agents/bin'); // the hand-written agent's PATH is not lost
  expect(benv.DASH_TURN_TIMEOUT_MS).toBe('900000'); // nor its other settings
  expect(benv).toMatchObject({ DASH_PORT: String(port), DASH_CWD: join(h.dir, 'work'), DASH_EXPO_GO_URL: '127.0.0.1:' + metroPort, HOME: h.dir });
  const metroPlist = plist(join(agents, 'dev.kvnloo.dash-metro.plist'));
  expect(metroPlist.ProgramArguments).toEqual(expect.arrayContaining(['node_modules/expo/bin/cli', 'start', '--port', String(metroPort)]));
  expect(metroPlist.WorkingDirectory).toBe(join(root, 'app'));
  expect(await (await fetch(`http://127.0.0.1:${metroPort}/status`)).text()).toContain('packager-status:running');

  // The phone: open the printed pairing link, paste the bootstrap token, Pair with code.
  const state = await stateFile(h);
  expect(state.profile).toBe('full');
  expect(state.harnesses.filter(x => x.ready).map(x => x.id).sort()).toEqual(['claude', 'hermes', 'omp', ...(codexAdapter ? ['codex'] : [])].sort());
  const link = new URL(state.link);
  expect(link.protocol).toBe('dash:');
  expect(link.searchParams.get('address')).toBe('127.0.0.1:' + port);
  expect(link.searchParams.get('code')).toMatch(/^[A-Z2-9]{6}$/);
  expect(state.expoGoLink).toBe(`exp://127.0.0.1:${metroPort}/--/connect${link.search}`);
  await page.goto(web + '/connect' + link.search, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Link filled the address and code. Paste the bootstrap token, then Pair with code.')).toBeVisible({ timeout: 120000 });
  await page.getByLabel('Bootstrap token', { exact: true }).fill((await readFile(join(h.dir, '.dash', 'bootstrap-token'), 'utf8')).trim());
  await page.getByRole('button', { name: 'Pair with code', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('tab').nth(1)).toBeVisible({ timeout: 25000 });
  await page.getByRole('tab').nth(1).click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane')).toBeVisible();

  // The harnesses onboarding listed are the ones the phone can use, and a turn reaches one.
  await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
  await expect(composer(page)).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click({ noWaitAfter: true });
  const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({ has: page.getByText('New chat', { exact: true }) });
  await expect(row).toHaveCount(1);
  await row.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByRole('button', { name: 'Options. Current surface: Chat', exact: true }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: /^Harness,/ }).click({ noWaitAfter: true });
  for (const name of ready) await expect(page.getByRole('button', { name: new RegExp('^' + name) }).last()).toBeEnabled();
  for (const name of missing.filter(n => n === 'Codex' || n === 'Grok')) await expect(page.getByRole('button', { name: new RegExp('^' + name) }).last()).toBeDisabled();
  await page.getByRole('button', { name: 'Close harness picker', exact: true }).click({ noWaitAfter: true });
  await chooseHarness(page, 'OMP');
  await composer(page).fill('ARMY onboarded turn');
  await page.getByRole('button', { name: 'Send', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText(/ARMY_REPLY: ARMY onboarded turn/).first()).toBeVisible({ timeout: 30000 });
  const turns = await readFile(join(h.dir, 'army-acp-calls.jsonl'), 'utf8');
  expect(turns).toContain(JSON.stringify(join(h.dir, 'work'))); // the --cwd folder became the agents' working folder

  // Reversible: --uninstall stops both agents and removes their plists; credentials stay.
  const off = await onboard(h, ['--uninstall', '--platform', 'darwin'], 60000);
  await writeFile(info.outputPath('uninstall.log'), off.out);
  expect(off.code, off.out).toBe(0);
  expect(existsSync(join(agents, 'dev.kvnloo.dash-bridge.plist'))).toBe(false);
  expect(existsSync(join(agents, 'dev.kvnloo.dash-metro.plist'))).toBe(false);
  expect(existsSync(join(h.dir, '.dash', 'bootstrap-token'))).toBe(true);
  await expect.poll(() => refused(port)).toBe(true);
  await expect.poll(() => refused(metroPort)).toBe(true);
 } finally { await stopLeftovers(h); }
});

test('minimal onboarding on Linux refuses without a tailnet or on a busy port, then installs a systemd user bridge and prints a fresh pairing code', async ({}, info) => {
 test.setTimeout(240000);
 const h = await freshHome();
 const port = await freePort();
 const units = join(h.dir, '.config', 'systemd', 'user');
 try {
  const plan = await onboard(h, ['--minimal', '--platform', 'linux', '--dry-run', '--port', String(port)], 60000);
  expect(plan.code, plan.out).toBe(0);
  expect(plan.out).toContain('dry run: nothing was installed, written or started');
  expect(plan.out).toContain('--- ' + join(units, 'dash-bridge.service') + ' ---');
  expect(existsSync(units)).toBe(false);

  const noTailnet = await onboard(h, ['--minimal', '--platform', 'linux', '--port', String(port)], 60000);
  expect(noTailnet.code).toBe(2);
  expect(noTailnet.out).toContain('no Tailscale address found; the bridge only listens on your tailnet');
  expect(existsSync(units)).toBe(false);

  // An older bridge started by hand still holds the port: refuse instead of reporting its health.
  const squatter = createServer(socket => socket.end());
  await new Promise<void>(r => squatter.listen(port, '127.0.0.1', r));
  const busy = await onboard(h, ['--minimal', '--platform', 'linux', '--skip', 'deps,adapters', '--port', String(port), ...h.bridgeEnv.flatMap(e => ['--env', e])], 60000);
  await new Promise<void>(r => squatter.close(() => r()));
  expect(busy.code, busy.out).toBe(2);
  expect(busy.out).toContain(`127.0.0.1:${port} is already in use by another process`);
  expect(existsSync(join(h.dir, '.dash', 'onboard.json'))).toBe(false);

  const run = await onboard(h, ['--minimal', '--platform', 'linux', '--skip', 'adapters', '--port', String(port), ...h.bridgeEnv.flatMap(e => ['--env', e])]);
  await writeFile(info.outputPath('onboard.log'), run.out);
  expect(run.code, run.out).toBe(0);
  expect(run.out).toMatch(readyLine);
  expect(run.out).toContain('started    dash-bridge.service');
  expect(run.out).not.toContain('dash-metro');
  const unit = await readFile(join(units, 'dash-bridge.service'), 'utf8');
  expect(unit).toMatch(/^ExecStart=".*bun" "run" "index\.ts"$/m);
  expect(unit).toContain('WorkingDirectory=' + join(root, 'bridge'));
  expect(unit).toContain('Restart=always');
  expect(/^Environment="PATH=([^"]*)"$/m.exec(unit)?.[1]?.split(':')).toContain(h.bin);
  expect(existsSync(join(units, 'dash-metro.service'))).toBe(false);
  const calls = await readFile(join(h.dir, '.army-services', 'calls.log'), 'utf8');
  expect(calls).toContain('systemctl --user daemon-reload');
  expect(calls).toContain('systemctl --user restart dash-bridge.service');
  const first = await stateFile(h);
  expect(first.profile).toBe('minimal');
  expect(first.expoGoLink).toBe(`exp://127.0.0.1:8097/--/connect${new URL(first.link).search}`); // no Metro service: the bridge default

  const pair = await onboard(h, ['--pair'], 60000);
  expect(pair.code, pair.out).toBe(0);
  const code = /pair the phone \(code ([A-Z2-9]{6}), valid until/.exec(pair.out)?.[1];
  expect(code).toBeTruthy();
  expect(pair.out).toContain(`link       dash://connect?address=127.0.0.1%3A${port}&code=${code}`);

  // A rerun with no flags keeps the earlier settings (loopback mode, port) and restarts the same bridge.
  const again = await onboard(h, ['--minimal', '--platform', 'linux', '--skip', 'deps,adapters'], 90000);
  expect(again.code, again.out).toBe(0);
  expect(again.out).toMatch(/^kept {7}from the existing .*dash-bridge\.service: .*DASH_HOST/m);
  expect(again.out).toContain('healthy    bridge ws://127.0.0.1:' + port + '/ws');
  expect(await readFile(join(units, 'dash-bridge.service'), 'utf8')).toBe(unit);

  const off = await onboard(h, ['--uninstall', '--platform', 'linux'], 60000);
  expect(off.code, off.out).toBe(0);
  expect(existsSync(join(units, 'dash-bridge.service'))).toBe(false);
  await expect.poll(() => refused(port)).toBe(true);
 } finally { await stopLeftovers(h); }
});
