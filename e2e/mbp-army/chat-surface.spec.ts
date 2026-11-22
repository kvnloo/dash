import { test, expect, pair } from './fixtures';

test('Hermes surface selection follows the transcript or Live surface', async ({ page, bridge }, info) => {
  await pair(page, bridge);
  await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click();
  await page.getByRole('button', { name: 'Choose harness', exact: true }).click();
  await page.getByRole('button', { name: 'Hermes', exact: true }).click();
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();

  const surfaces = page.getByRole('tablist', { name: 'Chat surface' });
  const chat = surfaces.getByRole('tab', { name: 'Hermes chat' });
  const live = surfaces.getByRole('tab', { name: 'Live surface' });
  const selected = surfaces.getByRole('tab', { selected: true });
  const transcript = page.getByTestId('transcript-viewport');
  await expect(selected).toHaveCount(1);
  await expect(chat).toHaveAttribute('aria-selected', 'true');
  await expect(transcript).toBeVisible();
  await page.screenshot({ path: info.outputPath('hermes-chat.png') });

  await live.click();
  await expect(selected).toHaveCount(1);
  await expect(live).toHaveAttribute('aria-selected', 'true');
  await expect(transcript).toHaveCount(0);
  await expect(page.getByPlaceholder(/Live surface · quick reply|Ask Hermes through the live surface/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('live-surface.png') });

  await live.click();
  await expect(live).toHaveAttribute('aria-selected', 'true');
  await chat.click();
  await expect(selected).toHaveCount(1);
  await expect(chat).toHaveAttribute('aria-selected', 'true');
  await expect(transcript).toBeVisible();
});
