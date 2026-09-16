import { expect, test } from '@playwright/test';

const SECTIONS = [
  'Formal object',
  'Three objects, never substituted',
  'Readings',
  'Translation',
  'Silhouettes',
  'Named hybrid — C(RAID)',
  'Adapters',
  'Visual decoder',
];

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('AODL');
});

test('introduces the IR, not a cores dump', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('AODL');
  await expect(page.locator('h2')).toHaveText(SECTIONS);
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.aodl-tex--display').first()).toContainText('O');
});

test('object cards do not leak MathML into headings', async ({ page }) => {
  const headings = page.locator('.aodl-objects h3');
  await expect(headings).toHaveText(['Intent', 'Compiled plan', 'Observed']);
  for (const heading of await headings.all()) {
    const text = await heading.innerText();
    expect(text).not.toMatch(/i\s+n\s+t\s+e\s+n\s+t/);
    expect(text.split('\n').length).toBe(1);
    await expect(heading.locator('.katex-mathml')).toHaveCount(0);
    await expect(heading.locator('.aodl-tex')).toHaveCount(0);
  }
});

test('display math lines up with the copy column', async ({ page }) => {
  const copy = page.locator('.aodl-language__hero p').last();
  const display = page.locator('.aodl-tex--display').first();
  const copyBox = await copy.boundingBox();
  const mathBox = await display.boundingBox();
  expect(copyBox).toBeTruthy();
  expect(mathBox).toBeTruthy();
  expect(Math.abs(mathBox.x - copyBox.x)).toBeLessThan(24);
  const katex = display.locator('.katex').first();
  const katexBox = await katex.boundingBox();
  expect(Math.abs(katexBox.x - copyBox.x)).toBeLessThan(24);
});

test('translation spec link stays on one line', async ({ page }) => {
  const link = page.locator('#aodl-tau-title + p a').first();
  await expect(link).toHaveAttribute('href', /spec\/translation\.md$/);
  const box = await link.boundingBox();
  const fontSize = await link.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(box.height).toBeLessThan(fontSize * 1.8);
});

test('no duplicate encoding expand or HomeForge design.html', async ({ page }) => {
  await expect(page.locator('.agent-encoding-reference')).toHaveCount(0);
  await expect(page.locator('.agent-topology-provider-picker')).toHaveCount(0);
  await expect(page.locator('details')).toHaveCount(0);
  await expect(page.locator('a[href*="design.html"]')).toHaveCount(0);
  await expect(page.locator('.agent-core-language')).toHaveCount(1);
  await expect(page.locator('.agent-capability-core')).toHaveCount(3);
});

test('no horizontal overflow at phone and desktop', async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth > root.clientWidth + 2;
    });
    expect(overflow, `overflow at ${width}px`).toBe(false);
  }
});
