// Learn surface (DA-010, #552): Map it draws a Mermaid concept map, Explain answers as native
// cards, and S Pen ink drawn from Learn reaches the agent as a Learn sketch (PNG + strokes JSON).
// One real Expo web app -> authenticated Bun bridge -> fixture ACP agent; visible controls only.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { test, expect, openChat, web } from './fixtures';
import type { Page } from 'playwright/test';

test.use({ bridgeOptions: { generatedUI: true } });
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

const learnPanel = (page: Page) => page.getByTestId('mode-surface-learn');

async function openLearn(page: Page, topic: string) {
  // In the chat window the camera pill expands the AppNav that owns the mode pill: Normal -> Learn.
  await page.getByTestId('chat-window-pill').click({ noWaitAfter: true });
  await page.getByTestId('spen-mode-pill').last().click({ noWaitAfter: true });
  await expect(learnPanel(page)).toBeVisible();
  await page.getByRole('textbox', { name: 'Learn topic', exact: true }).fill(topic);
}

const prompts = async (dir: string) => readFile(join(dir, 'army-acp-turns.jsonl'), 'utf8').catch(() => '');

test('learn: Map it renders the topic as an interactive Mermaid concept map, not code', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge);
  await openLearn(page, 'photosynthesis');
  await page.getByRole('button', { name: 'Map the topic as a diagram', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('learn-note')).toContainText('Sent to');
  await expect.poll(() => prompts(bridge.dir)).toContain('[Dash · Learn mode · map] Topic: photosynthesis');
  const diagram = page.getByRole('application', { name: 'Interactive Mermaid diagram', exact: true });
  await expect(diagram).toBeVisible({ timeout: 30_000 });
  // The model's real Mermaid: circle/stadium/subroutine/hexagon shapes, a subgraph, a quoted
  // label, `-- text -->`, `&` fan-out and style lines. Every node is drawn; nothing falls back.
  for (const label of ['Sunlight', 'Chlorophyll', 'Water (H2O)', 'Oxygen', 'ATP & NADPH', 'CO2', 'Calvin cycle', 'Glucose']) {
    await expect(diagram.getByText(label, { exact: true }), `node ${label}`).toBeVisible();
  }
  await expect(diagram.getByText('split by light', { exact: true })).toBeVisible();
  await expect(diagram.getByText('excites', { exact: true })).toBeVisible();
  await expect(page.getByLabel('table: ARMY map parts: photosynthesis', { exact: true })).toBeVisible();
  // The reply's Mermaid source is drawn, never shown (the Learn prompt bubble itself names "flowchart TD").
  await expect(page.getByText(/classDef hot|Calvin cycle\]\]/)).toHaveCount(0);
  await expect(page.getByRole('alert', { name: 'Interface could not be rendered', exact: true })).toHaveCount(0);
  // Close Learn so the screenshot shows the map the owner sees under it.
  await page.getByRole('button', { name: 'Close Learn mode', exact: true }).click({ noWaitAfter: true });
  await diagram.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('learn-map-it.png') });
});

test('learn: Explain answers the topic as native cards with a check-yourself choice', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge);
  await openLearn(page, 'tidal locking');
  await page.getByRole('button', { name: 'Explain the topic as cards', exact: true }).click({ noWaitAfter: true });
  await expect.poll(() => prompts(bridge.dir)).toContain('[Dash · Learn mode · explain] Topic: tidal locking');
  await expect(page.getByLabel('card: ARMY Learn card', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('ARMY explains tidal locking', { exact: true })).toBeVisible();
  await expect(page.getByText('ARMY answer A', { exact: true })).toBeVisible();
  // The reply's genui JSON is drawn, never shown (the Learn prompt bubble itself quotes the format).
  await expect(page.getByText(/"label":"ARMY answer A"/)).toHaveCount(0);
});

/** A trusted Chromium stroke with pointerType=pen, the way the S Pen reaches the web view. */
async function penStroke(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.6 });
    for (let i = 1; i <= 12; i++) {
      const x = from.x + ((to.x - from.x) * i) / 12, y = from.y + ((to.y - from.y) * i) / 12;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.6 });
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
  } finally { await cdp.detach(); }
}

for (const engine of ['skia', 'tldraw'] as const) {
  test(`learn: ${engine} S Pen sketch from Learn reaches the agent with its topic and returns to Learn`, async ({ page, bridge }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openChat(page, bridge, `${web}?annotateEngine=${engine}`);
    await openLearn(page, 'a solar sail');
    await page.getByRole('button', { name: 'Draw it with the S Pen for the agent', exact: true }).click({ noWaitAfter: true });
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
    await expect(learnPanel(page)).toHaveCount(0);
    await expect(page.getByText(/^Learn sketch: a solar sail · /)).toBeVisible();
    if (engine === 'tldraw') await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
    await penStroke(page, { x: 90, y: 420 }, { x: 290, y: 520 });
    await penStroke(page, { x: 290, y: 420 }, { x: 90, y: 520 });
    const send = page.getByRole('button', { name: 'Send annotation', exact: true });
    await expect(send).toBeEnabled();
    await send.click({ noWaitAfter: true });
    // The Learn header carries the intent, so there is no "marks only?" detour.
    await expect(page.getByText('No words captured. Send the marks only?')).toHaveCount(0);
    // Sent: the overlay closes back into Learn with the topic kept.
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(learnPanel(page)).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Learn topic', exact: true })).toHaveValue('a solar sail');

    // What the agent was handed: the Learn sketch prompt plus the PNG and strokes JSON it can open.
    let row: { text: string; blocks: { type: string; name: string; mimeType: string; uri: string }[] } | undefined;
    await expect.poll(async () => {
      const lines = (await readFile(join(bridge.dir, 'army-acp-prompts.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean);
      row = lines.map(line => JSON.parse(line)).find(r => String(r.text).startsWith('[Dash · Learn mode · sketch] Topic: a solar sail'));
      return row?.blocks.map(b => b.mimeType).sort().join(',');
    }, { timeout: 30_000 }).toBe('application/json,image/png');
    const png = row!.blocks.find(b => b.mimeType === 'image/png')!;
    const json = row!.blocks.find(b => b.mimeType === 'application/json')!;
    const bytes = await readFile(fileURLToPath(png.uri));
    expect(bytes.subarray(1, 4).toString('latin1'), 'the agent can open a real PNG').toBe('PNG');
    const doc = JSON.parse(await readFile(fileURLToPath(json.uri), 'utf8'));
    expect(doc.strokes.length, 'both S Pen strokes reach the agent').toBe(2);
    expect(doc.strokes.map((s: { pointer: string }) => s.pointer), 'both strokes are S Pen (stylus) strokes').toEqual(['stylus', 'stylus']);

    // And the agent's answer, which names the files it received, renders as cards in the chat.
    await page.getByRole('button', { name: 'Close Learn mode', exact: true }).click({ noWaitAfter: true });
    await expect(page.getByLabel('card: ARMY saw your sketch', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(new RegExp(`ARMY sketch files: ${png.name.replace(/[.]/g, '\\.')} \\(image/png\\)`))).toBeVisible();
    await page.screenshot({ path: info.outputPath(`learn-sketch-${engine}.png`) });
  });
}
