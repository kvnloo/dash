import { writeFile } from 'node:fs/promises';
import { test, expect, pair } from './fixtures';

test('Orchestra polls only while visible and resumes the selected Triage view', async ({ page, bridge }, info) => {
  const requests: { path: string; at: number }[] = [];
  const checkpoints: { name: string; at: number }[] = [];
  const origin = `http://127.0.0.1:${bridge.port}`;
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === origin && request.method() === 'GET' && (url.pathname === '/orchestra/graph' || url.pathname === '/triage')) {
      requests.push({ path: url.pathname, at: performance.now() });
    }
  });
  const count = (path: string, start: number) => requests.slice(start).filter(request => request.path === path).length;

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await pair(page, bridge);
    const graphStart = requests.length;
    await page.getByRole('tab').nth(2).click();
    await expect(page.getByTestId('orchestra-graph')).toBeInViewport({ ratio: 1 });
    await expect.poll(() => count('/orchestra/graph', graphStart), {
      timeout: 40000,
      message: 'Orchestra must issue repeated graph requests while visible',
    }).toBeGreaterThanOrEqual(2);

    for (let round = 0; round < 2; round++) {
      for (const view of ['Fleet', 'Lineage', 'Work', 'Triage']) {
        const button = page.getByRole('button', { name: view, exact: true });
        await button.click();
        const graph = page.getByTestId('orchestra-graph');
        if (view === 'Fleet') await expect(graph.getByRole('button', { name: 'Legend host', exact: true })).toBeVisible();
        else if (view === 'Lineage') await expect(graph.getByText(/Delegation tree ·/)).toBeVisible();
        else if (view === 'Work') await expect(graph.getByText(/W1 collisions ·/)).toBeVisible();
        else await expect(page.getByTestId('live-triage-list')).toBeVisible();
      }
    }
    await expect(page.getByTestId('live-triage-list')).toBeVisible();
    const triageStart = requests.length;
    await expect.poll(() => count('/triage', triageStart), {
      timeout: 15000,
      message: 'Selected Triage must continue requesting current priorities',
    }).toBeGreaterThanOrEqual(2);

    await page.getByRole('tab').nth(1).click();
    await expect(page.getByTestId('chats-pane')).toBeVisible();
    const hiddenAt = performance.now();
    checkpoints.push({ name: 'chats-visible', at: hiddenAt });
    // Observe request starts, not responses from requests already in flight at the switch.
    await page.waitForTimeout(18000);
    const hiddenRequests = requests.filter(request => request.at >= hiddenAt);
    expect.soft(hiddenRequests.filter(request => request.path === '/orchestra/graph'), 'No graph request may start while Chats is visible').toEqual([]);
    expect.soft(hiddenRequests.filter(request => request.path === '/triage'), 'No triage request may start while Chats is visible').toEqual([]);
    checkpoints.push({ name: 'hidden-observation-ended', at: performance.now() });

    const resumeStart = requests.length;
    checkpoints.push({ name: 'return-to-orchestra', at: performance.now() });
    await page.getByRole('tab').nth(2).click({ noWaitAfter: true });
    // This window is shorter than the five-second Triage poll interval, so an
    // interval-only restart cannot stand in for the immediate refresh.
    await expect.poll(() => [count('/orchestra/graph', resumeStart) > 0, count('/triage', resumeStart) > 0], {
      timeout: 4000,
      message: 'Returning to Orchestra must request fresh graph and triage data without waiting for the polling intervals',
    }).toEqual([true, true]);
    await expect(page.getByTestId('live-triage-list')).toBeVisible();
    await page.screenshot({ path: info.outputPath('orchestra-resumed.png') });
  } finally {
    await writeFile(info.outputPath('orchestra-request-starts.json'), JSON.stringify({ requests, checkpoints }, null, 2));
  }
});
