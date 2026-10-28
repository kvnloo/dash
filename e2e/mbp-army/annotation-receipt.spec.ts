// Annotation receipt is a real app -> real bridge -> ACP fixture journey.
// ARMY_HOLD emits its first text delta immediately but cannot complete until
// the spec releases it. No mocked socket, store seeding or duplicate sends.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright/test';
import { test, expect } from './fixtures';
import { openAnnotation, stroke } from './annotation';

async function noteAndStroke(page: Page, note: string): Promise<void> {
  await page.getByRole('button', { name: 'Type a note', exact: true }).click();
  await page.getByTestId('annotation-note').fill(note);
  await page.getByRole('button', { name: 'Type a note', exact: true }).click();
  await stroke(page);
}

async function startedTurns(dir: string): Promise<number> {
  const raw = await readFile(join(dir, 'army-acp-turns.jsonl'), 'utf8').catch(() => '');
  return raw.split('\n').filter(Boolean).map(line => {
    const record: unknown = JSON.parse(line);
    return record;
  }).filter(record => typeof record === 'object' && record !== null && 'event' in record && record.event === 'start').length;
}

test('annotation-receipt: OMP streamed delta confirms one annotation before its 35s-held reply ends', async ({ page, bridge }) => {
  await openAnnotation(page, bridge);
  await noteAndStroke(page, 'ARMY_HOLD receipt stream stays active');
  await page.getByRole('button', { name: 'Send annotation', exact: true }).click();

  // The ACP peer sends ARMY_STREAM_BEGIN, then deliberately remains held.
  await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({ visible: true }).first()).toBeVisible({ timeout: 20000 });
  const stop = page.getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeVisible();
  // The app must acknowledge the streamed event, not wait for end_turn.
  await expect(page.getByText(/Sent to .+ · 1 strokes/)).toBeVisible({ timeout: 20000 });
  await expect(stop).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /Delivery unconfirmed/ })).toHaveCount(0);

  await page.waitForTimeout(35_200);
  await expect(stop).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /Delivery unconfirmed/ })).toHaveCount(0);
  await expect(page.getByTestId('transcript-viewport').getByText(/^Annotated .* \(1 stroke\)/)).toHaveCount(1);
  expect(await startedTurns(bridge.dir)).toBe(1);
  expect(bridge.logs().match(/ws\.chat /g)).toHaveLength(1);

  await writeFile(join(bridge.dir, 'army-release'), '');
  await expect(page.getByText(/ARMY_REPLY:/).filter({ visible: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(stop).toHaveCount(0);
  expect(await startedTurns(bridge.dir)).toBe(1);
});

test('annotation-receipt: offline Send then reconnect and Send again creates just one turn', async ({ page, bridge }) => {
  await openAnnotation(page, bridge);
  await noteAndStroke(page, 'ARMY receipt offline reconnect');

  await page.context().setOffline(true);
  // Network emulation rejects the real bridge upload even if the existing
  // WebSocket has not emitted its close event yet.
  await page.getByRole('button', { name: 'Send annotation', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Offline|Network|fetch failed|Failed to fetch|Could not reach the bridge/i })).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('transcript-viewport').getByText(/^Annotated .* \(1 stroke\)/)).toHaveCount(0);
  expect(await startedTurns(bridge.dir)).toBe(0);

  await page.context().setOffline(false);
  await expect(page.getByTestId('connection-banner')).toHaveCount(0, { timeout: 30000 });
  await page.getByRole('button', { name: 'Send annotation', exact: true }).click();
  await expect(page.getByText(/Sent to .+ · 1 strokes/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('transcript-viewport').getByText(/^Annotated .* \(1 stroke\)/)).toHaveCount(1);
  await expect(page.getByText(/ARMY_REPLY:/).filter({ visible: true }).first()).toBeVisible({ timeout: 30000 });
  expect(await startedTurns(bridge.dir)).toBe(1);
  expect(bridge.logs().match(/ws\.chat /g)).toHaveLength(1);
});
