import type { Page } from 'playwright/test';
import { test, expect, pair } from './fixtures';

// Run the same journey against both build-time flag values. Sample real rendered
// transforms, not exported configuration. Allow a few display frames for sampling.
async function armSlide(page: Page, id: string, axis: 'x' | 'y', target: number) {
  await page.evaluate(({ id, axis, target }) => {
    const result = new Promise<number>((resolve, reject) => {
      const deadline = performance.now() + 5000;
      let first: number | undefined;
      let initial: number | undefined;
      function frame(now: number) {
        if (now > deadline) { reject(new Error(`No completed slide: ${id}`)); return; }
        const node = document.querySelector(`[data-testid="${id}"]`);
        if (node) {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
          const position = axis === 'x' ? matrix.m41 : matrix.m42;
          initial ??= position;
          if (axis === 'y' ? Math.abs(position - target) > 0.01 : Math.abs(position - initial) > 0.01) first ??= now;
          if (first !== undefined && Math.abs(position - target) < 0.01) { resolve(now - first); return; }
        }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    // Attach a handler until the driver retrieves the result after its action.
    void result.catch(() => {});
    Reflect.set(window, '__armyTurboSlide', result);
  }, { id, axis, target });
}

function measuredSlide(page: Page): Promise<number> {
  return page.evaluate(async () => Number(await Reflect.get(window, '__armyTurboSlide')));
}

function expectDuration(actual: number, expected: number, tolerance: number) {
  expect(actual).toBeGreaterThanOrEqual(expected - tolerance);
  expect(actual).toBeLessThanOrEqual(expected + tolerance);
}

test('Turbo profile scales rendered pager, action sheet and orb timings', async ({ page, bridge }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await pair(page, bridge);
  const tabs = page.getByRole('tab');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  const track = page.getByTestId('main-pager-track');
  const origin = await track.evaluate(node => new DOMMatrixReadOnly(getComputedStyle(node).transform).m41);
  const width = await track.locator('> div').first().evaluate(node => node.getBoundingClientRect().width);
  await armSlide(page, 'main-pager-track', 'x', origin - width);
  await tabs.nth(2).click({ noWaitAfter: true });
  const pager = await measuredSlide(page);
  await tabs.nth(1).click({ noWaitAfter: true });
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

  const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({ hasText: 'ARMY native fixture' });
  await row.hover();
  await armSlide(page, 'bottom-action-sheet-motion', 'y', 0);
  await page.mouse.down();
  const sheet = await measuredSlide(page);
  await page.mouse.up();
  await page.getByTestId('bottom-action-sheet-close').click({ noWaitAfter: true });
  // Chat deliberately pauses its inline orbs. Use the shipped component lab's
  // visible streaming orb so we exercise an actively composited clock.
  await page.goto(new URL('/lab', page.url()).href);
  const lab = page.getByTestId('lab-scroll');
  await lab.hover();
  const orb = lab.getByRole('img', { name: 'streaming', exact: true }).first();
  await expect.poll(async () => {
    if (await orb.count()) return true;
    await page.mouse.wheel(0, 500);
    return false;
  }).toBe(true);
  await orb.scrollIntoViewIfNeeded();
  const drawing = orb.getByTestId('agent-orb-motion');
  const transform = () => drawing.evaluate(node => getComputedStyle(node).transform);
  const initialTransform = await transform();
  await expect.poll(transform).not.toBe(initialTransform);
  const cycle = await drawing.evaluate(node => new Promise<number>(resolve => {
    const angle = () => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
      return Math.atan2(matrix.m12, matrix.m11);
    };
    let previous = angle();
    let radians = 0;
    const start = performance.now();
    function frame(now: number) {
      const next = angle();
      const delta = next - previous;
      radians += Math.atan2(Math.sin(delta), Math.cos(delta));
      previous = next;
      if (now - start < 1000) requestAnimationFrame(frame);
      else resolve((now - start) * 4 * Math.PI / radians); // Streaming draws two rotations per clock cycle.
    }
    requestAnimationFrame(frame);
  }));
  const turbo = process.env.EXPO_PUBLIC_DASH_TURBO === '1';
  await info.attach('measured-motion-ms', {
    body: JSON.stringify({ turbo, pager, sheet, cycle }), contentType: 'application/json',
  });
  const factor = turbo ? 0.55 : 1;
  expectDuration(pager, 140 * factor, 30);
  expectDuration(sheet, 240 * factor, 45);
  expectDuration(cycle, 6000 * factor, 300);
  await page.screenshot({ path: info.outputPath('turbo-orb.png') });
});
