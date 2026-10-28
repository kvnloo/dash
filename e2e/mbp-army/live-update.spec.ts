import { createServer } from 'node:http';
import { test, expect, pair, openChat, composer, send, web, type Bridge } from './fixtures';
import type { Page } from 'playwright/test';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

type MetroStub = {
  origin: string;
  setBuild(sha: string): void;
  setBundleStatus(status: number): void;
  manifestRequests(): number;
  bundleRequests(): number;
  close(): Promise<void>;
};

/** Real loopback Metro stand-in: browser sends cross-origin Expo manifest headers. */
async function startMetro(): Promise<MetroStub> {
  let served = A;
  let bundleStatus = 200;
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
        launchAsset: { key: served, url: 'https://stale-metro.invalid/bundles/' + served + '.bundle', contentType: 'application/javascript' },
        assets: [],
        extra: { expoClient: { extra: { dashBuild: { sha: served, builtAtMs: Date.now() - 210_000 } } } },
      }));
      return;
    }
    if (path === '/bundles/' + served + '.bundle') {
      bundleRequests++;
      res.writeHead(bundleStatus, { 'Content-Type': 'application/javascript' });
      res.end(bundleStatus === 200 ? '// fixture Metro bundle\n' : 'Bundle unavailable');
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
    manifestRequests: () => manifestRequests,
    bundleRequests: () => bundleRequests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
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
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('turbo-served-build')).toContainText('aaaaaaa → bbbbbbb');
    expect(await reloads(page)).toBe(0);
    await page.waitForTimeout(1_000);
    expect(await reloads(page)).toBe(0);
    await expect.poll(() => reloads(page), { timeout: 15_000 }).toBe(1);
    await pair(page, bridge, url);
  } finally { await metro.close(); }
});

test('live-preview-chip: auto-reload waits for a closed keyboard', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  try {
    const url = appUrl(metro, 3_000);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('turbo-served-build')).toContainText('aaaaaaa → bbbbbbb');
    const address = page.getByPlaceholder('100.64.0.1', { exact: true });
    await address.focus();
    await page.waitForTimeout(4_500);
    expect(await reloads(page)).toBe(0);
    await address.evaluate((element) => { if (element instanceof HTMLElement) element.blur(); });
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
    await expect(page.getByTestId('turbo-served-build')).toContainText('aaaaaaa → bbbbbbb');
    await expect.poll(() => reloads(page), { timeout: 12_000 }).toBe(1);
    // A genuine page refresh retains AsyncStorage; the web reload seam itself never navigates.
    await page.reload({ waitUntil: 'domcontentloaded' });
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
    const requestsWhenHealthy = metro.bundleRequests();
    await page.waitForTimeout(1_200);
    expect(await reloads(page)).toBe(1);
    expect(metro.bundleRequests()).toBe(requestsWhenHealthy); // One successful probe per SHA.
    await pair(page, bridge, url);
  } finally { await metro.close(); }
});

test('live-preview-health: rollback to the old SHA preserves the attempted SHA retry guard', async ({ page, bridge }) => {
  const metro = await startMetro();
  metro.setBuild(B);
  try {
    const url = appUrl(metro, 1_000, 250);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
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
    // Snapshot storage at the exact moment the web reload adapter increments its counter.
    await page.evaluate(() => {
      let count = 0;
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
