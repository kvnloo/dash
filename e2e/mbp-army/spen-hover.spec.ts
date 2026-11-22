import { test, expect, openChat, send } from './fixtures';
import type { CDPSession, Locator, Page } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// S Pen hover (DA-065). Chromium's input pipeline delivers a real hovering pen: pointerType "pen",
// no buttons. Web evidence only; the Android path (gesture-handler Hover, TOOL_TYPE_STYLUS) needs the S25.

async function penAt(cdp: CDPSession, x: number, y: number) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen', button: 'none', buttons: 0 });
}

async function centre(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw Error('target has no box');
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

/** Glide the pen in from the left edge so the browser sees it enter the target. */
async function hover(cdp: CDPSession, target: Locator) {
  const { x, y } = await centre(target);
  for (const step of [0.25, 0.5, 0.75, 1]) await penAt(cdp, Math.round(x * step), y);
  return { x, y };
}

async function ringCentre(page: Page) {
  return centre(page.getByTestId('pen-hover-indicator'));
}

test('S Pen hover shows a following ring, glows the control and highlights the message under it without pressing', async ({ page, bridge }, info) => {
  await openChat(page, bridge);
  const prompt = 'ARMY pen hover target';
  await send(page, prompt);
  const transcript = page.getByTestId('transcript-viewport');
  await expect(transcript.getByText(/ARMY_REPLY:/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();

  const ring = page.getByTestId('pen-hover-indicator');
  await expect(ring).toHaveCSS('opacity', '0');
  const cdp = await page.context().newCDPSession(page);

  // Pen over a control: the ring sits under the pen tip and the control glows. Hover never presses.
  const attach = page.getByRole('button', { name: 'Attach file', exact: true });
  const tip = await hover(cdp, attach);
  await expect(attach.getByTestId('pen-glow')).toBeVisible();
  await expect(ring).toHaveCSS('opacity', '1');
  const at = await ringCentre(page);
  expect(Math.abs(at.x - tip.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(at.y - tip.y)).toBeLessThanOrEqual(2);
  await expect(attach).not.toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Photos', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('pen-over-button.png') });

  // Pen over the sent message: that message highlights, the control stops glowing, the ring follows.
  const mine = transcript.getByTestId('pen-message').filter({ hasText: prompt }).filter({ hasNotText: 'ARMY_REPLY' });
  await expect(mine).toHaveCount(1);
  const overMine = await hover(cdp, mine.getByText(prompt, { exact: true }));
  await expect(mine.getByTestId('pen-highlight')).toBeVisible();
  await expect(attach.getByTestId('pen-glow')).toHaveCount(0);
  const followed = await ringCentre(page);
  expect(Math.abs(followed.x - overMine.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(followed.y - overMine.y)).toBeLessThanOrEqual(2);
  await page.screenshot({ path: info.outputPath('pen-over-message.png') });

  // Pen over the reply: the highlight moves to the reply.
  const reply = transcript.getByTestId('pen-message').filter({ hasText: /ARMY_REPLY:/ });
  await hover(cdp, reply.getByText(/ARMY_REPLY:/).first());
  await expect(reply.getByTestId('pen-highlight')).toBeVisible();
  await expect(mine.getByTestId('pen-highlight')).toHaveCount(0);
  await expect(transcript.getByTestId('pen-highlight')).toHaveCount(1);

  // A mouse is not a pen: it hides the ring and never lights a control.
  const box = await centre(attach);
  await page.mouse.move(box.x - 40, box.y);
  await page.mouse.move(box.x, box.y);
  await expect(ring).toHaveCSS('opacity', '0');
  await expect(page.getByTestId('pen-glow')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('mouse-no-glow.png') });

  // Hovering sent nothing: the agent saw exactly the one typed prompt.
  const starts = (await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8')).trim().split('\n')
    .map((line): unknown => JSON.parse(line))
    .filter((row): row is { event: string; text: string } => typeof row === 'object' && row !== null && 'event' in row && row.event === 'start');
  expect(starts).toHaveLength(1);
  expect(starts[0]?.text).toContain(prompt);
});
