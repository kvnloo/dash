import { writeFile } from 'node:fs/promises';
import { test, expect, openChat, send } from './fixtures';

test.afterEach(async ({ page }, info) => { if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') }); });

// React's development renderer (the dev client Dash runs from Metro) records one performance.measure
// per component render; a streaming chat re-renders every frame. Unless the app clears them, every
// entry is retained (React Native's native PerformanceEntryReporter, or the browser timeline here).
// The page records measures at that rate during a real streaming reply from the bridge's ACP agent.
test('streaming chat window keeps the performance measure buffer bounded', async ({ page, bridge }, info) => {
  test.setTimeout(150000);
  await openChat(page, bridge);
  await send(page, 'ARMY_MS=45000 ARMY_TEXT_TICK=40 chat memory journey');
  const transcript = page.getByTestId('transcript-viewport');
  await expect(transcript.getByText(/ARMY_DELTA_5\b/).first()).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => {
    const w = window as unknown as { __armyMeasures?: number; __armyMeasureTimer?: number };
    w.__armyMeasures = 0;
    w.__armyMeasureTimer = window.setInterval(() => {
      for (let i = 0; i < 20; i++) { performance.measure('​ArmyStreamingRow', { start: 0, end: 1 }); w.__armyMeasures = (w.__armyMeasures ?? 0) + 1; }
    }, 100);
  });
  const samples: { at: number; retained: number; recorded: number; delta: number }[] = [];
  const started = Date.now();
  while (Date.now() - started < 30000) {
    await page.waitForTimeout(3000);
    samples.push(await page.evaluate(() => {
      const w = window as unknown as { __armyMeasures?: number };
      const text = document.querySelector('[data-testid="transcript-viewport"]')?.textContent ?? '';
      const deltas = [...text.matchAll(/ARMY_DELTA_(\d+)/g)].map(m => Number(m[1]));
      return { at: Date.now(), retained: performance.getEntriesByType('measure').length, recorded: w.__armyMeasures ?? 0, delta: deltas.length ? Math.max(...deltas) : 0 };
    }));
  }
  await page.evaluate(() => window.clearInterval((window as unknown as { __armyMeasureTimer?: number }).__armyMeasureTimer));
  await writeFile(info.outputPath('measure-samples.json'), JSON.stringify(samples, null, 1));
  const last = samples.at(-1)!;
  // The reply really streamed throughout, and thousands of measures were recorded.
  expect(last.delta, 'the ACP reply must keep streaming during the observation').toBeGreaterThan(samples[0]!.delta + 300);
  expect(last.recorded).toBeGreaterThan(5000);
  // At most a few seconds of entries are ever retained, never the whole session.
  expect(Math.max(...samples.map(s => s.retained)), `retained measures: ${samples.map(s => s.retained).join(',')}`).toBeLessThan(1500);
  await expect(transcript.getByText(/ARMY_DELTA_\d+/).first()).toBeVisible();
});
