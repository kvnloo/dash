// DA-062 (#277): the chat badge is a compressed "host / harness / profile / session / model" route. Tapping it
// shows that trace, lets the owner pick the model for the next turn, and warps the window to another session.
// Real Expo web UI at phone width -> isolated real bridge -> ACP fixture (set_model and prompts are logged).
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { test, expect, openChat, send, chatRow } from './fixtures';
import type { Locator } from 'playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

const top = async (target: Locator) => { const b = await target.boundingBox(); if (!b) throw Error('no box'); return b.y; };
const lines = async (path: string) => (await readFile(path, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);

test('chat badge traces host harness profile session model, switches the next turn model and warps to another session', async ({ page, bridge }, info) => {
  await openChat(page, bridge);
  const transcript = page.getByTestId('transcript-viewport');
  await send(page, 'ARMY_DA062 first turn');
  await expect(transcript.getByText(/ARMY_REPLY: ARMY_DA062 first turn/)).toBeVisible({ timeout: 15000 });
  const rowId = (await chatRow(page).getAttribute('data-testid'))?.replace(/^chat-row-/, '');
  if (!rowId) throw Error('chat row id missing');

  // The badge opens the trace: host › harness (› profile), then the session, then the model.
  const badge = page.getByTestId('chat-window-badge');
  await badge.click({ noWaitAfter: true });
  const sheet = page.getByTestId('chat-window-identity');
  await expect(sheet).toBeVisible();
  const crumbs = page.getByTestId('chat-window-breadcrumb');
  await expect(crumbs).toHaveAttribute('aria-label', `Host ${hostname()}, harness OMP`);
  expect(await top(crumbs)).toBeLessThan(await top(page.getByTestId('chat-window-session-id')));
  expect(await top(page.getByTestId('chat-window-session-id'))).toBeLessThan(await top(page.getByTestId('chat-window-model')));
  await expect(page.getByTestId('chat-window-model-change')).toHaveText("Model change: Change picks the next turn's model");
  await page.screenshot({ path: info.outputPath('badge-tree-390.png') });

  // Pick a host-configured model for the next turn. Nothing is sent by choosing.
  const starts = async () => (await lines(join(bridge.dir, 'army-acp-turns.jsonl'))).filter(line => line.includes('"event":"start"')).length;
  const startsBefore = await starts();
  await page.getByTestId('chat-window-change-model').click({ noWaitAfter: true });
  const models = page.getByTestId('chat-window-models');
  await expect(models).toBeVisible();
  await expect(page.getByTestId('chat-window-model-default')).toHaveAttribute('aria-label', 'Use the host default model, current choice');
  const roleChoice = models.locator('[data-testid^="chat-window-model-choice-"]').first();
  await expect(roleChoice, 'the host model roles are offered').toBeVisible({ timeout: 10000 });
  const model = (await roleChoice.getAttribute('data-testid'))?.replace(/^chat-window-model-choice-/, '');
  if (!model) throw Error('model choice id missing');
  info.annotations.push({ type: 'model', description: model });
  const requested = new RegExp(`Next turn requests model ${model.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\.$`);
  await roleChoice.click({ noWaitAfter: true });
  await expect(models).toHaveCount(0);
  await expect(page.getByTestId('chat-window-requested-model')).toHaveAttribute('aria-label', `Next turn requests model ${model}`);
  await expect(badge).toHaveAttribute('aria-label', requested);
  await expect(badge).toContainText('→');
  await expect(page.getByTestId('composer-model-button')).toContainText(`Requested · ${model}`);
  await page.screenshot({ path: info.outputPath('badge-model-picked-390.png') });
  expect(await starts(), 'choosing a model sends nothing').toBe(startsBefore);
  await badge.click({ noWaitAfter: true });
  await expect(sheet).toHaveCount(0);

  // The next turn uses it: the host applies session/set_model before the prompt, and the reply's trace names it.
  await send(page, 'ARMY_DA062 second turn');
  await expect(transcript.getByText(/ARMY_REPLY: ARMY_DA062 second turn/)).toBeVisible({ timeout: 15000 });
  const replyModel = transcript.getByTestId('reply-model');
  await expect(replyModel).toHaveCount(1);
  await expect(replyModel).toHaveText(`Model · ${model}`);
  const turns = await lines(join(bridge.dir, 'army-acp-turns.jsonl'));
  const modelSet = turns.findIndex(line => line.includes('"event":"model"') && line.includes(`"text":"${model}"`));
  const prompted = turns.findIndex(line => line.includes('"event":"start"') && line.includes('ARMY_DA062 second turn'));
  expect(modelSet, 'set_model reached the host').toBeGreaterThan(-1);
  expect(prompted, 'prompt ran after the model was set').toBeGreaterThan(modelSet);
  expect(turns.findIndex(line => line.includes('"event":"start"') && line.includes('ARMY_DA062 first turn')), 'first turn ran before any model change').toBeLessThan(modelSet);

  // Warp: the badge lists the pairing's other sessions by host › harness; picking one switches this window.
  await badge.click({ noWaitAfter: true });
  await page.getByTestId('chat-window-switch-session').click({ noWaitAfter: true });
  const sessions = page.getByTestId('chat-window-sessions');
  await expect(sessions).toBeVisible();
  const hermes = sessions.getByRole('button', { name: /^Switch to ARMY native fixture, host .*, harness Hermes/ });
  await expect(hermes).toHaveCount(1, { timeout: 15000 });
  await expect(sessions.getByTestId(`chat-window-warp-${rowId}`)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('badge-sessions-390.png') });
  await hermes.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(badge).toHaveAttribute('aria-label', /harness Hermes, .*session army-fixture-session/);
  await expect(transcript.getByText(/ARMY_DA062/)).toHaveCount(0);
  await expect(badge).not.toContainText('→');
  await expect(badge).not.toHaveAttribute('aria-label', /Next turn requests model/);
  // That Hermes chat is attached to a gateway session, which takes no model override: the sheet says so.
  await badge.click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window-change-model')).toHaveCount(0);
  await expect(page.getByTestId('chat-window-model-change')).toHaveText(/^Model change unavailable/);
  await badge.click({ noWaitAfter: true });

  // And back again: the first chat keeps its transcript and its requested model.
  await badge.click({ noWaitAfter: true });
  await page.getByTestId('chat-window-switch-session').click({ noWaitAfter: true });
  await page.getByTestId(`chat-window-warp-${rowId}`).click({ noWaitAfter: true });
  await expect(badge).toHaveAttribute('aria-label', /harness OMP/);
  await expect(transcript.getByText(/ARMY_REPLY: ARMY_DA062 second turn/)).toBeVisible();
  await expect(badge).toHaveAttribute('aria-label', requested);
  await expect(badge).toContainText('→');

  // Host default clears the request; the next turn carries no model.
  await badge.click({ noWaitAfter: true });
  await page.getByTestId('chat-window-change-model').click({ noWaitAfter: true });
  await page.getByTestId('chat-window-model-default').click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window-requested-model')).toHaveCount(0);
  await expect(badge).not.toContainText('→');
  await expect(badge).not.toHaveAttribute('aria-label', /Next turn requests model/);
});
