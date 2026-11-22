import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, openChat, chooseHarness, composer, send } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

type Frame = { type?: string; mode?: string; text?: string };
const field = (m: object, key: string): string | undefined => { const v: unknown = Reflect.get(m, key); return typeof v === 'string' ? v : undefined; };
function frame(payload: string | Buffer): Frame | undefined {
  try {
    const m: unknown = JSON.parse(String(payload));
    return m && typeof m === 'object' ? { type: field(m, 'type'), mode: field(m, 'mode'), text: field(m, 'text') } : undefined;
  } catch { return undefined; }
}

test('while a Hermes turn runs, one tap on Queue or Steer sends with that mode and the next guess follows it', async ({ page, bridge }, info) => {
  const sent: Frame[] = [];
  page.on('websocket', socket => socket.on('framesent', f => { const m = frame(f.payload); if (m) sent.push(m); }));
  await openChat(page, bridge);
  await chooseHarness(page, 'Hermes');
  await send(page, 'ARMY_HOLD running turn for one-tap modes');
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
  // The Options menu renders this scrim only while it is open.
  const menuOpen = page.getByRole('button', { name: /^Close Options\./ });
  const steer = page.getByRole('button', { name: 'Steer', exact: true });
  const queue = page.getByRole('button', { name: 'Queue', exact: true });

  // Empty draft: Stop, and no mode buttons that would send nothing.
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await expect(page.getByTestId('composer-busy-modes')).toHaveCount(0);

  // A draft shows both modes at once: Steer is the first guess, Queue sits beside it.
  await composer(page).fill('queued by one tap');
  await expect(steer).toBeVisible();
  await expect(queue).toBeVisible();
  await expect(page.getByTestId('composer-send-queue')).toBeVisible();
  await page.screenshot({ path: info.outputPath('busy-modes-steer-guess.png') });

  // One tap on Queue: queued for the next turn, nothing sent to the running one, no menu opened.
  await queue.click({ noWaitAfter: true });
  await expect(composer(page)).toHaveValue('');
  await expect(page.getByText('queued by one tap').first()).toBeVisible();
  await expect(menuOpen).toHaveCount(0);
  expect(sent.filter(f => f.type === 'chat' && f.text === 'queued by one tap')).toEqual([]);

  // The guess follows the last tap: Queue is now the primary action and Steer the one-tap alternative.
  await composer(page).fill('steered by one tap');
  await expect(page.getByTestId('composer-send-steer')).toBeVisible();
  await expect(page.getByTestId('composer-send-queue')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('busy-modes-queue-guess.png') });

  // One tap on Steer: sent at once to the running turn with mode steer.
  await steer.click({ noWaitAfter: true });
  await expect.poll(() => sent.filter(f => f.type === 'chat' && f.text === 'steered by one tap').map(f => f.mode)).toEqual(['steer']);
  await expect(composer(page)).toHaveValue('');
  await expect(menuOpen).toHaveCount(0);
  // The fixture bridge has no ACP steering transport: it must say so, not lose the words.
  await expect(page.getByText(/Steering is|steer.*(unavailable|unsupported|not supported)|Steer.*(unavailable|unsupported)|Delivery failed|Could not steer|No native API|No live/i).first()).toBeVisible();

  // The running turn ends and the queued words go out as a normal next turn, never as a steer.
  await writeFile(join(bridge.dir, 'army-release'), '');
  await expect(page.getByText(/ARMY_REPLY: queued by one tap/).first()).toBeVisible({ timeout: 30_000 });
  const queued = sent.filter(f => f.type === 'chat' && f.text === 'queued by one tap');
  expect(queued).toHaveLength(1);
  expect(queued[0].mode).not.toBe('steer');
});
