import { test, expect } from './fixtures';
import { openAnnotation, stroke } from './annotation';

const engines: ('skia' | 'tldraw')[] = ['skia', 'tldraw'];

for (const engine of engines) {
  test(`annotation-voice-quiet: ${engine} entry does not surface voice UI or shift header`, async ({ page, bridge }) => {
    const voiceWarnings: string[] = [];
    page.on('console', message => {
      if (message.type() === 'warning' && message.text().includes('[voice]')) voiceWarnings.push(message.text());
    });
    await openAnnotation(page, bridge, engine);

    // This real bridge fixture has no z0bridge identity. Auto-start must fail
    // into a tray note, not a globally visible error or extra safe-area row.
    const note = page.getByTestId('annotation-voice-note');
    await expect(note).toContainText('Live voice unavailable:', { timeout: 3000 });
    await expect(note).toContainText('Hold Talk or type a note.');
    await expect(page.getByRole('button', { name: 'Hold to talk', exact: true })).toBeEnabled();
    await expect(page.getByTestId('voice-error')).toHaveCount(0);
    await expect(page.getByTestId('voice-mic-bar')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);

    if (engine === 'tldraw') await expect(page.getByTestId('annotate-tldraw')).toHaveAttribute('data-ready', 'true');
    await stroke(page);
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('voice-error')).toHaveCount(0);
    await expect(page.getByTestId('voice-mic-bar')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.getByRole('button', { name: 'Exit annotation', exact: true }).click();
    await expect(page.getByTestId('voice-mic-bar')).toHaveCount(0);
    await expect(note).toHaveCount(0);

    // Re-enter with a measured, known header location: even a brief voice
    // connecting state must not inset the app beneath the S Pen.
    const header = page.getByRole('button', { name: 'Options. Current surface: Chat', exact: true });
    const before = await header.boundingBox();
    expect(before).not.toBeNull();
    await header.click();
    await page.getByRole('button', { name: 'Annotate, S Pen or finger', exact: true }).click();
    await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
    expect(await header.boundingBox()).toEqual(before);

    await expect(note).toContainText('Live voice unavailable:', { timeout: 3000 });
    await expect(page.getByRole('button', { name: 'Hold to talk', exact: true })).toBeEnabled();
    await expect(page.getByTestId('voice-error')).toHaveCount(0);
    await expect(page.getByTestId('voice-mic-bar')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(voiceWarnings).toEqual([]);
    await page.getByRole('button', { name: 'Exit annotation', exact: true }).click();
    await expect(page.getByTestId('voice-mic-bar')).toHaveCount(0);
  });
}
