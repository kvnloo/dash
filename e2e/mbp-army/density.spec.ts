import type { Page } from 'playwright/test';
import { test, expect, pair } from './fixtures';

// DA-041: Settings holds two dials. Layout changes spacing and tile size only; Detail changes the
// shown evidence only. Both are driven in Settings and read back from the Lab stat tile.

type Reading = { inset: number; minHeight: string; lines: string[] };

async function readTile(page: Page): Promise<Reading> {
  const list = page.getByTestId('lab-scroll');
  const block = page.getByTestId('lab-stat-tile');
  for (let i = 0; i < 14 && await block.count() === 0; i += 1) {
    await list.hover();
    await page.mouse.wheel(0, 450);
  }
  await expect(block).toBeVisible();
  await block.scrollIntoViewIfNeeded();
  const tile = block.getByTestId('stat-spark-cut');
  await expect(tile).toBeVisible();
  return tile.evaluate(element => {
    // Geometry: the label's inset from the tile edge (padding) and the tile's minimum height.
    const label = [...element.querySelectorAll('div')].find(node => node.children.length === 0 && node.textContent === 'cut');
    if (!label) throw Error('stat tile label not found');
    const sized = [element, ...element.querySelectorAll('div')].find(node => getComputedStyle(node).minHeight !== '0px' && getComputedStyle(node).minHeight !== 'auto');
    return {
      inset: Math.round(label.getBoundingClientRect().left - element.getBoundingClientRect().left),
      minHeight: sized ? getComputedStyle(sized).minHeight : 'none',
      lines: [...element.querySelectorAll('[data-testid^="stat-detail-"]')].map(node => node.textContent ?? ''),
    };
  });
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click({ noWaitAfter: true });
  const group = page.getByTestId('settings-density');
  await expect(group).toBeVisible();
  return group;
}

async function openLab(page: Page) {
  await page.getByRole('button', { name: 'Component lab', exact: true }).click({ noWaitAfter: true });
  return readTile(page);
}

/** Lab was opened from Settings, so Back returns to the Settings group. */
async function back(page: Page) {
  await page.getByRole('button', { name: 'Back', exact: true }).last().click({ noWaitAfter: true });
  const group = page.getByTestId('settings-density');
  await expect(group).toBeVisible();
  return group;
}

test('Settings layout and detail dials each change only their own axis', async ({ page, bridge }, info) => {
  await pair(page, bridge);
  let group = await openSettings(page);
  const layout = group.getByTestId('layout-density-picker');
  const detail = group.getByTestId('information-detail-picker');
  await expect(layout).toContainText('LAYOUT');
  await expect(detail).toContainText('DETAIL');
  for (const name of ['Compact', 'Comfortable', 'Rich']) await expect(layout.getByRole('button', { name: `Layout density ${name}`, exact: true })).toBeVisible();
  for (const name of ['Auto', 'Essential', 'Standard', 'Rich']) await expect(detail.getByRole('button', { name: `Information detail ${name}`, exact: true })).toBeVisible();
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('settings-dials.png') });

  const start = await openLab(page);
  expect(start.lines.length, 'Standard detail shows source-backed evidence lines').toBeGreaterThan(0);

  // Layout: Rich spacing, same information.
  group = await back(page);
  await group.getByTestId('density-rich').click({ noWaitAfter: true });
  const richLayout = await openLab(page);
  expect(richLayout.inset, 'layout dial changes padding').toBeGreaterThan(start.inset);
  expect(richLayout.minHeight, 'layout dial changes tile size').not.toBe(start.minHeight);
  expect(richLayout.lines, 'layout dial leaves the shown information alone').toEqual(start.lines);

  // Detail: Rich information, same geometry.
  group = await back(page);
  await group.getByTestId('information-detail-rich').click({ noWaitAfter: true });
  const richDetail = await openLab(page);
  expect(richDetail.lines.length, 'detail dial adds evidence').toBeGreaterThan(richLayout.lines.length);
  expect(richDetail.lines.some(line => line.startsWith('Range:'))).toBe(true);
  expect({ inset: richDetail.inset, minHeight: richDetail.minHeight }, 'detail dial leaves geometry alone').toEqual({ inset: richLayout.inset, minHeight: richLayout.minHeight });
  await page.screenshot({ path: info.outputPath('lab-rich-detail.png') });

  // Detail Essential hides the evidence lines, geometry still untouched; Layout Compact then tightens only geometry.
  group = await back(page);
  await group.getByTestId('information-detail-essential').click({ noWaitAfter: true });
  const essential = await openLab(page);
  expect(essential.lines).toEqual([]);
  expect({ inset: essential.inset, minHeight: essential.minHeight }).toEqual({ inset: richLayout.inset, minHeight: richLayout.minHeight });
  group = await back(page);
  await group.getByTestId('density-compact').click({ noWaitAfter: true });
  const compact = await openLab(page);
  expect(compact.inset).toBeLessThan(start.inset);
  expect(compact.lines).toEqual([]);

  // Auto is the opt-in coupling: it follows the layout preset (Compact → essential).
  group = await back(page);
  await group.getByTestId('information-detail-auto').click({ noWaitAfter: true });
  await group.getByTestId('density-rich').click({ noWaitAfter: true });
  const auto = await openLab(page);
  expect(auto.lines).toEqual(richDetail.lines);
  await page.screenshot({ path: info.outputPath('lab-auto-rich.png') });
});
