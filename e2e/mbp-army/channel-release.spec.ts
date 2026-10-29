import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures';

const execute = promisify(execFile);
const root = resolve(__dirname, '../..');
const script = join(root, 'scripts/channels/dash-channel');

function isolatedEnv(dir: string): NodeJS.ProcessEnv {
 return {
  ...process.env, HOME: dir, XDG_STATE_HOME: join(dir, 'state'),
  DASH_CHANNEL_CONF_DIR: join(dir, 'config'), DASH_CHANNELS_HOME: join(dir, 'channels'),
  DASH_RELEASES_DIR: join(dir, 'releases'), DASH_CHANNEL_REPO_URL: root,
  DASH_ARMY_RECEIPTS: join(dir, 'receipts'), DASH_CHANNEL_REQUIRE_RECEIPT: '0',
  // A denied transition must not reach service control; even buggy source cannot restart host services.
  DASH_CHANNEL_SYSTEMCTL: '/usr/bin/false', DASH_CHANNEL_HEALTH_CMD: 'false',
 };
}

async function archiveRelease(releases: string, revision: string) {
 const release = join(releases, revision);
 await mkdir(release, { recursive: true });
 await execute('bash', ['-o', 'pipefail', '-c', 'git -C "$1" archive "$2" | tar -x -C "$3"', 'army-release', root, revision, release]);
 await symlink(join(root, 'app/node_modules'), join(release, 'app/node_modules'));
 return release;
}

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

async function fingerprint(home: string, env: NodeJS.ProcessEnv) {
 const result = await channel(['baseline', 'candidate'], env);
 expect(result.code, result.stderr).toBe(0);
 return (await readFile(join(home, 'native-baseline'), 'utf8')).trim();
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
    await archiveRelease(releases, revision);
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
   const env = isolatedEnv(dir);
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

test('native compatibility: dynamic Expo config that changes the Android package changes the fingerprint', async ({}, info) => {
 const dir = await mkdtemp(join(tmpdir(), 'dash-army-native-config-'));
 const home = join(dir, 'channels');
 try {
  const sha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const release = await archiveRelease(join(dir, 'releases'), sha);
  const env = { ...isolatedEnv(dir), DASH_APP_VARIANT: '', DASH_VARIANT: '' };
  await mkdir(join(home, 'ch'), { recursive: true });
  await symlink(release, join(home, 'ch/candidate'));
  await writeFile(join(home, 'channels.tsv'), `candidate\t${sha}\tpin\n`);
  const config = async (): Promise<unknown> => JSON.parse((await execute('bun', [
   join(release, 'app/node_modules/expo/bin/cli'), 'config', '--type', 'prebuild', '--json',
  ], { cwd: join(release, 'app'), env, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout);
  const beforeConfig = await config();
  expect(beforeConfig).not.toMatchObject({ android: { package: 'app.dash.army.changed' } });
  const before = await fingerprint(home, env);
  const configFile = join(release, 'app/app.config.js');
  const source = await readFile(configFile, 'utf8');
  await writeFile(configFile, source + '\nconst originalConfig = module.exports;\nmodule.exports = input => {\n const config = originalConfig(input);\n return { ...config, android: { ...config.android, package: \"app.dash.army.changed\" } };\n};\n');
  const afterConfig = await config();
  expect(afterConfig).toMatchObject({ android: { package: 'app.dash.army.changed' } });
  const after = await fingerprint(home, env);
  await writeFile(info.outputPath('native-config-fingerprints.json'), JSON.stringify({ before, after, beforeConfig, afterConfig }, null, 2));
  expect(after).not.toBe(before);
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test('native compatibility: source, registration and plugin changes invalidate while JS and generated files do not', async ({}, info) => {
 const dir = await mkdtemp(join(tmpdir(), 'dash-army-native-inputs-'));
 const home = join(dir, 'channels');
 try {
  const sha = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const release = await archiveRelease(join(dir, 'releases'), sha);
  const env = isolatedEnv(dir);
  await mkdir(join(home, 'ch'), { recursive: true });
  await symlink(release, join(home, 'ch/candidate'));
  await writeFile(join(home, 'channels.tsv'), `candidate\t${sha}\tpin\n`);
  const module = join(release, 'app/modules/dash-cutout');
  const sourceFile = join(module, 'android/src/main/java/app/dash/cutout/ArmyProbeModule.kt');
  const source = (enabled: boolean) => `package app.dash.cutout\nimport expo.modules.kotlin.modules.Module\nimport expo.modules.kotlin.modules.ModuleDefinition\nclass ArmyProbeModule : Module() {\n override fun definition() = ModuleDefinition { Name(\"ArmyProbe\"); Function(\"enabled\") { ${enabled} } }\n}\n`;
  await writeFile(sourceFile, source(true));
  const initial = await fingerprint(home, env);
  await mkdir(join(module, 'android/build'), { recursive: true });
  await mkdir(join(module, 'android/.gradle'), { recursive: true });
  await writeFile(join(module, 'README.md'), 'Native module documentation changed.\n');
  await writeFile(join(module, 'android/README.md'), 'Native source documentation changed.\n');
  await writeFile(join(module, 'android/build/Generated.kt'), 'generated output\n');
  await writeFile(join(module, 'android/.gradle/cache'), 'generated cache\n');
  await writeFile(join(release, 'app/src/army-display.ts'), 'export const display = \"updated chat text\";\n');
  const jsOnly = await fingerprint(home, env);
  expect(jsOnly).toBe(initial);
  await writeFile(sourceFile, source(false));
  const nativeSource = await fingerprint(home, env);
  expect(nativeSource).not.toBe(jsOnly);
  await writeFile(join(module, 'expo-module.config.json'), JSON.stringify({
   platforms: ['android'],
   android: { modules: ['app.dash.cutout.DashCutoutModule', 'app.dash.cutout.ArmyProbeModule'] },
  }));
  const registration = await fingerprint(home, env);
  expect(registration).not.toBe(nativeSource);
  await rename(sourceFile, join(module, 'android/src/main/java/app/dash/cutout/RenamedArmyProbeModule.kt'));
  const renamed = await fingerprint(home, env);
  expect(renamed).not.toBe(registration);
  await writeFile(join(release, 'app/plugins/with-dex.js'), 'const { withAndroidManifest } = require(\"expo/config-plugins\");\nmodule.exports = config => withAndroidManifest(config, mod => {\n mod.modResults.manifest.application[0].$[\"android:resizeableActivity\"] = \"false\";\n return mod;\n});\n');
  const plugin = await fingerprint(home, env);
  expect(plugin).not.toBe(renamed);
  await writeFile(info.outputPath('native-input-fingerprints.json'), JSON.stringify({ initial, jsOnly, nativeSource, registration, renamed, plugin }, null, 2));
 } finally { await rm(dir, { recursive: true, force: true }); }
});
