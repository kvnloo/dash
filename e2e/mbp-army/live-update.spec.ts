import { createServer } from 'node:http';
import { test, expect, pair, openChat, composer, send, web, type Bridge } from './fixtures';
import type { Page } from 'playwright/test';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

type MetroStub = {
  origin: string;
  setBuild(sha: string): void;
  setBundleStatus(status: number): void;
  setAsset(label: string): void;
  holdNextBundle(): void;
  releaseBundles(): void;
  manifestRequests(): number;
  bundleRequests(): number;
  close(): Promise<void>;
};

/** Real loopback Metro stand-in: browser sends cross-origin Expo manifest headers. */
async function startMetro(): Promise<MetroStub> {
  let served = A;
  let bundleStatus = 200;
  let asset = '', holdNext = false;
  const held: (() => void)[] = [];
  const releaseBundles = () => { for (const reply of held.splice(0)) reply(); };
  let manifestRequests = 0;
  let bundleRequests = 0;
  let origin = '';
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'expo-platform, accept, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (path === '/') {
      manifestRequests++;
      if (req.headers['expo-platform'] !== 'android' ||
          !String(req.headers.accept ?? '').includes('application/expo+json')) {
        res.writeHead(412); res.end('Missing Expo manifest request headers'); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/expo+json; charset=utf-8' });
      res.end(JSON.stringify({
        id: 'dash-army-live-preview',
        // Deliberately stale host: the app must fetch the asset at the polled Metro origin.
        launchAsset: { key: served, url: 'https://stale-metro.invalid/bundles/' + served + '.bundle' + (asset ? '?asset=' + encodeURIComponent(asset) : ''), contentType: 'application/javascript' },
        assets: [],
        extra: { expoClient: { extra: { dashBuild: { sha: served, builtAtMs: Date.now() - 210_000 } } } },
      }));
      return;
    }
    if (path === '/bundles/' + served + '.bundle') {
      bundleRequests++;
      const status = bundleStatus;
      const reply = () => {
        if (res.destroyed || res.writableEnded) return;
        res.writeHead(status, { 'Content-Type': 'application/javascript' });
        res.end(status === 200 ? '// fixture Metro bundle\n' : 'Bundle unavailable');
      };
      if (holdNext) { holdNext = false; held.push(reply); } else reply();
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw Error('Metro stub did not bind a TCP port');
  }
  origin = 'http://127.0.0.1:' + address.port;
  return {
    origin,
    setBuild: (sha) => { served = sha; },
    setBundleStatus: (status) => { bundleStatus = status; },
    setAsset: label => { asset = label; },
    holdNextBundle: () => { holdNext = true; },
    releaseBundles,
    manifestRequests: () => manifestRequests,
    bundleRequests: () => bundleRequests,
    close: async () => {
      releaseBundles();
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      server.close(error => error ? reject(error) : resolve());
      // A paused browser clock may retain an active fetch after assertions finish.
      // Close only this fixture's connections; never wait for the app to poll again.
      server.closeAllConnections();
      return promise;
    },
  };
}

function appUrl(metro: MetroStub, idleMs = 60_000, pollMs?: number): string {
  const url = new URL(web);
  url.searchParams.set('liveOrigin', metro.origin);
  url.searchParams.set('liveRunning', A);
  url.searchParams.set('liveIdleMs', String(idleMs));
  if (pollMs !== undefined) url.searchParams.set('livePollMs', String(pollMs));
  return url.href;
}

async function reloads(page: Page): Promise<number> {
  return page.evaluate(() => {
    const value: unknown = Reflect.get(window, '__dashReloads');
    return typeof value === 'number' ? value : 0;
  });
}

async function captureDraftAtReload(page: Page) {
  await page.evaluate(() => {
    const previous: unknown = Reflect.get(window, '__dashReloads');
    let count = typeof previous === 'number' ? previous : 0;
    Object.defineProperty(window, '__dashReloads', {
      configurable: true,
      get: () => count,
      set: (next: unknown) => {
        if (typeof next !== 'number') return;
        if (next > count) Reflect.set(window, '__dashDraftAtReload', localStorage.getItem('dash.composerDrafts.v1'));
        count = next;
      },
    });
  });
}

async function pauseClock(page: Page, advance: number) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + advance);
}

/**
 * A cold app on a loaded host can take ~20 s to load its lazy App chunk (army traces at load 25), and the
 * chip only exists once App renders. Wait for the app to boot before timing anything the chip shows.
 */
async function booted(page: Page): Promise<void> {
  await expect(page.getByTestId('turbo-served-build')).toBeVisible({ timeout: 45_000 });
}

async function paired(page: Page, bridge: Bridge, metro: MetroStub, idleMs = 60_000): Promise<void> {
  await pair(page, bridge, appUrl(metro, idleMs));
  await expect(page.getByTestId('turbo-served-build')).toBeVisible();
  await expect.poll(() => metro.manifestRequests()).toBeGreaterThan(0);
}

test('live-preview-chip: current build shows short SHA and age', async ({ page, bridge }) => {
  const metro = await startMetro();
  try {
    await paired(page, bridge, metro);
    const chip = page.getByTestId('turbo-served-build');
    await expect(chip).toContainText('aaaaaaa ·');
    await expect(chip).toContainText(/3m old|4m old/);
    await expect(chip).not.toContainText('→');
    expect(await reloads(page)).toBe(0);
  } finally { await metro.close(); }
});

test('live-preview-chip: changed manifest shows the real arrow and tap reloads exactly once', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  try {
    await paired(page, bridge, metro);
    const chip = page.getByTestId('turbo-served-build');
    await expect(chip).toContainText('aaaaaaa → bbbbbbb');
    await chip.click({ noWaitAfter: true });
    await expect.poll(() => reloads(page)).toBe(1);
    await chip.click({ noWaitAfter: true });
    expect(await reloads(page)).toBe(1);
  } finally { await metro.close(); }
});

test('live-preview-chip: auto-reload waits for the idle gate', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  try {
    const url = appUrl(metro, 5_000);
    // The idle clock starts when the app starts, and a loaded host can take longer than the 5 s gate to show
    // the chip. So the owner keeps touching the app from its first frame (a page-side loop, as a busy owner
    // would, through the app's real root touch observer), and the page times each reload and the last touch.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('army.idleTouchesDone') === '1') return;
      let count = 0;
      const reloadAt: number[] = [];
      let lastTouch = 0;
      Object.defineProperty(window, '__dashReloads', {
        configurable: true,
        get: () => count,
        set: (next: unknown) => {
          if (typeof next !== 'number') return;
          if (next > count) reloadAt.push(Date.now());
          count = next;
        },
      });
      const touch = window.setInterval(() => {
        const target = document.querySelector('[role="heading"]');
        if (!target) return;
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0 }));
        lastTouch = Date.now();
      }, 200);
      Object.defineProperty(window, '__armyIdle', {
        configurable: true,
        value: {
          stop: () => { window.clearInterval(touch); sessionStorage.setItem('army.idleTouchesDone', '1'); return lastTouch; },
          reloadAt: () => reloadAt.slice(),
          lastTouch: () => lastTouch,
        },
      });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await booted(page);
    await expect(page.getByTestId('turbo-served-build')).toContainText('aaaaaaa → bbbbbbb');
    await expect.poll(() => page.evaluate(() => {
      const idle: unknown = Reflect.get(window, '__armyIdle');
      return typeof idle === 'object' && idle !== null && 'lastTouch' in idle && typeof idle.lastTouch === 'function' ? Number(idle.lastTouch()) : 0;
    }), { message: 'the owner is touching the app' }).toBeGreaterThan(0);
    // An update is ready, but the owner is busy: past the 5 s gate, still no reload.
    await page.waitForTimeout(6_000);
    expect(await reloads(page)).toBe(0);
    // The owner stops touching: the reload comes once the gate has passed since the last touch, not before.
    const lastTouch = await page.evaluate(() => {
      const idle: unknown = Reflect.get(window, '__armyIdle');
      return typeof idle === 'object' && idle !== null && 'stop' in idle && typeof idle.stop === 'function' ? Number(idle.stop()) : 0;
    });
    expect(lastTouch).toBeGreaterThan(0);
    await expect.poll(() => reloads(page), { timeout: 15_000 }).toBe(1);
    const reloadAt = await page.evaluate(() => {
      const idle: unknown = Reflect.get(window, '__armyIdle');
      return typeof idle === 'object' && idle !== null && 'reloadAt' in idle && typeof idle.reloadAt === 'function' ? Array.from(idle.reloadAt(), Number) : [];
    });
    expect(reloadAt).toHaveLength(1);
    expect(Number(reloadAt[0]) - lastTouch, 'the auto-reload waited for 5 s without a touch').toBeGreaterThanOrEqual(5_000);
    await pair(page, bridge, url);
  } finally { await metro.close(); }
});

test('live-preview-chip: auto-reload waits for a closed keyboard', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  try {
    const url = appUrl(metro, 3_000);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // Hold the keyboard open from the first frame: on a loaded host the page can sit idle past the 3 s gate
    // before the chip shows, and the pair screen can re-mount the field while it hydrates, dropping a one-off
    // focus(). A page-side loop re-focuses the field whenever it loses focus, so the keyboard is open the whole time.
    await page.evaluate(() => {
      const keep = window.setInterval(() => {
        const field = document.querySelector<HTMLInputElement>('input[placeholder="100.64.0.1"]');
        if (field && document.activeElement !== field) field.focus();
      }, 40);
      Object.defineProperty(window, '__armyKeepKeyboard', { value: keep, configurable: true });
    });
    await booted(page);
    await expect(page.getByTestId('turbo-served-build')).toContainText('aaaaaaa → bbbbbbb');
    await page.waitForTimeout(4_500);
    expect(await reloads(page)).toBe(0);
    await page.evaluate(() => {
      const keep: unknown = Reflect.get(window, '__armyKeepKeyboard');
      if (typeof keep === 'number') window.clearInterval(keep);
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await expect.poll(() => reloads(page), { timeout: 10_000 }).toBe(1);
    await pair(page, bridge, url);
  } finally { await metro.close(); }
});

test('live-preview-chip: same served SHA never triggers a reload loop', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  try {
    const url = appUrl(metro, 1_500);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await booted(page);
    await expect(page.getByTestId('turbo-served-build')).toContainText('aaaaaaa → bbbbbbb');
    await expect.poll(() => reloads(page), { timeout: 12_000 }).toBe(1);
    // Navigation may rewrite the current URL, stripping web-only URL seams. Relaunch
    // the same app document with the original build/Metro params and persisted storage.
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await booted(page);
    await expect(page.getByTestId('turbo-served-build')).toContainText('aaaaaaa → bbbbbbb');
    await page.waitForTimeout(21_000); // includes a fresh 20 s manifest poll and the retry timeout
    expect(await reloads(page)).toBe(0);
    expect(metro.manifestRequests()).toBeGreaterThan(2);
    await pair(page, bridge, url);
  } finally { await metro.close(); }
});

test('live-preview-chip: long-press offers reload, Metro switch and auto-reload toggle', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  try {
    await paired(page, bridge, metro);
    const chip = page.getByTestId('turbo-served-build');
    await chip.click({ delay: 750, noWaitAfter: true });
    const menu = page.getByTestId('live-build-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Reload now' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Switch Metro' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Turn auto-reload off' })).toBeVisible();
    await menu.getByRole('button', { name: 'Switch Metro' }).click({ noWaitAfter: true });
    await expect(menu.getByRole('button', { name: /Turbo \(live\) :8213/ })).toBeVisible();
    await expect(menu.getByRole('button', { name: /RC3 channel :8214/ })).toBeVisible();
    await menu.getByRole('button', { name: 'Turn auto-reload off' }).click({ noWaitAfter: true });
    await chip.click({ delay: 750, noWaitAfter: true });
    await expect(menu.getByRole('button', { name: 'Turn auto-reload on' })).toBeVisible();
    await menu.getByRole('button', { name: 'Turn auto-reload on' }).click({ noWaitAfter: true });
    expect(await reloads(page)).toBe(0);
  } finally { await metro.close(); }
});

test('live-preview-health: an HTTP 500 bundle cannot reload until the same SHA builds', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  metro.setBundleStatus(500);
  try {
    const url = appUrl(metro, 1_000, 250);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await booted(page);
    const chip = page.getByTestId('turbo-served-build');
    await expect(chip).toContainText('bbbbbbb failed to build (HTTP 500)', { timeout: 10_000 });
    expect(metro.bundleRequests()).toBeGreaterThan(0);
    expect(await reloads(page)).toBe(0);
    // Let the idle gate expire while the head is still advertised but its bundle 500s.
    await page.waitForTimeout(1_500);
    await expect(chip).toContainText('bbbbbbb failed to build (HTTP 500)');
    expect(await reloads(page)).toBe(0);
    await chip.click({ noWaitAfter: true }); // Even a manual tap must not load a broken bundle.
    expect(await reloads(page)).toBe(0);

    metro.setBundleStatus(200);
    await expect(chip).toContainText('aaaaaaa → bbbbbbb', { timeout: 10_000 });
    await expect.poll(() => reloads(page), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1_200);
    expect(await reloads(page)).toBe(1);
    await pair(page, bridge, url);
  } finally { await metro.close(); }
});

test('live-preview-health: an update that breaks while waiting cannot reload until it recovers', async ({ page, bridge }, info) => {
  const metro = await startMetro();
  try {
    await openChat(page, bridge, appUrl(metro, 1_000, 250));
    const draft = 'Keep this draft while the update waits';
    await composer(page).fill(draft);
    metro.setBuild(B);
    const chip = page.getByTestId('turbo-served-build');
    await expect(chip).toContainText('update ready - held: unsent draft');
    metro.setBundleStatus(500);
    await chip.click({ noWaitAfter: true });
    await expect.soft(chip).toContainText('bbbbbbb failed to build (HTTP 500)', { timeout: 10_000 });
    expect(await reloads(page)).toBe(0);
    await expect(composer(page)).toHaveValue(draft);
    await page.screenshot({ path: info.outputPath('broken-update-held.png') });
    metro.setBundleStatus(200);
    await expect(chip).toContainText('update ready - held: unsent draft', { timeout: 10_000 });
    await chip.click({ noWaitAfter: true });
    await expect.poll(() => reloads(page)).toBe(1);
    await page.screenshot({ path: info.outputPath('recovered-update-reloaded.png') });
  } finally { await metro.close(); }
});

test('live-preview-health: rollback to the old SHA preserves the attempted SHA retry guard', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  try {
    const url = appUrl(metro, 1_000, 250);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await booted(page);
    const chip = page.getByTestId('turbo-served-build');
    await expect(chip).toContainText('aaaaaaa → bbbbbbb');
    await expect.poll(() => reloads(page), { timeout: 12_000 }).toBe(1);

    // The browser seam records the reload, but intentionally keeps running A as if it failed.
    metro.setBuild(A);
    await expect(chip).toContainText('aaaaaaa ·', { timeout: 10_000 });
    metro.setBuild(B);
    await expect(chip).toContainText('aaaaaaa → bbbbbbb', { timeout: 10_000 });
    // Wait past the retry lockout: B must not get a second automatic reload.
    await page.waitForTimeout(10_500);
    expect(await reloads(page)).toBe(1);
    await pair(page, bridge, url);
  } finally { await metro.close(); }
});

test('live-reload-guards: a streaming agent reply holds the update until done', async ({ page, bridge }) => {
  const metro = await startMetro();
  try {
    await openChat(page, bridge, appUrl(metro, 1_000, 250));
    await send(page, 'ARMY_SLOW live reload streaming guard');
    metro.setBuild(B);
    const chip = page.getByTestId('turbo-served-build');
    await expect(chip).toContainText('update ready - held: streaming reply', { timeout: 10_000 });
    expect(await reloads(page)).toBe(0);
    await expect(page.getByText(/ARMY_REPLY: ARMY_SLOW live reload streaming guard/).first()).toBeVisible({ timeout: 18_000 });
    await expect.poll(() => reloads(page), { timeout: 12_000 }).toBe(1);
    await page.waitForTimeout(1_200);
    expect(await reloads(page)).toBe(1);
  } finally { await metro.close(); }
});

test('live-reload-guards: annotation holds an update until Exit', async ({ page, bridge }) => {
  const metro = await startMetro();
  try {
    await openChat(page, bridge, appUrl(metro, 1_000, 250));
    await page.getByRole('button', { name: 'Options. Current surface: Chat', exact: true }).click();
    await page.getByRole('button', { name: 'Annotate, S Pen or finger', exact: true }).click();
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
    metro.setBuild(B);
    await expect(page.getByTestId('turbo-served-build')).toContainText('update ready - held: annotation', { timeout: 12_000 });
    await page.waitForTimeout(1_200);
    expect(await reloads(page)).toBe(0);
    await page.getByRole('button', { name: 'Exit annotation', exact: true }).first().click();
    await expect.poll(() => reloads(page), { timeout: 12_000 }).toBe(1);
    await page.waitForTimeout(1_200);
    expect(await reloads(page)).toBe(1);
  } finally { await metro.close(); }
});

test('live-reload-guards: a nonempty unsent draft holds an update', async ({ page, bridge }) => {
  const metro = await startMetro();
  try {
    await openChat(page, bridge, appUrl(metro, 1_000, 250));
    await composer(page).fill('Do not lose this unsent draft');
    metro.setBuild(B);
    await expect(page.getByTestId('turbo-served-build')).toContainText('update ready - held: unsent draft', { timeout: 10_000 });
    await page.waitForTimeout(1_200);
    expect(await reloads(page)).toBe(0);
    await composer(page).fill('');
    await expect.poll(() => reloads(page), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(1_200);
    expect(await reloads(page)).toBe(1);
  } finally { await metro.close(); }
});

test('live-reload-guards: manual Reload now flushes a sub-debounce draft before reload', async ({ page, bridge }) => {
  const metro = await startMetro();
  try {
    await openChat(page, bridge, appUrl(metro, 60_000, 250));
    metro.setBuild(B);
    const chip = page.getByTestId('turbo-served-build');
    await expect(chip).toContainText('aaaaaaa → bbbbbbb');
    await captureDraftAtReload(page);
    const draft = 'Manual reload must flush before 250ms';
    await composer(page).fill(draft);
    await chip.click({ noWaitAfter: true });
    await expect.poll(() => reloads(page), { timeout: 10_000 }).toBe(1);
    const snapshot: unknown = await page.evaluate(() => Reflect.get(window, '__dashDraftAtReload'));
    expect(typeof snapshot).toBe('string');
    expect(snapshot).toContain(draft);
    await page.waitForTimeout(1_200);
    expect(await reloads(page)).toBe(1);
  } finally { await metro.close(); }
});

test.describe('reload commit preparation', () => {
  test.beforeEach(async ({ page }) => { await page.clock.install(); });

  test('live-reload-commit: edits made during a held probe are persisted at reload', async ({ page, bridge }, info) => {
    const metro = await startMetro();
    try {
      await openChat(page, bridge, appUrl(metro, 60_000, 250));
      await composer(page).fill('Draft before probe');
      metro.setBuild(B);
      const chip = page.getByTestId('turbo-served-build');
      await expect(chip).toContainText('update ready - held: unsent draft');
      await captureDraftAtReload(page);
      await pauseClock(page, 1000);
      const probes = metro.bundleRequests();
      metro.holdNextBundle();
      await chip.click({ noWaitAfter: true });
      await page.clock.runFor(200);
      await expect.poll(() => metro.bundleRequests()).toBeGreaterThan(probes);
      const draft = 'Edit during probe must survive the reload';
      await composer(page).fill(draft);
      await page.clock.runFor(50);
      metro.releaseBundles();
      await expect.poll(() => reloads(page)).toBe(1);
      const snapshot: unknown = await page.evaluate(() => Reflect.get(window, '__dashDraftAtReload'));
      expect(snapshot).toContain(draft);
      await page.screenshot({ path: info.outputPath('latest-draft-persisted.png') });
    } finally { await metro.close(); }
  });

  test('live-reload-commit: resumed interaction cancels an idle reload until the owner is idle again', async ({ page, bridge }, info) => {
    const metro = await startMetro();
    try {
      await openChat(page, bridge, appUrl(metro, 1000, 250));
      await composer(page).focus();
      metro.setBuild(B);
      const chip = page.getByTestId('turbo-served-build');
      await expect(chip).toContainText('aaaaaaa → bbbbbbb');
      const probes = metro.bundleRequests();
      metro.holdNextBundle();
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await pauseClock(page, 1500);
      await expect.poll(() => metro.bundleRequests()).toBeGreaterThan(probes);
      await composer(page).click();
      await expect(composer(page)).toBeFocused();
      const response = page.waitForResponse(response => response.url().startsWith(metro.origin + '/bundles/'));
      metro.releaseBundles();
      await response;
      await page.clock.runFor(500);
      expect(await reloads(page)).toBe(0);
      await page.screenshot({ path: info.outputPath('interaction-holds-reload.png') });
      await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await page.clock.runFor(1500);
      await expect.poll(() => reloads(page)).toBe(1);
    } finally { await metro.close(); }
  });

  test('live-reload-commit: a changed asset URL for the same SHA loses its old health approval', async ({ page, bridge }, info) => {
    const metro = await startMetro();
    try {
      await openChat(page, bridge, appUrl(metro, 60_000, 250));
      await composer(page).fill('Retain this draft while the asset changes');
      metro.setBuild(B);
      const chip = page.getByTestId('turbo-served-build');
      await expect(chip).toContainText('update ready - held: unsent draft');
      await pauseClock(page, 1000);
      const probes = metro.bundleRequests();
      metro.holdNextBundle();
      await chip.click({ noWaitAfter: true });
      await page.clock.runFor(200);
      await expect.poll(() => metro.bundleRequests()).toBeGreaterThan(probes);
      const manifests = metro.manifestRequests();
      metro.setAsset('replacement');
      metro.setBundleStatus(500);
      await page.clock.runFor(500);
      await expect.poll(() => metro.manifestRequests()).toBeGreaterThan(manifests);
      await expect(chip).toContainText('bbbbbbb failed to build (HTTP 500)', { timeout: 5000 });
      metro.releaseBundles();
      await page.clock.runFor(200);
      expect(await reloads(page)).toBe(0);
      await page.screenshot({ path: info.outputPath('replacement-asset-blocked.png') });
      metro.setBundleStatus(200);
      await page.clock.runFor(500);
      await expect(chip).toContainText('update ready - held: unsent draft');
      await chip.click({ noWaitAfter: true });
      await page.clock.runFor(200);
      await expect.poll(() => reloads(page)).toBe(1);
    } finally { await metro.close(); }
  });
});
