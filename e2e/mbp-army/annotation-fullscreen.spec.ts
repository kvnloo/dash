import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { test, expect } from './fixtures';
import { openAnnotation } from './annotation';

const HEIGHT = 844;
const WIDTHS: readonly number[] = [390, 800];
const ENGINES: readonly ('skia' | 'tldraw')[] = ['skia', 'tldraw'];

/** Read the actual bytes stored by the isolated, authenticated bridge. */
async function newestAnnotation(bridgeDir: string): Promise<unknown | null> {
  const root = join(bridgeDir, '.dash', 'attachments');
  let paths: string[];
  try {
    paths = await readdir(root, { recursive: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
  const files = paths.filter(path => /^annotation-.*\.json$/.test(basename(path)));
  if (files.length === 0) return null;
  // The bridge moves an upload out of staging while we list it: a vanished file is "not yet", never an error.
  const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';
  const dated = (await Promise.all(files.map(async path => {
    const absolute = join(root, path);
    try { return { path: absolute, mtimeMs: (await stat(absolute)).mtimeMs }; }
    catch (error) { if (missing(error)) return null; throw error; }
  }))).filter((entry): entry is { path: string; mtimeMs: number } => entry !== null);
  dated.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = dated[0];
  if (!newest) return null;
  try {
    const doc: unknown = JSON.parse(await readFile(newest.path, 'utf8'));
    return doc;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function containsBottomInk(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object' || !('strokes' in doc) || !Array.isArray(doc.strokes)) return false;
  const strokes: readonly unknown[] = doc.strokes;
  return strokes.some(stroke => {
    if (!stroke || typeof stroke !== 'object' || !('points' in stroke) || !Array.isArray(stroke.points)) return false;
    const points: readonly unknown[] = stroke.points;
    return points.some(point => Array.isArray(point) && typeof point[1] === 'number' && point[1] > 0.9);
  });
}

for (const engine of ENGINES) {
  for (const width of WIDTHS) {
    test(`annotation-fullscreen: ${engine} ${width}px bottom stroke is uploaded`, async ({ page, bridge }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await openAnnotation(page, bridge, engine);
      if (engine === 'tldraw') await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');

      // The border must include both safe-area/navigation and the dock, not stop at 280dp.
      const frame = await page.getByLabel('Annotation mode on', { exact: true }).boundingBox();
      if (!frame) throw new Error('Annotation frame is not mounted');
      expect(frame.y).toBe(0);
      expect(frame.y + frame.height).toBe(HEIGHT);

      // Draw OVER the composer/dock region; neither renderer may clip this mouse gesture.
      await page.mouse.move(100, HEIGHT - 40);
      await page.mouse.down();
      await page.mouse.move(width - 100, HEIGHT - 24, { steps: 6 });
      await page.mouse.up();
      await expect(page.getByRole('button', { name: 'Send annotation', exact: true })).toBeEnabled();

      // C19 requires captured words before direct Send. Use its real, visible note
      // editor when integrated; the pre-C19 base sends the same ink without a note.
      const noteButton = page.getByRole('button', { name: 'Type a note', exact: true });
      if (await noteButton.count() === 1) {
        await noteButton.click();
        await page.getByRole('textbox', { name: 'Type a note', exact: true })
          .fill('Please check the bottom-screen annotation.');
      }

      const imageUpload = page.waitForRequest(request =>
        request.method() === 'POST' && request.url().includes('/attachments?') &&
        request.headers()['content-type'] === 'image/png');
      const jsonUpload = page.waitForResponse(response =>
        response.request().method() === 'POST' && response.url().includes('/attachments?') &&
        response.request().headers()['content-type'] === 'application/json', { timeout: 30000 });
      await page.getByRole('button', { name: 'Send annotation', exact: true }).click();

      // PNG captureTarget must include the former composer blind spot too.
      const png = (await imageUpload).postDataBuffer();
      if (!png) throw new Error('Annotation screenshot bytes not uploaded');
      expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
      expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(HEIGHT);
      await jsonUpload;

      // Never settle for a UI or request-only assertion: inspect the bridge's stored JSON.
      await expect.poll(async () => containsBottomInk(await newestAnnotation(bridge.dir)),
        { timeout: 30000, message: 'bridge annotation JSON contains ink below y=0.9' }).toBe(true);
    });
  }
}
