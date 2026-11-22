// Agent -> app UI control (docs/specs/ui-control.md, #368): an agent on the paired computer runs the
// bridge's `dash-ui` CLI; the real bridge forwards one ui_control frame to the real Expo web app,
// which navigates directly (no synthetic taps) and acks. Consent is the visible Settings switch.
import { test, expect, openChat, send, web } from './fixtures';
import { dashUi, enableAgentControl } from './ui-control';

test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

const TITLE = 'ARMY ui-control target chat';

test('ui-control: agent opens Chats > chat > Annotate over the bridge within 1 s without taps', async ({ page, bridge }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge, `${web}?annotateEngine=skia`);
  await send(page, TITLE);
  await expect(page.getByText(`ARMY_REPLY: ${TITLE}`).first()).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').getByText(TITLE, { exact: true })).toBeVisible();

  // Off by default: the bridge refuses without sending anything, and says how to enable it.
  const off = await dashUi(bridge, 'open', `Chats > ${TITLE} > Annotate`);
  expect(off.code).toBe(1);
  expect(off.answer.status).toBe('disabled');
  expect(String(off.answer.detail)).toContain('Settings > Agent control');
  await expect(page.getByTestId('chat-window')).toHaveCount(0);

  await enableAgentControl(page, bridge);

  // The measured command. Nothing touches the page between here and the assertions.
  const run = await dashUi(bridge, 'open', `Chats > ${TITLE.toUpperCase()} > Annotate`);
  info.annotations.push({ type: 'ui-control-latency', description: JSON.stringify({ wallMs: Math.round(run.wallMs), bridgeMs: run.answer.ms, appMs: run.answer.appMs }) });
  expect(run.code, JSON.stringify(run.answer)).toBe(0);
  expect(run.answer).toMatchObject({ status: 'done', screen: 'Chat', detail: `Opened ${TITLE} › Annotate` });
  expect(Number(run.answer.ms), 'bridge receipt -> app ack, ms').toBeLessThan(1000);
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByText(`ARMY_REPLY: ${TITLE}`).first()).toBeVisible();
  await expect(page.getByLabel('Annotation mode on', { exact: true })).toBeVisible();
  await expect(page.getByTestId('agent-activity-text')).toHaveText(`Agent · Opened ${TITLE} › Annotate`);
  await page.screenshot({ path: info.outputPath('agent-opened-annotate.png') });
  await page.getByRole('button', { name: 'Exit annotation', exact: true }).click({ noWaitAfter: true });

  // Unknown chats are reported, never guessed; other screens use the same path syntax.
  const missing = await dashUi(bridge, 'open', 'Chats > No such chat');
  expect(missing.answer).toMatchObject({ status: 'skipped', detail: 'No chat titled "No such chat" on this phone' });
  const settings = await dashUi(bridge, 'open', 'Settings');
  expect(settings.answer).toMatchObject({ status: 'done', screen: 'Settings' });
  await expect(page.getByRole('switch', { name: 'Agent control', exact: true })).toBeVisible();
  const invalid = await dashUi(bridge, 'open', 'Settings > Danger');
  expect(invalid.code).toBe(2);
  expect(invalid.stderr).toContain('Settings takes no further path');

  // Stop on the receipt turns agent control off at once; the bridge refuses the next command.
  await page.getByRole('button', { name: 'Stop agent control', exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('agent-activity')).toHaveCount(0);
  await expect.poll(async () => (await dashUi(bridge, 'open', 'Chats')).answer.status, { timeout: 10000 }).toBe('disabled');
  await expect(page.getByRole('switch', { name: 'Agent control', exact: true })).toHaveText(/Off$/);
});

test('ui-control: fixture ACP agent drives the app through the same dash-ui API', async ({ page, bridge }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openChat(page, bridge);
  await send(page, 'ARMY ui-control agent chat');
  await expect(page.getByText('ARMY_REPLY: ARMY ui-control agent chat').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close chat window', exact: true }).click({ noWaitAfter: true });
  await enableAgentControl(page, bridge);
  await page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').getByText('ARMY ui-control agent chat', { exact: true }).click({ noWaitAfter: true });
  await expect(page.getByTestId('chat-window')).toBeVisible();

  // The agent turn itself runs dash-ui with the environment the bridge gave it.
  await send(page, 'ARMY_UI_CONTROL ["open","Chats"]');
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await expect(page.getByTestId('agent-activity-text')).toHaveText('Agent · Opened Chats');
  await page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').getByText('ARMY ui-control agent chat', { exact: true }).click({ noWaitAfter: true });
  await expect(page.getByText(/ARMY_UI_RESULT \{"status":"done"/).first()).toBeVisible();
  await expect(page.getByText(/"screen":"Main"/).first()).toBeVisible();
});
