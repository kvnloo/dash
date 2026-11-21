// #530 (A29): "switching Orchestra views makes the app progressively slower until the phone freezes".
// Measured, not guessed: 40 view switches through the real UI against the real bridge, timing each
// switch (click → the view's own content visible) and sampling the renderer after a forced GC
// (CDP Performance.getMetrics: JSHeapUsedSize, Nodes, JSEventListeners). The gate is relative growth,
// so it holds on any machine: a leak or accumulating work fails it. Raw samples go to perf.json.
// Web Chromium is not the phone; this proves "nothing accumulates", not on-device frame rate.
import { writeFile } from 'node:fs/promises';
import { test, expect, pair, LONG_CHAT_PROMPTS, LONG_CHAT_TITLE } from './fixtures';

const VIEWS = ['Fleet', 'Lineage', 'Work', 'Triage'] as const;
const SWITCHES = 40;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

test('perf: 40 Orchestra view switches do not slow down or accumulate heap, DOM nodes or listeners (#530)', async ({ page, bridge }, info) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page, bridge);
  await page.getByRole('tab').nth(2).click();
  await expect(page.getByTestId('orchestra-graph')).toBeInViewport({ ratio: 1 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    const get = (name: string) => metrics.find(m => m.name === name)?.value ?? 0;
    return { heapMB: get('JSHeapUsedSize') / 1048576, nodes: get('Nodes'), listeners: get('JSEventListeners') };
  };
  const visible = async (view: (typeof VIEWS)[number]) => {
    const graph = page.getByTestId('orchestra-graph');
    if (view === 'Fleet') await expect(graph.getByRole('button', { name: 'Legend host', exact: true })).toBeVisible();
    else if (view === 'Lineage') await expect(graph.getByText(/Delegation tree ·/)).toBeVisible();
    else if (view === 'Work') await expect(graph.getByText(/W1 collisions ·/)).toBeVisible();
    else await expect(page.getByTestId('live-triage-list')).toBeVisible();
  };
  // Warm-up round: first renders compile code and fill caches.
  for (const view of VIEWS) { await page.getByRole('button', { name: view, exact: true }).click(); await visible(view); }
  const rows: { i: number; view: string; ms: number; heapMB?: number; nodes?: number; listeners?: number }[] = [];
  for (let i = 0; i < SWITCHES; i++) {
    const view = VIEWS[i % VIEWS.length]!;
    const t = performance.now();
    await page.getByRole('button', { name: view, exact: true }).click();
    await visible(view);
    const ms = performance.now() - t;
    rows.push(i % VIEWS.length === VIEWS.length - 1 ? { i, view, ms, ...(await sample()) } : { i, view, ms });
  }
  const samples = rows.filter(r => r.heapMB !== undefined);
  const first = samples[1]!, last = samples.at(-1)!;
  const early = median(rows.slice(0, 10).map(r => r.ms)), late = median(rows.slice(-10).map(r => r.ms));
  const summary = { early_median_ms: early, late_median_ms: late, heap_mb: [first.heapMB, last.heapMB], nodes: [first.nodes, last.nodes], listeners: [first.listeners, last.listeners] };
  await writeFile(info.outputPath('perf.json'), JSON.stringify({ issue: 530, scope: 'web Chromium via the real bridge; not phone frame rate', summary, rows }, null, 1));
  await info.attach('perf-summary', { body: JSON.stringify(summary), contentType: 'application/json' });
  console.log('perf-orchestra-switch', JSON.stringify(summary));
  expect(late, `late switches stay as fast as early ones (${early.toFixed(0)} → ${late.toFixed(0)} ms)`).toBeLessThanOrEqual(early * 2 + 75);
  expect(last.heapMB! - first.heapMB!, 'retained JS heap after GC does not grow across 32 more switches').toBeLessThan(8);
  expect(last.nodes!, 'DOM nodes do not accumulate').toBeLessThanOrEqual(first.nodes! * 1.15 + 50);
  expect(last.listeners!, 'event listeners do not accumulate').toBeLessThanOrEqual(first.listeners! * 1.15 + 20);
});

// #522: "quick-scroll animation is very laggy inside a chat". Frame intervals sampled in the page with
// requestAnimationFrame while the prompt rail is dragged end to end over a 1000-message chat (125
// prompts). Recorded for comparison across commits; the gate only rejects a freeze (a frame > 1 s) or
// a scrub that renders almost nothing, because headless frame timing varies by machine.
test.describe('perf: prompt rail scrub', () => {
  test.use({ bridgeOptions: { longClaude: true }, viewport: { width: 390, height: 844 } });
  test('perf: prompt rail scrub over a 1000-message chat never freezes a frame (#522)', async ({ page, bridge }, info) => {
    test.setTimeout(240_000);
    await pair(page, bridge);
    const row = page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({ hasText: LONG_CHAT_TITLE });
    await expect(row).toHaveCount(1, { timeout: 30000 });
    await row.click({ noWaitAfter: true });
    const rail = page.getByLabel('Prompt navigator', { exact: true });
    await expect(rail).toBeVisible({ timeout: 30000 });
    await expect.poll(() => rail.getByTestId('rail-tick').count(), { timeout: 90000 }).toBe(LONG_CHAT_PROMPTS);
    const box = await rail.boundingBox();
    if (!box) throw Error('Prompt navigator has no box');
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __stop: boolean };
      w.__frames = []; w.__stop = false;
      let last = performance.now();
      const tick = (now: number) => { w.__frames.push(now - last); last = now; if (!w.__stop) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const scrub = async () => {
      const t = performance.now();
      for (let pass = 0; pass < 2; pass++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * (pass ? 0.98 : 0.02));
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height * (pass ? 0.02 : 0.98), { steps: 60 });
        await page.mouse.up();
      }
      const ms = performance.now() - t;
      const frames = await page.evaluate(() => { const w = window as unknown as { __frames: number[] }; const out = w.__frames.slice(1); w.__frames = []; return out; });
      const sorted = [...frames].sort((a, b) => a - b);
      const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
      return { stats: { scrub_ms: Math.round(ms), frames: frames.length, p50_ms: pct(0.5), p95_ms: pct(0.95), max_ms: sorted.at(-1) ?? 0, over_50ms: frames.filter(f => f > 50).length }, frames };
    };
    const full = await scrub();
    // A phone CPU is several times slower than this box: repeat at 4x CPU throttling (recorded only).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const throttled = await scrub();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(() => { (window as unknown as { __stop: boolean }).__stop = true; });
    const summary = { ...full.stats, cpu4x: throttled.stats };
    await writeFile(info.outputPath('perf.json'), JSON.stringify({ issue: 522, scope: 'web Chromium headless; not phone frame rate', summary, frames: full.frames, frames_cpu4x: throttled.frames }, null, 1));
    await info.attach('perf-summary', { body: JSON.stringify(summary), contentType: 'application/json' });
    console.log('perf-rail-scrub', JSON.stringify(summary));
    expect(summary.frames, 'the scrub kept rendering').toBeGreaterThan(20);
    expect(summary.max_ms, 'no frozen frame during the scrub').toBeLessThan(1000);
  });
});
