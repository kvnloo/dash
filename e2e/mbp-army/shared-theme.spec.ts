import { test, expect, pair } from './fixtures';
import tokens from '../../app/src/vendor/ephemeral-ui/glide.json';
import catalog from '../../app/src/vendor/ephemeral-ui/catalog.json';

const rgb = (hex: string) => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

test('Shared Glide tokens change the preview and every catalog fixture is represented', async ({ page, bridge }, info) => {
  await pair(page, bridge);
  await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
  await page.getByRole('button', { name: 'Shared theme and cards', exact: true }).click();

  const preview = page.getByTestId('shared-theme-preview');
  await expect(preview.getByText(`Glide theme ${tokens.version}`)).toBeVisible();
  await expect(preview).toHaveCSS('background-color', rgb(tokens.color.dark.bg));
  await expect(preview.getByRole('button', { name: 'Dark tokens' })).toHaveCSS('background-color', rgb(tokens.color.dark.primary));
  await preview.getByRole('button', { name: 'Light tokens' }).click();
  await expect(preview).toHaveCSS('background-color', rgb(tokens.color.light.bg));
  await expect(preview.getByRole('button', { name: 'Light tokens' })).toHaveCSS('background-color', rgb(tokens.color.light.primary));
  await page.screenshot({ path: info.outputPath('final.png') });

  await expect(page.getByText(`Card catalog ${catalog.version} · ${catalog.count.kinds} kinds · ${catalog.count.fixtures} fixtures`)).toBeVisible();
  // Traverse the virtualized list using the actual scroll viewport. Check the rendered cells, not just the data length.
  const list = page.getByTestId('shared-card-list');
  const seen = new Map<string, string>();
  const fixtureCells = list.locator('[data-testid^="catalog-fixture:"]');
  const fixtures = catalog.kinds.flatMap(kind => kind.fixtures);
  for (let step = 0; step <= fixtures.length && seen.size < fixtures.length; step++) {
    for (const cell of await fixtureCells.evaluateAll(nodes => nodes.map(node => [node.getAttribute('data-testid') || '', node.textContent || '']))) {
      const [key, value] = cell;
      if (key && value) seen.set(key, value);
    }
    if (seen.size < fixtures.length) {
      // Advance the stable viewport, not the last mounted row: virtualization
      // can recycle that row between a locator's lookup and the scroll action.
      await list.evaluate(node => {
        node.scrollTop += Math.max(1, Math.floor(node.clientHeight * 0.75));
      });
      await list.evaluate(() => new Promise<void>(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    }
  }
  expect([...seen.keys()].sort()).toEqual(fixtures.map(f => `catalog-fixture:${f.id}`).sort());
  for (const fixture of fixtures) {
    const text = seen.get(`catalog-fixture:${fixture.id}`);
    expect(text).toContain(fixture.id);
    expect(text).not.toMatch(/\b(?:undefined|NaN)\b/);
    if (fixture.state === 'unavailable') expect(text).toContain('Data unavailable');
    else expect(text).not.toContain('Data unavailable');
  }
  // Start over at the top for a representative props comparison.
  await page.getByRole('button', { name: 'Back', exact: true }).last().click();
  await page.getByRole('button', { name: 'Shared theme and cards', exact: true }).click();
  const first = fixtures[0];
  await page.getByRole('button', { name: `Fixture details: ${first.id}`, exact: true }).click();
  expect(JSON.parse(await page.getByTestId('catalog-fixture-props').innerText())).toEqual(first.props);
});
