import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from 'playwright/test';
import { createBridge } from './fixtures';

const run = promisify(execFile);
const app = 'app.dash.mobile.e2e';

test('S25 APK pairs, streams an OMP reply, and sends a follow-up in the same ACP session', async ({}, info) => {
  const serial = process.env.DEVICE_ARMY_SERIAL;
  if (!serial || !process.env.DEVICE_ARMY_READY) throw Error('Run scripts/device-army.sh first');
  // Do not include the adb command line in errors: it can contain a pairing token.
  const adb = async (...args: string[]) => {
    try {
      return (await run('adb', ['-s', serial, ...args], { timeout: 12_000 })).stdout.trim();
    } catch {
      throw Error('adb failed: ' + args.slice(0, args[0] === 'shell' ? 2 : 1).join(' '));
    }
  };

  const dumpPath = '/data/local/tmp/dash-device-army.xml';
  const labels = async (label: string) => {
    let xml: string;
    try {
      await adb('shell', 'uiautomator', 'dump', dumpPath);
      xml = await adb('shell', 'cat', dumpPath);
    } catch {
      // UIAutomator can briefly fail while Android is switching activities.
      return [];
    }
    return Array.from(xml.matchAll(/<node\s[^>]+>/g)).flatMap(([node]) => {
      if (!node.includes(`package="${app}"`) ||
          !Array.from(node.matchAll(/ (?:text|content-desc|resource-id)="([^"]*)"/g))
            .some(([, value]) => value.trim() === label)) return [];
      const bounds = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (!bounds) return [];
      const [, left, top, right, bottom] = bounds.map(Number);
      if (left >= right || top >= bottom) return [];
      return [{ x: String(Math.floor((left + right) / 2)), y: String(Math.floor((top + bottom) / 2)) }];
    });
  };
  const waitFor = async (label: string) => {
    let found: Awaited<ReturnType<typeof labels>> = [];
    await expect.poll(async () => {
      found = await labels(label);
      return found.length;
    }, { message: 'Android UI: ' + label, timeout: 35_000 }).toBeGreaterThan(0);
    return found[0];
  };
  const tap = async (label: string) => {
    const { x, y } = await waitFor(label);
    await adb('shell', 'input', 'tap', x, y);
  };
  const type = async (label: string, value: string) => {
    if (!/^[A-Za-z0-9._: -]+$/.test(value)) throw Error('Unsupported adb input characters');
    await tap(label);
    await adb('shell', 'input', 'text', value.replaceAll(' ', '%s'));
  };

  const bridge = await createBridge(false, { phoneHosts: true });
  const port = 'tcp:' + bridge.port;
  let reversed = false;
  try {
    // Reverse is scoped to this fixture port, never the live bridge or Metro.
    await adb('reverse', '--no-rebind', port, port);
    reversed = true;
    expect(await adb('shell', 'pm', 'clear', app)).toBe('Success');
    await adb('shell', 'pm', 'grant', app, 'android.permission.POST_NOTIFICATIONS');
    expect(await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.MAIN',
      '-c', 'android.intent.category.LAUNCHER', '-p', app)).toContain('Status: ok');
    await type('Laptop bridge address', '127.0.0.1:' + bridge.port);
    await type('Bootstrap token', bridge.bootstrap);
    await adb('shell', 'input', 'keyevent', '4');
    await tap('Pair over Tailscale');
    await tap('Chats');
    await tap('Create new chat');

    const first = 'ARMY_HOLD native APK first turn';
    await type('Message', first);
    await tap('Send');
    await waitFor('ARMY_STREAM_BEGIN');
    await writeFile(join(bridge.dir, 'army-release'), '');
    await waitFor('ARMY_STREAM_BEGIN ARMY_REPLY: ' + first);
    await expect.poll(async () => (await labels('Stop')).length).toBe(0);
    const second = 'native APK same session follow up';
    await type('Message', second);
    await tap('Send');
    await waitFor('ARMY_STREAM_BEGIN ARMY_REPLY: ' + second);

    const calls = await readFile(join(bridge.dir, 'army-acp-calls.jsonl'), 'utf8');
    expect(calls.trim().split('\n').map(line => JSON.parse(line).method)).toEqual(['session/new', 'session/load']);
    expect(JSON.parse(calls.trim().split('\n')[1]).sessionId).toBe('army-fixture-session');
    const turns = await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8');
    expect(turns.trim().split('\n').map(line => {
      const { event, text } = JSON.parse(line);
      return [event, text];
    })).toEqual([['start', first], ['end', first], ['start', second], ['end', second]]);
    expect(bridge.logs().match(/ws\.chat .* harness=omp /g)).toHaveLength(2);
    await info.attach('fixture-acp-turns', { body: turns, contentType: 'application/x-ndjson' });
  } finally {
    try {
      if (reversed) {
        await adb('reverse', '--remove', port);
        await adb('shell', 'rm', '-f', dumpPath);
        expect(await adb('shell', 'pm', 'clear', app)).toBe('Success');
      }
    } finally {
      await bridge.dispose();
    }
  }
});
