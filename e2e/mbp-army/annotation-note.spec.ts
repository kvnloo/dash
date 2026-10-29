import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { test, expect } from './fixtures';
import { openAnnotation, stroke } from './annotation';

// Inspect actual host-side uploads, including staged files that have not yet
// been claimed by a turn. Never intercept or mock the real bridge attachment API.
async function annotationFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const groups = await Promise.all((await readdir(dir, { withFileTypes: true })).map(async entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? annotationFiles(path) : [path];
  }));
  return groups.flat().filter(path => /^annotation-.*\.(png|json)$/.test(basename(path)));
}

async function newestJsonText(dir: string): Promise<string> {
  const paths = (await annotationFiles(dir)).filter(path => path.endsWith('.json'));
  const ordered = await Promise.all(paths.map(async path => ({ path, mtime: (await stat(path)).mtimeMs })));
  ordered.sort((a, b) => b.mtime - a.mtime);
  const path = ordered[0]?.path;
  if (!path) return '';
  const doc: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (typeof doc !== 'object' || doc === null || !('transcript' in doc)) return '';
  const transcript = doc.transcript;
  if (typeof transcript !== 'object' || transcript === null || !('text' in transcript)) return '';
  return typeof transcript.text === 'string' ? transcript.text : '';
}

const engines: ('skia' | 'tldraw')[] = ['skia', 'tldraw'];
for (const engine of engines) {
  test(`annotation-note: ${engine} sends typed intent and ink to chat and host JSON`, async ({ page, bridge }) => {
    const attachments = join(bridge.dir, '.dash', 'attachments');
    await openAnnotation(page, bridge, engine);
    if (engine === 'tldraw') await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', { name: 'Type a note', exact: true }).click();
    const note = page.getByTestId('annotation-note');
    await expect(note).toHaveAttribute('aria-label', 'Type a note');
    await note.fill('make this taller');
    // Hide the editor to leave the full drawing area clear; its words remain.
    await page.getByRole('button', { name: 'Type a note', exact: true }).click();
    await stroke(page);
    await page.getByRole('button', { name: 'Send annotation', exact: true }).click({ noWaitAfter: true });
    await expect(page.getByTestId('chat-window')).toContainText('make this taller');
    await expect(page.getByTestId('chat-window')).toContainText('⟦stroke 1⟧');
    await expect.poll(() => newestJsonText(attachments), { timeout: 15000 }).toContain('make this taller');
  });

  test(`annotation-note: ${engine} empty words confirmation cancels without uploads or a turn`, async ({ page, bridge }) => {
    const attachments = join(bridge.dir, '.dash', 'attachments');
    await openAnnotation(page, bridge, engine);
    if (engine === 'tldraw') await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
    await stroke(page);
    const before = (await annotationFiles(attachments)).sort();
    const posts: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/attachments?')) posts.push(request.url());
    });
    await page.getByRole('button', { name: 'Send annotation', exact: true }).click({ noWaitAfter: true });
    await expect(page.getByText('No words captured. Send the marks only?', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send anyway', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    await expect(page.getByTestId('annotation-note')).toBeVisible();
    await expect(page.getByText('No words captured. Send the marks only?', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId('chat-window')).not.toContainText('Annotated ');
    expect((await annotationFiles(attachments)).sort()).toEqual(before);
    expect(posts).toEqual([]);
  });
}
