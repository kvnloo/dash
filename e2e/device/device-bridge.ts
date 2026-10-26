// Isolated Dash bridge for the S22 native device journey (MBP only).
// Same isolation as e2e/mbp-army/fixtures.ts createBridge: own HOME, credentials,
// gate/outbox, deterministic stdio ACP fixture agents for hermes/omp, PID namespace.
// Differences: binds the MBP's tailnet IPv4 on a fixed port so the S22 can reach it,
// and a tailscale shim answers only `tailscale ip -4` (no real tailnet roster reads).
//   bun device-bridge.ts <cand-dir> <state-dir> <port>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [cand, dir, portArg] = process.argv.slice(2);
if (!cand || !dir || !portArg) throw Error('usage: device-bridge.ts <cand-dir> <state-dir> <port>');
const army = process.env.ARMY_DIR || join(cand, 'e2e', 'mbp-army');  // fixture agents live with the candidate (army_cycle.sh)
const bun = process.env.ARMY_BUN || '/home/kvn/.bun/bin/bun';
const ip = (process.env.MBP_TAILNET_IP || '').trim();
if (!/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(ip)) throw Error('MBP_TAILNET_IP must be the tailnet IPv4');
const bin = join(dir, 'bin');
for (const d of [bin, join(dir, 'tmp'), join(dir, '.hermes'), join(dir, '.omp', 'agent')]) mkdirSync(d, { recursive: true });
const q = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
for (const name of ['hermes', 'omp']) writeFileSync(join(bin, name), '#!/bin/sh\nexec ' + q(bun) + ' ' + q(join(army, 'fixture-agent.ts')) + '\n', { mode: 0o700 });
writeFileSync(join(bin, 'tailscale'), `#!/bin/sh\n[ "$1 $2" = "ip -4" ] && { echo ${ip}; exit 0; }\nexit 1\n`, { mode: 0o700 });
const env: Record<string, string> = {
  ...process.env as Record<string, string>, HOME: dir, TMPDIR: join(dir, 'tmp'), PATH: bin + ':/home/kvn/.bun/bin:/usr/bin:/bin',
  DASH_HOST: ip, DASH_PORT: portArg, DASH_CWD: dir, HERMES_HOME: join(dir, '.hermes'), DASH_HERMES_ROOT: join(dir, '.hermes'),
  PI_CODING_AGENT_DIR: join(dir, '.omp', 'agent'), DASH_Z0LIVE_SESSIONS: join(dir, 'z0live'), XDG_CONFIG_HOME: join(dir, '.config'),
  DASH_CREDENTIAL_DIR: join(dir, '.dash'), DASH_CONFIG_DIR: join(dir, '.dash'), DASH_GATE_DIR: join(dir, 'gate'), DASH_GATE_ENABLED: '1',
  DASH_GATE_LIVE: '0', DASH_GATE_OWNER_DECISIONS: '0', ARMY_PERSIST_SESSION: '1', DASH_ENABLE_LEGACY_CLI: '0',
  DASH_STT_MODEL: join(dir, 'no-model'), ARMY_BRIDGE_ROOT: cand,
};
if (!existsSync(join(dir, 'gate', '.seeded'))) {
  const seed = Bun.spawnSync([bun, join(army, 'seed-gate.ts')], { env, stdout: 'inherit', stderr: 'inherit' });
  if (seed.exitCode !== 0) throw Error('gate seed failed');
  writeFileSync(join(dir, 'gate', '.seeded'), '1');
}
const child = spawn('bwrap', ['--bind', '/', '/', '--dev-bind', '/dev', '/dev', '--unshare-pid', '--proc', '/proc', '--die-with-parent', '/bin/sh', '-c',
  '"$1" "$2" & exec "$1" "$3"', 'device-bridge', bun, join(army, 'session-holder.ts'), join(cand, 'bridge/index.ts')],
  { cwd: cand, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, () => child.kill('SIGTERM'));
