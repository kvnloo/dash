import { test, expect, pair } from './fixtures';

test.use({ bridgeOptions: { env: { ARMY_CHAT_TASK: '1' } }, viewport: { width: 390, height: 844 } });

test('An unopened Chats row shows its latest task and the verified repo above its working subfolder', async ({ page, bridge }, info) => {
  await pair(page, bridge);
  const row = page.getByTestId('chats-pane').getByRole('button').filter({ hasText: 'Calendar session' });
  const task = row.getByTestId('chat-work-summary');
  await expect(task).toHaveText('Task · fix the week picker layout.');
  await expect(row.getByText('Repo · calendar-repo', { exact: true })).toBeVisible();
  const rowTask = await task.innerText();
  await page.screenshot({ path: info.outputPath('chat-work-summary.png') });
  await row.click();
  const lastMessage = page.getByText('Happy to help.', { exact: true }).filter({ visible: true });
  await expect(lastMessage).toBeVisible();
  expect(rowTask).not.toContain(await lastMessage.innerText());
  expect(bridge.logs()).toContain('pair.claim');
});
