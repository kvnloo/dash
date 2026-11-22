import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openChat, test, expect } from './fixtures';

test('Dash log watcher files a local task for each distinct phone JS or bridge error', async ({ page, bridge }, info) => {
  await openChat(page, bridge);
  const dir = info.outputPath('logwatch');
  mkdirSync(dir, { recursive: true });
  const log = join(dir, 'bridge.err.log');
  const state = join(dir, 'state');
  const adb = join(dir, 'adb');
  const phoneLog = join(dir, 'logcat');
  writeFileSync(log, 'error: historical bridge error\n');
  writeFileSync(phoneLog, '');
  writeFileSync(adb, `#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ "$1" = "-s" ] && [ "$2" = "army-phone" ]
shift 2
case "$*" in
  "shell pidof -s app.dash.mobile") echo 123 ;;
  "logcat --pid 123 -T 1 -v brief ReactNativeJS:E *:S") exec tail -n +1 -f logcat ;;
  *) exit 1 ;;
esac
`, { mode: 0o700 });
  const child = spawn('python3', [resolve(__dirname, '../../scripts/logwatch/watch.py'),
    '--adb', adb, '--serial', 'army-phone', '--bridge-log', log, '--state', state]);
  let output = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { output += String(chunk); });
  const done = once(child, 'exit');
  try {
    await expect.poll(() => output).toContain('attached to Dash JS logcat');
    const jsError = page.waitForEvent('pageerror');
    await page.evaluate(() => setTimeout(() => { throw new Error('ARMY_LOGWATCH_FAULT synthetic-token'); }, 0));
    const fault = (await jsError).message;
    appendFileSync(phoneLog, `W/ReactNativeJS(  123): ignore warning\nE/ReactNativeJS(  123): ${fault}\nE/ReactNativeJS(  123): ${fault}\n`);
    // The fixture bridge's stderr mount is simulated, including rotation;
    // the UI above still runs against the real isolated bridge.
    renameSync(log, log + '.old');
    writeFileSync(log, 'error: synthetic bridge disconnect\n');
    const db = join(state, 'logwatch.sqlite3');
    const rows = () => execFileSync('python3', ['-c', `import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
print(json.dumps(db.execute("SELECT source, occurrences, status FROM incidents JOIN tasks ON id = incident_id ORDER BY source").fetchall()))`, db], { encoding: 'utf8' }).trim();
    await expect.poll(rows).toBe('[["android-js", 2, "open"], ["bridge", 1, "open"]]');
    expect(readFileSync(db).includes('synthetic-token')).toBe(false);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await done;
    writeFileSync(info.outputPath('watcher.log'), output);
  }
});
