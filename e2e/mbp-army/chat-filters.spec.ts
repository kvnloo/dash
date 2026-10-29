import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright/test';
import { test, expect, pair, createBridge, composer, send } from './fixtures';

test.use({ bridgeOptions: { archiveClaude: true }, timezoneId: 'America/New_York' });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

const chatRows = (page: Page) => page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]');

async function firstVisualRow(page: Page) {
  return chatRows(page).evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    let top = 0, bottom = innerHeight, left = 0, right = innerWidth;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (style.overflowY !== 'visible') { top = Math.max(top, box.top); bottom = Math.min(bottom, box.bottom); }
      if (style.overflowX !== 'visible') { left = Math.max(left, box.left); right = Math.min(right, box.right); }
    }
    return { id: element.getAttribute('data-testid'), text: element.textContent ?? '', y: rect.top,
      visible: rect.height > 0 && rect.bottom > top + 1 && rect.top < bottom - 1 && rect.right > left && rect.left < right };
  }).filter(row => row.visible).sort((a, b) => a.y - b.y)[0] ?? null);
}

async function selectFilter(page: Page, menu: 'activity' | 'harness' | 'project' | 'date' | 'sort', option: string) {
  await page.getByTestId(`chat-filter-${menu}`).click({ noWaitAfter: true });
  const sheet = page.getByTestId('bottom-action-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId(`bottom-action-sheet-option-${option}`).click({ noWaitAfter: true });
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId(`chat-filter-${menu}`)).toBeInViewport({ ratio: 1 });
  expect(await page.getByTestId('main-pager').evaluate(element => element.scrollLeft)).toBe(0);
}

async function scrollChats(page: Page) {
  const box = await page.getByTestId('chats-pane').boundingBox();
  if (!box) throw Error('Chats pane has no bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 10000);
}

test('Chats combines harness, exact project and local dates, pages within the date bound, sorts visually and resets to the top', async ({ page, bridge }, info) => {
  const dates = await page.evaluate(() => {
    const at = (days: number) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - days); return date.getTime(); };
    return { today: at(0), yesterday: at(1), sixDays: at(6), sevenDays: at(7), oldest: at(29) };
  });
  const project = join(bridge.dir, 'alpha', 'shared');
  const sameName = join(bridge.dir, 'beta', 'shared');
  const archives = Array.from({ length: 60 }, (_, index) => ({ id: `filters-today-${index}`, title: `ARMY filters today ${String(index).padStart(2, '0')}`, cwd: index % 2 ? project + '/' : project.replaceAll('/', '\\'), kind: 'claude', at: dates.today + index * 1000 }));
  archives.push(
    { id: 'filters-yesterday', title: 'ARMY filters yesterday', cwd: project, kind: 'claude', at: dates.yesterday },
    { id: 'filters-six-days', title: 'ARMY filters six days', cwd: project, kind: 'claude', at: dates.sixDays },
    { id: 'filters-seven-days', title: 'ARMY filters seven days', cwd: project, kind: 'claude', at: dates.sevenDays },
    { id: 'filters-oldest', title: 'ARMY filters oldest', cwd: project, kind: 'claude', at: dates.oldest },
    { id: 'filters-other-project', title: 'ARMY filters same basename', cwd: sameName, kind: 'claude', at: dates.today },
    { id: 'filters-other-harness', title: 'ARMY filters Codex same project', cwd: project, kind: 'codex', at: dates.today },
  );
  archives.push(...Array.from({ length: 100 }, (_, index) => ({ id: `filters-archive-${index}`, title: `ARMY filters older archive ${index}`, cwd: join(bridge.dir, 'archive'), kind: 'claude', at: dates.oldest - index * 1000 })));
  await bridge.stop();
  const bun = execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  execFileSync(bun, ['-e', `
    const { Database } = require('bun:sqlite');
    const db = new Database(process.env.ARMY_FILTER_DB);
    const insert = db.query('insert into sessions (id, project, machine, agent, first_message, started_at, ended_at, message_count, user_message_count, cwd) values (?,?,?,?,?,?,?,?,?,?)');
    db.transaction(() => { for (const row of JSON.parse(process.env.ARMY_FILTER_ROWS)) {
      const stamp = new Date(row.at).toISOString();
      insert.run(row.id, 'army-filters', 'army-filter-archive', row.kind, row.title, stamp, stamp, 12, 3, row.cwd);
    } })();
    db.close();
  `], { env: { ...process.env, ARMY_FILTER_DB: join(bridge.dir, '.agentsview', 'sessions.db'), ARMY_FILTER_ROWS: JSON.stringify(archives) } });
  await bridge.start();
  const requests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/chats') requests.push(request.url()); });
  const cursorRequests = () => requests.filter(url => new URL(url).searchParams.has('cursor')).length;
  await pair(page, bridge);
  await expect.poll(async () => (await firstVisualRow(page))?.id).toBeTruthy();
  const initialTop = (await firstVisualRow(page))?.id;
  await selectFilter(page, 'activity', 'active');
  await expect(chatRows(page)).toHaveCount(1);
  const activeScanBound = cursorRequests();
  for (const sort of ['oldest', 'priority', 'recent']) {
    await selectFilter(page, 'sort', sort);
    await expect(chatRows(page)).toHaveCount(1);
    await expect(page.getByTestId(/^chat-row-(live:omp:army-fixture-session|[^:]+:omp:army-fixture-session)$/)).toBeVisible();
  }
  await page.getByTestId('chat-filter-project').click({ noWaitAfter: true });
  await expect(page.getByTestId('bottom-action-sheet')).toBeVisible();
  await page.getByTestId('bottom-action-sheet').getByTestId('bottom-action-sheet-option-').click({ noWaitAfter: true });
  await scrollChats(page);
  await page.waitForTimeout(1000);
  expect(cursorRequests(), 'Active uses the full live head without scanning historical pages').toBe(activeScanBound);
  await page.getByTestId('chat-filters-reset').click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-filter-activity')).toHaveAttribute('aria-label', 'Sessions, All sessions');
  await selectFilter(page, 'harness', 'claude');
  await expect.poll(() => requests.some(url => new URL(url).searchParams.get('kind') === 'claude')).toBe(true);
  await selectFilter(page, 'date', 'today');
  await expect(page.getByText(/Searching history/)).toHaveCount(0, { timeout: 30000 });
  expect(cursorRequests(), 'date scan crosses the 50-row head').toBeGreaterThan(0);
  const boundedRequests = cursorRequests();
  await page.getByTestId('chat-filter-project').click({ noWaitAfter: true });
  await expect(page.getByTestId('bottom-action-sheet').getByTestId(`bottom-action-sheet-option-${project}`)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(cursorRequests(), 'project discovery respects the active date bound').toBe(boundedRequests);
  await page.getByTestId('bottom-action-sheet').getByTestId(`bottom-action-sheet-option-${project}`).click({ noWaitAfter: true });
  await expect(page.getByTestId('bottom-action-sheet')).toHaveCount(0);
  await expect(page.getByText('60 chats', { exact: true })).toBeVisible();
  await expect(chatRows(page).filter({ hasText: 'ARMY filters same basename' })).toHaveCount(0);
  await expect(chatRows(page).filter({ hasText: 'ARMY filters Codex same project' })).toHaveCount(0);
  await expect.poll(async () => (await firstVisualRow(page))?.text).toContain('ARMY filters today 59');
  await scrollChats(page);
  await page.waitForTimeout(1000);
  expect(cursorRequests(), 'onEndReached also respects the date bound').toBe(boundedRequests);
  await selectFilter(page, 'date', 'week');
  await expect(page.getByText('62 chats', { exact: true })).toBeVisible();
  await selectFilter(page, 'date', 'month');
  await expect(page.getByText('64 chats', { exact: true })).toBeVisible();
  await selectFilter(page, 'date', 'all');
  await expect(page.getByText(/Searching history/)).toHaveCount(0, { timeout: 30000 });
  await expect(page.getByText('64 chats', { exact: true })).toBeVisible();
  await scrollChats(page);
  await expect.poll(async () => (await firstVisualRow(page))?.text).not.toContain('ARMY filters today 59');
  await selectFilter(page, 'sort', 'oldest');
  await expect.poll(async () => (await firstVisualRow(page))?.text).toContain('ARMY filters oldest');
  await selectFilter(page, 'sort', 'recent');
  await expect.poll(async () => (await firstVisualRow(page))?.text).toContain('ARMY filters today 59');
  await scrollChats(page);
  await expect.poll(async () => (await firstVisualRow(page))?.text).not.toContain('ARMY filters today 59');
  await page.getByTestId('chat-filters-reset').click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-filters-reset')).toHaveCount(0);
  await expect(page.getByTestId('chat-filter-harness')).toHaveAttribute('aria-label', 'Harness, All harnesses');
  await expect(page.getByTestId('chat-filter-project')).toHaveAttribute('aria-label', 'Project, All projects');
  await expect(page.getByTestId('chat-filter-date')).toHaveAttribute('aria-label', 'Updated date, Any date');
  await expect(page.getByTestId('chat-filter-sort')).toHaveAttribute('aria-label', 'Sort chats, Recent');
  await expect.poll(async () => (await firstVisualRow(page))?.id).toBe(initialTop);
  expect(bridge.logs()).toContain('pair.claim');
  await writeFile(info.outputPath('chat-page-requests.json'), JSON.stringify(requests, null, 2));
});

test('Chats priority puts failed and interrupted turns ahead of running and newer idle chats', async ({ page, bridge }) => {
  await pair(page, bridge);
  const start = async (harness: string, prompt: string, outcome: RegExp) => {
    await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
    await expect(composer(page)).toBeVisible();
    await page.getByRole('button', { name: 'Choose harness', exact: true }).click({ noWaitAfter: true });
    await page.getByRole('button', { name: harness, exact: true }).click({ noWaitAfter: true });
    await send(page, prompt);
    await expect(page.getByText(outcome).first()).toBeVisible();
    await page.getByRole('button', { name: 'Back', exact: true }).click({ noWaitAfter: true });
    const row = chatRows(page).filter({ hasText: prompt });
    await expect(row).toHaveCount(1);
    const id = await row.getAttribute('data-testid');
    if (!id) throw Error('Created chat has no row id');
    return id;
  };
  const failed = await start('OMP', 'ARMY_ERROR filters needs attention', /ARMY_EXPECTED_AGENT_ERROR|Agent error|ACP.*error|failed/i);
  const running = await start('Hermes', 'ARMY_HANG filters running', /ARMY_STREAM_BEGIN/);
  const idle = await start('Claude Code', 'filters idle newer', /ARMY_CLAUDE_REPLY: filters idle newer/);
  await expect.poll(async () => (await firstVisualRow(page))?.id).toBe(idle);
  await selectFilter(page, 'sort', 'priority');
  await expect.poll(async () => (await firstVisualRow(page))?.id).toBe(failed);
  await expect.poll(async () => {
    const runningBox = await page.getByTestId(running).boundingBox();
    const idleBox = await page.getByTestId(idle).boundingBox();
    return runningBox !== null && idleBox !== null && runningBox.y < idleBox.y;
  }).toBe(true);
  await expect(chatRows(page).filter({ hasText: 'ARMY_HANG filters running' })).toBeVisible();
  await page.getByTestId(running).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'Stop', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await expect.poll(async () => (await firstVisualRow(page))?.id).toBe(running);
  await selectFilter(page, 'sort', 'recent');
  await expect.poll(async () => (await firstVisualRow(page))?.id).toBe(running);
  await bridge.stop();
  await selectFilter(page, 'project', bridge.dir);
  await expect(page.getByText(/Searching history/)).toHaveCount(0);
  expect(bridge.logs()).toContain('turn.start');
});

test('Active sessions retain both host identities across every sort and remove an offline host without hiding saved history', async ({ page }, info) => {
  const peer = await createBridge(true, { rosterHost: 'mbp', finishedSessions: true });
  try {
    const local = await createBridge(true, { rosterHost: 'groot', rosterPeer: peer, archiveClaude: true, finishedSessions: true });
    try {
      const runtime = join(local.dir, '.hermes', 'runtime');
      await mkdir(runtime, { recursive: true });
      // The lease points at the real session holder inside the isolated PID namespace.
      const holderPid = Number((await readFile(join(local.dir, '.omp', 'agent', 'army-holder.pid'), 'utf8')).trim());
      await writeFile(join(runtime, 'active_sessions.json'), JSON.stringify({ entries: [{ session_id: 'army-fixture-session', pid: holderPid, surface: 'tui' }] }));
      const token = (await readFile(join(local.dir, '.dash', 'token'), 'utf8')).trim();
      await expect.poll(async () => {
        const response = await page.request.get(`http://127.0.0.1:${local.port}/roster`, { headers: { Authorization: `Bearer ${token}` } });
        expect(response.status()).toBe(200);
        const body: unknown = await response.json();
        return body;
      }).toEqual(expect.objectContaining({ hosts: expect.arrayContaining([
        expect.objectContaining({ id: 'groot', agents: expect.arrayContaining([
          expect.objectContaining({ kind: 'hermes', sessionId: 'army-fixture-session', status: 'available', openIn: 'TUI' }),
        ]) }),
      ]) }));
      await pair(page, local);
      const localRow = page.getByTestId(/^chat-row-(live:omp:army-fixture-session|groot:omp:army-fixture-session)$/);
      const peerRow = page.getByTestId(/^chat-row-(live:)?mbp:omp:army-fixture-session$/);
      await expect(localRow).toHaveCount(1);
      await expect(peerRow).toHaveCount(1);
      await selectFilter(page, 'activity', 'active');
      for (const sort of ['recent', 'oldest', 'priority']) {
        await selectFilter(page, 'sort', sort);
        await expect(chatRows(page)).toHaveCount(3);
        await expect(localRow).toBeVisible();
        await expect(peerRow).toBeVisible();
        await expect(chatRows(page).filter({ hasText: 'ARMY finished' })).toHaveCount(0);
        await expect(chatRows(page).filter({ hasText: 'ARMY archived Claude Code chat' })).toHaveCount(0);
        await expect(chatRows(page).filter({ hasText: 'ARMY native fixture' })).toHaveCount(1);
        await expect(chatRows(page).filter({ hasText: 'ARMY native fixture' })).toContainText('TUI');
      }
      await page.screenshot({ path: info.outputPath('active-both-hosts.png') });
      const statusPath = join(local.dir, 'tailscale.json');
      const node = (name: string, online: boolean) => ({ HostName: name, DNSName: `${name}.army.ts.net.`, Online: online, OS: 'linux', TailscaleIPs: ['127.0.0.1'] });
      await writeFile(statusPath, JSON.stringify({ Self: node('groot', true), Peer: { mbp: node('mbp', false) } }));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('tab', { name: 'Chats', exact: true }).click({ noWaitAfter: true });
      await selectFilter(page, 'activity', 'active');
      await expect(localRow).toBeVisible();
      await expect(peerRow).toHaveCount(0);
      await expect(chatRows(page)).toHaveCount(2);
      await selectFilter(page, 'activity', 'all');
      await expect(page.getByTestId('chat-row-groot:claude:army-finished-claude')).toBeVisible();
      await page.screenshot({ path: info.outputPath('active-offline-host.png') });
    } finally {
      await local.dispose();
      await writeFile(info.outputPath('bridge.log'), local.logs());
    }
  } finally {
    await peer.dispose();
    await writeFile(info.outputPath('peer-bridge.log'), peer.logs());
  }
});
