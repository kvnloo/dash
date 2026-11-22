import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, pair, web } from './fixtures';
import { EPHEMERAL_CATALOG_SHA256, EPHEMERAL_CATALOG_VERSION, EPHEMERAL_KINDS, EPHEMERAL_KIT_REV } from '../../app/src/vendor/ephemeral-ui/kinds.generated';

// DA-078: the Dash card gallery draws every fixture of every kind in the shared kvnloo/ephemeral-ui catalog
// (catalog/README.md "What an app's gallery test must assert": coverage, every fixture mounts, props parity,
// unavailable/example states, version shown). The catalog is the vendored, pinned copy beside the kit.
const file = join(__dirname, '../../app/src/vendor/ephemeral-ui/catalog.json');
const text = readFileSync(file, 'utf8');
type Fixture = { id: string; state: string; card: { kind: string; app: string } };
const catalog: { v: number; version: string; count: { kinds: number; fixtures: number }; kinds: { kind: string; fixtures: Fixture[] }[] } = JSON.parse(text);
const fixtures = catalog.kinds.flatMap(k => k.fixtures);
const PAGE = 6; // app/src/lib/gallery.ts GALLERY_PAGE_SIZE
const pages = Math.ceil(fixtures.length / PAGE);
const label = `catalog v${catalog.version} · ephemeral-ui@${EPHEMERAL_KIT_REV.slice(0, 7)} · ${catalog.kinds.length} kinds · ${fixtures.length} fixtures`;

test.afterEach(async ({ page }, info) => { if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') }); });

test('card gallery opens from Settings, shows the pinned catalog version and lists every catalog kind', async ({ page, bridge }) => {
 // The pin is the kit's file, unedited, and the kit Dash vendors draws exactly the catalog's kinds.
 expect(catalog.v).toBe(0);
 expect(catalog.version).toBe(EPHEMERAL_CATALOG_VERSION);
 expect(createHash('sha256').update(text).digest('hex')).toBe(EPHEMERAL_CATALOG_SHA256);
 expect(fixtures.length).toBe(catalog.count.fixtures);
 expect([...EPHEMERAL_KINDS].sort()).toEqual(catalog.kinds.map(k => k.kind).sort());

 await pair(page, bridge);
 await page.getByRole('button', { name: 'Open settings', exact: true }).first().click();
 await page.getByRole('button', { name: 'Card gallery', exact: true }).click();
 await expect(page.getByTestId('gallery-version')).toHaveText(label);
 await expect(page.getByTestId('gallery-page-status')).toContainText(`Fixtures 1–${PAGE} of ${fixtures.length}`);
 await expect(page.getByRole('button', { name: 'Previous gallery page', exact: true }).first()).toBeDisabled();

 // Coverage: one index entry per catalog kind, none missing, none extra.
 const chips = page.locator('[data-testid^="gallery-kind-"]');
 await expect(chips).toHaveCount(catalog.kinds.length);
 const shown = await chips.evaluateAll(els => els.map(e => e.getAttribute('data-testid')?.replace('gallery-kind-', '')));
 expect(shown.sort()).toEqual(catalog.kinds.map(k => k.kind).sort());

 // The index jumps to a kind's page; Next and Prev walk the pages.
 const last = catalog.kinds[catalog.kinds.length - 1]!;
 await page.getByTestId(`gallery-kind-${last.kind}`).click();
 await expect(page.getByText(`Page ${pages} of ${pages}`, { exact: true }).first()).toBeVisible();
 await expect(page.getByTestId(`gallery-cell-${last.fixtures[0]!.id}`)).toBeVisible();
 await expect(page.getByRole('button', { name: 'Next gallery page', exact: true }).first()).toBeDisabled();
 await page.getByRole('button', { name: 'Previous gallery page', exact: true }).first().click();
 await expect(page.getByText(`Page ${pages - 1} of ${pages}`, { exact: true }).first()).toBeVisible();
 await expect(page.getByTestId(`gallery-cell-${fixtures[(pages - 2) * PAGE]!.id}`)).toBeVisible();
 await page.getByRole('button', { name: 'Back', exact: true }).click();
 await expect(page.getByRole('button', { name: 'Card gallery', exact: true })).toBeVisible();
});

// Every fixture mounts: the gallery is walked a page at a time, every catalog fixture on exactly one page.
for (let p = 1; p <= pages; p++) {
 const cells = fixtures.slice((p - 1) * PAGE, p * PAGE);
 test(`card gallery page ${p} of ${pages} mounts every catalog fixture with catalog props`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`${web}/gallery?page=${p}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('gallery-version')).toHaveText(label, { timeout: 120_000 });
  await expect(page.getByText(`Page ${p} of ${pages}`, { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-testid^="gallery-cell-"]')).toHaveCount(cells.length);
  for (const f of cells) {
   await expect(page.getByTestId(`gallery-cell-${f.id}`)).toBeVisible();
   const frame = page.frameLocator(`iframe[title="fixture ${f.id}"]`);
   const card = frame.locator(`.eu-card[data-kind="${f.card.kind}"]`);
   await expect(card).toBeVisible({ timeout: 30_000 });
   await expect(frame.getByRole('alert')).toHaveCount(0);
   // Props parity: the drawn card's spec deep-equals fixture.props (compared in the app, shown per cell).
   await expect(page.getByTestId(`gallery-status-${f.id}`)).toHaveText('Mounted · props match catalog', { timeout: 30_000 });
   const body = await card.innerText();
   expect(body.trim().length, `${f.id} draws text`).toBeGreaterThan(0);
   expect(body, `${f.id} has no undefined/NaN`).not.toMatch(/\bundefined\b|\bNaN\b/);
   // States: unavailable fixtures show the unavailable state; example, input and sample fixtures do not.
   if (f.state === 'unavailable') expect(body).toMatch(/data unavailable/i);
   else expect(body).not.toMatch(/data unavailable/i);
  }
  await expect(page.getByTestId('gallery-page-status')).toContainText(`${cells.length}/${cells.length} drawn · ${cells.length}/${cells.length} props match catalog`);
 });
}
