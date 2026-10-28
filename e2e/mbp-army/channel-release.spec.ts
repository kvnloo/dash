import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';

const execute = promisify(execFile);
const root = resolve(__dirname, '../..');
const script = join(root, 'scripts/channels/dash-channel');

async function channel(args: string[], env: NodeJS.ProcessEnv) {
 const { promise, resolve: complete, reject } = Promise.withResolvers<{ code: number | null; stdout: string; stderr: string }>();
 const child = spawn('bash', [script, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
 let stdout = '', stderr = '';
 child.stdout.on('data', chunk => { stdout += chunk; });
 child.stderr.on('data', chunk => { stderr += chunk; });
 child.once('error', reject);
 child.once('close', code => complete({ code, stdout, stderr }));
 return promise;
}

for (const operation of ['switch', 'promote', 'rollback', 'nightly']) {
 test(`channel approval: ${operation} cannot activate or pin an unreceipted build`, async ({}, info) => {
  const dir = await mkdtemp(join(tmpdir(), 'dash-army-channel-'));
  const home = join(dir, 'channels');
  const releases = join(dir, 'releases');
  try {
   const sha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
   const previous = (await execute('git', ['rev-parse', 'HEAD^'], { cwd: root })).stdout.trim();
   await mkdir(join(home, 'ch'), { recursive: true });
   await execute('git', ['clone', '--bare', '--shared', root, join(home, 'repo.git')]);
   for (const revision of [sha, previous]) {
    const release = join(releases, revision);
    await mkdir(release, { recursive: true });
    await execute('bash', ['-o', 'pipefail', '-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'army-release', root, revision, release]);
    await symlink(join(root, 'app/node_modules'), join(release, 'app/node_modules'));
   }
   await symlink(join(releases, sha), join(home, 'ch/candidate'));
   await symlink(join(releases, previous), join(home, 'ch/stable'));
   await symlink(join(releases, previous), join(home, 'active'));
   await writeFile(join(home, 'channels.tsv'), `candidate\t${sha}\ttrack\nstable\t${previous}\tpin\n`);
   await writeFile(join(home, 'active.channel'), operation === 'nightly' ? 'candidate\n' : 'stable\n');
   await writeFile(join(home, 'previous'), `${sha}\tcandidate\n`);
   const state = async () => ({
    active: await readlink(join(home, 'active')),
    stable: await readlink(join(home, 'ch/stable')),
    channel: await readFile(join(home, 'active.channel'), 'utf8'),
    previous: await readFile(join(home, 'previous'), 'utf8'),
    table: await readFile(join(home, 'channels.tsv'), 'utf8'),
   });
   const before = await state();
   const env = {
    ...process.env, HOME: dir, XDG_STATE_HOME: join(dir, 'state'),
    DASH_CHANNEL_CONF_DIR: join(dir, 'config'), DASH_CHANNELS_HOME: home,
    DASH_RELEASES_DIR: releases, DASH_CHANNEL_REPO_URL: root,
    DASH_ARMY_RECEIPTS: join(dir, 'receipts'), DASH_CHANNEL_REQUIRE_RECEIPT: '0',
    // A denied transition must not reach service control; even buggy source cannot restart host services.
    DASH_CHANNEL_SYSTEMCTL: '/usr/bin/false', DASH_CHANNEL_HEALTH_CMD: 'false',
   };
   const args = operation === 'switch' ? ['switch', 'candidate', '--force']
    : operation === 'promote' ? ['promote', 'candidate', 'stable'] : [operation];
   const result = await channel(args, env);
   const after = await state();
   await writeFile(info.outputPath('channel-result.json'), JSON.stringify({ operation, sha, previous, before, after, result }, null, 2));
   expect.soft(result.stderr).toContain('O15 DENY');
   expect(after).toEqual(before);
   if (operation === 'nightly') {
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('held-no-green-army-receipt');
   } else expect(result.code).not.toBe(0);
  } finally { await rm(dir, { recursive: true, force: true }); }
 });
}
