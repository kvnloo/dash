// Agent screen marks (docs/specs/ui-control.md, #368/#369): an agent points at, circles, arrows,
// highlights and draws over the current Dash screen through the real bridge. Marks never take touches.
import type { Locator, Page } from 'playwright/test';
import { test, expect, openChat, send, web } from './fixtures';
import { dashUi, enableAgentControl } from './ui-control';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

const TITLE = 'ARMY ui-overlay chat';

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw Error('no layout box');
  return b;
}

async function openConsentingChat(page: Page, bridge: Parameters<typeof dashUi>[0]) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge, `${web}?annotateEngine=skia`);
  await send(page, TITLE);
  await expect(page.getByText(`ARMY_REPLY: ${TITLE}`).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await enableAgentControl(page, bridge);
  await page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').getByText(TITLE, { exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
}

test('ui-overlay: fixture agent circles an element by id and the mark renders around it without blocking touches', async ({ page, bridge }, info) => {
  await openConsentingChat(page, bridge);
  await send(page, 'ARMY_UI_CONTROL ["circle","chat-annotate","Annotate here","--ttl","20000"]');
  const circle = page.getByTestId('agent-overlay-circle');
  await expect(circle).toBeVisible();
  await expect(circle).toHaveAttribute('aria-label', 'Agent circle: Annotate here');
  await expect(page.getByTestId('agent-overlay-label')).toHaveText('Annotate here');
  // Marks re-measure their element every 200 ms, so the ring settles around it if the chat window
  // is still laying out when the command lands.
  await expect(async () => {
    const ring = await box(circle), target = await box(page.getByTestId('chat-annotate'));
    expect(ring.x).toBeLessThanOrEqual(target.x);
    expect(ring.y).toBeLessThanOrEqual(target.y);
    expect(ring.x + ring.width).toBeGreaterThanOrEqual(target.x + target.width);
    expect(ring.y + ring.height).toBeGreaterThanOrEqual(target.y + target.height);
  }, 'the ring follows the element and encloses it').toPass({ timeout: 2000 });
  await expect(page.getByTestId('agent-activity-text')).toHaveText('Agent · Circled chat-annotate: Annotate here');
  await expect(page.getByText(/ARMY_UI_RESULT \{"status":"done"/).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('agent-circle.png') });

  // The mark is on top of the button, yet the owner's tap still reaches it.
  await page.getByTestId('chat-annotate').click({ noWaitAfter: true });
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
  await expect(circle, 'marks stay over annotation mode').toBeVisible();
});

test('ui-overlay: agent arrow, pointer, highlight, drawing, clear, expiry and dismiss on the current screen', async ({ page, bridge }, info) => {
  await openConsentingChat(page, bridge);

  const arrow = await dashUi(bridge, 'arrow', 'chat-window-close', 'Close it here', '--ttl', '20000');
  expect(arrow.answer).toMatchObject({ status: 'done', detail: 'Arrow at chat-window-close: Close it here' });
  await expect(page.getByTestId('agent-overlay-arrow')).toBeVisible();
  await expect(async () => {
    const tip = await box(page.getByTestId('agent-overlay-arrow-tip')), close = await box(page.getByTestId('chat-window-close'));
    expect(Math.abs(tip.x + tip.width / 2 - (close.x + close.width / 2)), 'arrow tip is centred on the element').toBeLessThan(2);
    const gap = Math.min(Math.abs(tip.y - close.y), Math.abs(tip.y - (close.y + close.height)));
    expect(gap, 'arrow tip ends at the element edge').toBeLessThan(10);
  }, 'the arrow follows the element').toPass({ timeout: 2000 });

  const point = await dashUi(bridge, 'point', '0.5,0.5', 'Middle', '--ttl', '20000');
  expect(point.answer.status).toBe('done');
  const dot = await box(page.getByTestId('agent-overlay-pointer'));
  expect(Math.abs(dot.x + dot.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(dot.y + dot.height / 2 - 422)).toBeLessThan(2);

  expect((await dashUi(bridge, 'highlight', 'chat-annotate', '--ttl', '20000')).answer.status).toBe('done');
  await expect(async () => {
    const outline = await box(page.getByTestId('agent-overlay-highlight')), annotate = await box(page.getByTestId('chat-annotate'));
    expect(outline.x).toBeLessThanOrEqual(annotate.x);
    expect(outline.x + outline.width).toBeGreaterThanOrEqual(annotate.x + annotate.width);
  }, 'the highlight follows the element').toPass({ timeout: 2000 });

  expect((await dashUi(bridge, 'draw', '0.1,0.3 0.5,0.35 0.9,0.3', '--color', 'cream', '--ttl', '20000')).answer.status).toBe('done');
  await expect(page.getByTestId('agent-overlay-draw')).toBeVisible();
  await page.screenshot({ path: info.outputPath('agent-marks.png') });

  // Unknown targets are reported and draw nothing; clear removes only agent marks.
  const missing = await dashUi(bridge, 'circle', 'no-such-target');
  expect(missing.answer).toMatchObject({ status: 'skipped', detail: 'no-such-target is not on screen' });
  await expect(page.getByTestId('agent-overlay-circle')).toHaveCount(0);
  expect((await dashUi(bridge, 'clear')).answer.status).toBe('done');
  for (const id of ['arrow', 'pointer', 'highlight', 'draw']) await expect(page.getByTestId(`agent-overlay-${id}`)).toHaveCount(0);

  // TTL expiry is the phone's own clock.
  expect((await dashUi(bridge, 'circle', 'chat-annotate', '--ttl', '800')).answer.status).toBe('done');
  await expect(page.getByTestId('agent-overlay-circle')).toBeVisible();
  await expect(page.getByTestId('agent-overlay-circle')).toHaveCount(0, { timeout: 3000 });

  // Dismiss on the receipt clears marks and holds off the agent for a moment.
  expect((await dashUi(bridge, 'point', 'chat-annotate', '--ttl', '20000')).answer.status).toBe('done');
  await expect(page.getByTestId('agent-overlay-pointer')).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss agent activity', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('agent-overlay-pointer')).toHaveCount(0);
  const held = await dashUi(bridge, 'point', 'chat-annotate');
  expect(held.answer.status).toBe('refused');
  await expect(page.getByTestId('agent-overlay-pointer')).toHaveCount(0);
});
