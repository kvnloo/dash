// DA-022: the computer stays reachable across restarts, and a new host joins through
// z0bridge with no second pairing (#5, #79, #563).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, pair, openChat, send, composer, createBridge, type Bridge } from './fixtures';
import { startFixtureZ0bridge } from './fixture-z0bridge';

const root = resolve(__dirname, '../..');
const installer = join(root, 'scripts/restart/install-groot.sh');

/** systemd unit `[Section]` → key → values (repeated keys keep every value). */
function unit(text: string): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  let section = '';
  for (const line of text.split('\n').map(l => l.trim())) {
    if (!line || line.startsWith('#')) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head?.[1]) { section = head[1]; out.set(section, out.get(section) ?? new Map()); continue; }
    const cut = line.indexOf('=');
    if (cut < 0 || !section) continue;
    const keys = out.get(section)!;
    const key = line.slice(0, cut); keys.set(key, [...keys.get(key) ?? [], line.slice(cut + 1)]);
  }
  return out;
}

test('groot systemd user unit restarts the bridge always and starts at boot without a login', async ({}, info) => {
  const dir = await mkdtemp(join(process.env.ARMY_TMP || tmpdir(), 'dash-restart-'));
  const rendered = execFileSync('bash', [installer, '--render', join(dir, 'render')], { encoding: 'utf8' }).trim();
  const text = await readFile(rendered, 'utf8');
  await writeFile(info.outputPath('dash-bridge.service'), text);
  const u = unit(text);
  expect(u.get('Service')?.get('Restart')).toEqual(['always']);
  expect(Number(u.get('Service')?.get('RestartSec')?.[0])).toBeLessThanOrEqual(5);
  // Tailscale may come up after the user manager at boot: systemd must never give up retrying.
  expect(u.get('Unit')?.get('StartLimitIntervalSec')).toEqual(['0']);
  expect(u.get('Install')?.get('WantedBy')).toEqual(['default.target']);
  expect(u.get('Service')?.get('ExecStart')?.[0]).toMatch(/^%h\/\.bun\/bin\/bun index\.ts$/);
  expect(u.get('Service')?.get('WorkingDirectory')).toEqual(['%h/.local/lib/dash/bridge-current/bridge']);
  // A drain (docs/turbo.md) gets its full 10 minutes before systemd escalates.
  expect(Number(u.get('Service')?.get('TimeoutStopSec')?.[0])).toBeGreaterThanOrEqual(600);
  // Host data only through the optional env file; no address, user or home path in the unit.
  expect(u.get('Service')?.get('EnvironmentFile')).toEqual(['-%h/.config/dash/bridge.env']);
  expect(text).not.toMatch(/\/home\/|\/Users\/|\b100\.\d+\.\d+\.\d+\b/);

  // Run the real installer against a scratch HOME with recording systemctl/loginctl stand-ins.
  const home = join(dir, 'home'); const bin = join(dir, 'bin'); const calls = join(dir, 'calls.log');
  await mkdir(join(home, '.bun/bin'), { recursive: true }); await mkdir(join(home, '.local/lib/dash/bridge-current/bridge'), { recursive: true });
  await mkdir(join(home, '.config/systemd/user'), { recursive: true }); await mkdir(bin);
  await writeFile(join(home, '.bun/bin/bun'), '#!/bin/sh\n'); await chmod(join(home, '.bun/bin/bun'), 0o755);
  await writeFile(join(home, '.local/lib/dash/bridge-current/bridge/index.ts'), '');
  await writeFile(join(home, '.config/systemd/user/dash-channel-metro.service'), '[Service]\nExecStart=/bin/true\n');
  const state = join(dir, 'linger');
  await writeFile(join(bin, 'loginctl'), `#!/bin/sh\necho "loginctl $*" >> '${calls}'\ncase "$1" in show-user) cat '${state}' 2>/dev/null || echo no;; enable-linger) echo yes > '${state}';; esac\n`);
  await writeFile(join(bin, 'systemctl'), `#!/bin/sh\necho "systemctl $*" >> '${calls}'\ncase "$2" in is-enabled) echo enabled;; is-active) echo active;; show) echo "Restart=always"; echo "MainPID=4242";; cat) exit 1;; esac\n`);
  await chmod(join(bin, 'loginctl'), 0o755); await chmod(join(bin, 'systemctl'), 0o755);
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, USER: 'army', XDG_CONFIG_HOME: join(home, '.config'), DASH_RESTART_UNITS: 'dash-channel-metro.service dash-channel-relay.service' };
  const out = execFileSync('bash', [installer], { env, encoding: 'utf8' });
  const log = await readFile(calls, 'utf8');
  await writeFile(info.outputPath('installer-calls.log'), log + '\n--- stdout\n' + out);
  expect(log).toContain('loginctl enable-linger army');
  expect(log).toContain('systemctl --user daemon-reload');
  expect(log).toContain('systemctl --user enable dash-bridge.service');
  expect(log).toContain('systemctl --user restart dash-bridge.service');
  // The Metro unit that exists is enabled too; a missing relay unit is skipped, not created.
  expect(log).toContain('systemctl --user enable --now dash-channel-metro.service');
  expect(log).not.toContain('dash-channel-relay.service --now');
  expect(log).not.toContain('enable --now dash-channel-relay.service');
  expect(await readFile(join(home, '.config/systemd/user/dash-bridge.service'), 'utf8')).toBe(text);
  expect(existsSync(join(home, '.config/dash/bridge.env'))).toBe(true);
  expect(out).toMatch(/linger\s+yes/);
  // Re-running with the same unit starts instead of restarting (no turns cancelled) and lingers once.
  await writeFile(calls, '');
  execFileSync('bash', [installer], { env, encoding: 'utf8' });
  const again = await readFile(calls, 'utf8');
  expect(again).toContain('systemctl --user start dash-bridge.service');
  expect(again).not.toContain('restart dash-bridge.service');
  expect(again).not.toContain('enable-linger');
});

test('bridge killed with SIGKILL and restarted by its supervisor reconnects the paired app with no user action', async ({ page, bridge }) => {
  await openChat(page, bridge);
  const token = (await readFile(join(bridge.dir, '.dash', 'token'), 'utf8')).trim();
  await send(page, 'before the crash');
  await expect(page.getByText(/ARMY_REPLY: before the crash/).first()).toBeVisible();
  await bridge.stop('SIGKILL');
  await composer(page).fill('after the crash');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled({ timeout: 15000 });
  // What launchd KeepAlive / systemd Restart=always do: the same bridge comes back on its port.
  await bridge.start();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('button', { name: 'Send', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText(/ARMY_REPLY: after the crash/).first()).toBeVisible();
  // Same credential, no Pair screen: the phone did nothing.
  expect((await readFile(join(bridge.dir, '.dash', 'token'), 'utf8')).trim()).toBe(token);
  await expect(page.getByRole('button', { name: 'Pair over Tailscale', exact: true })).toHaveCount(0);
});

type Node = { HostName: string; DNSName: string; Online: boolean; OS: string; TailscaleIPs: string[] };
const node = (name: string): Node => ({ HostName: name, DNSName: `${name}.army.ts.net.`, Online: true, OS: 'linux', TailscaleIPs: ['127.0.0.1'] });
const hostAgents = (body: unknown, id: string): unknown[] | undefined => {
  if (typeof body !== 'object' || body === null || !('hosts' in body) || !Array.isArray(body.hosts)) throw Error('Missing roster hosts');
  const host: unknown = body.hosts.find((h: unknown) => typeof h === 'object' && h !== null && 'id' in h && h.id === id);
  return typeof host === 'object' && host !== null && 'agents' in host && Array.isArray(host.agents) ? host.agents : undefined;
};

test('a new host enrolled with the same z0bridge appears in Chats and Hosts without a second pairing code', async ({ page }, info) => {
  const scratch = await mkdtemp(join(process.env.ARMY_TMP || tmpdir(), 'dash-z0mesh-'));
  const z0 = await startFixtureZ0bridge(scratch);
  const bridges: Bridge[] = [];
  try {
    // First the new computer still trusts a different z0bridge (its own authority).
    const stranger = await createBridge(true, { finishedSessions: true, identity: true }); bridges.push(stranger);
    const port = stranger.port;
    // groot: the one bridge the phone pairs with. Its z0bridge enrollment (dash:chat) is all it
    // needs to reach other hosts; there is no peer-roster-tokens.json.
    const groot = await createBridge(true, { rosterHost: 'groot', finishedSessions: true, identity: z0, peerIdentity: z0, peerPort: port }); bridges.push(groot);
    expect(existsSync(join(groot.dir, '.dash', 'peer-roster-tokens.json'))).toBe(false);
    await pair(page, groot);
    const pairClaims = (b: Bridge) => b.logs().split('pair.claim').length - 1;
    expect(pairClaims(groot)).toBe(1);
    await page.getByRole('tab', { name: 'Hosts', exact: true }).click({ noWaitAfter: true });
    await expect(page.getByTestId('tree-row-host:mbp')).toHaveCount(0);

    const token = (await readFile(join(groot.dir, '.dash', 'token'), 'utf8')).trim();
    const roster = async () => (await page.request.get(`http://127.0.0.1:${groot.port}/roster`, { headers: { Authorization: `Bearer ${token}` } })).json();
    // mbp joins the tailnet. Nothing is typed on the phone and nothing is copied to groot.
    await writeFile(join(groot.dir, 'tailscale.json'), JSON.stringify({ Self: node('groot'), Peer: { mbp: node('mbp') } }));
    // groot presents a minted token, and a bridge on another z0bridge refuses it: no chats leak in.
    await expect.poll(() => z0.mintedBy(groot.peerCredentialId ?? ''), { timeout: 20000 }).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${port}/roster?local=1`, { headers: { Authorization: `Bearer ${z0.identityToken()}` } })).status).toBe(401);
    expect(hostAgents(await roster(), 'mbp') ?? []).toEqual([]);

    // The owner enrolls mbp's bridge with the same z0bridge (same machine, same port). Still no pairing.
    await stranger.dispose(); bridges.splice(bridges.indexOf(stranger), 1);
    const mbp = await createBridge(true, { finishedSessions: true, identity: z0, env: { DASH_PORT: String(port) } }); bridges.push(mbp);
    expect(mbp.port).toBe(port);
    // Count-free on purpose: the exact count depends on which fixture OMP holders a bridge can see.
    await expect(page.getByTestId('tree-row-host:mbp')).toContainText(/\b[1-9]\d* chats\b/, { timeout: 30000 });
    await page.screenshot({ path: info.outputPath('z0bridge-new-host.png') });
    await page.getByRole('tab', { name: 'Chats', exact: true }).click({ noWaitAfter: true });
    // The Chats head refreshes on its own every 30 s (HEAD_TTL_MS): no reload, no tap.
    const row = page.getByTestId('chat-row-mbp:codex:army-finished-codex');
    await expect(row).toHaveCount(1, { timeout: 45000 });
    await row.scrollIntoViewIfNeeded();
    await expect(row).toContainText('ARMY finished Codex native chat');
    expect(hostAgents(await roster(), 'mbp')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'codex', sessionId: 'army-finished-codex', hostId: 'mbp' }),
      expect.objectContaining({ kind: 'claude', sessionId: 'army-finished-claude', hostId: 'mbp' }),
      expect.objectContaining({ kind: 'hermes', sessionId: 'army-fixture-session', hostId: 'mbp' }),
    ]));
    // One pairing in total, on groot; mbp never ran one.
    expect(pairClaims(groot)).toBe(1);
    expect(pairClaims(mbp)).toBe(0);

    await writeFile(info.outputPath('z0bridge-mesh-roster.json'), JSON.stringify(await roster(), null, 2));
  } finally {
    for (const [i, b] of [...bridges].reverse().entries()) { await b.dispose(); await writeFile(info.outputPath(`bridge-${i}.log`), b.logs()); }
    await z0.stop();
  }
});
