// Agent -> app UI control helpers: run the bridge's real `dash-ui` CLI against an isolated army
// bridge exactly as an agent on that computer would (its HOME, credential dir and loopback port).
import { execFile } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { Page } from 'playwright/test';
import { expect, type Bridge } from './fixtures';

const bun = process.env.ARMY_BUN || execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
const root = process.env.ARMY_BRIDGE_ROOT || resolve(__dirname, '../..');

export function loopbackPort(b: Bridge): string {
  const port = /notices\s+http:\/\/127\.0\.0\.1:(\d+)\/notice/.exec(b.logs())?.[1];
  if (!port) throw Error('bridge printed no loopback notice listener');
  return port;
}

export type UiAnswer = { code: number; wallMs: number; answer: Record<string, unknown>; stderr: string };

export function dashUi(b: Bridge, ...args: string[]): Promise<UiAnswer> {
  const env = { ...process.env, HOME: b.dir, DASH_CREDENTIAL_DIR: join(b.dir, '.dash'), DASH_NOTICE_PORT: loopbackPort(b) };
  const started = performance.now();
  return new Promise((done, fail) => {
    execFile(bun, [join(root, 'bridge', 'bin', 'dash-ui'), ...args], { env, timeout: 20000 }, (error, stdout, stderr) => {
      const wallMs = performance.now() - started;
      const code = error && typeof error.code === 'number' ? error.code : error ? -1 : 0;
      // Usage errors (exit 2) print no JSON; every bridge answer does.
      if (code === 2) { done({ code, wallMs, answer: {}, stderr }); return; }
      try {
        const parsed: unknown = JSON.parse(stdout.trim());
        if (typeof parsed !== 'object' || parsed === null) throw Error('not an object');
        done({ code, wallMs, answer: Object.fromEntries(Object.entries(parsed)), stderr });
      } catch { fail(Error(`dash-ui ${args.join(' ')} exited ${code}: ${stdout} ${stderr}`)); }
    });
  });
}

/** The owner's consent: Settings > Agent control, through the visible switch. */
export async function enableAgentControl(page: Page, b: Bridge): Promise<void> {
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
  const toggle = page.getByRole('switch', { name: 'Agent control', exact: true });
  await expect(toggle).toHaveText(/Off$/);
  await toggle.click();
  await expect(toggle).toHaveText(/On$/);
  // The agent's own command takes the owner out of Settings; poll until the phone's consent reached the bridge.
  await expect.poll(async () => (await dashUi(b, 'open', 'Chats')).answer.status, { timeout: 10000, message: 'consent reaches the bridge' }).toBe('done');
  await expect(page.getByTestId('chats-pane')).toBeVisible();
}
