import { test, expect, pair, openChat, composer, send } from './fixtures';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Reported physical resolutions at an assumed DPR of 3. Web evidence is not native acceptance.
const phones = [
  { name: 'S25 Ultra', width: 480, height: 1040 },
  { name: 'S22+', width: 360, height: 780 },
];

for (const phone of phones) {
  for (const mode of ['windowed', 'fullscreen']) {
    test(`one working indicator in ${mode} chat at ${phone.name} size`, async ({ page, bridge }, info) => {
      await page.setViewportSize({ width: phone.width, height: phone.height });
      if (mode === 'windowed') {
        await openChat(page, bridge);
      } else {
        await pair(page, bridge);
        await page.getByRole('button', { name: /^(Create new chat|New chat)$/ }).first().click({ noWaitAfter: true });
        await expect(composer(page)).toBeVisible();
        await expect(page.getByTestId('chat-window')).toHaveCount(0);
      }

      const prompt = `ARMY_HOLD single indicator ${mode} ${phone.name}`;
      await send(page, prompt);
      const transcript = page.getByTestId('transcript-viewport');
      await expect(transcript.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
      // Keep the informative inline row, not just zero indicators everywhere.
      await expect(transcript.getByTestId('agent-orb')).toHaveCount(1);
      await expect(transcript.getByTestId('agent-orb')).toBeVisible();
      for (const prefix of ['chat-window', 'chat-fullscreen']) {
        const pill = page.getByTestId(`${prefix}-pill`);
        await expect(page.getByTestId(`${prefix}-pill-status`)).toHaveCount(0);
        if (await pill.count()) {
          await expect(pill).not.toHaveAttribute('aria-label', /working|running tool/i);
          // The pill's orb is identity, not a second live activity orb.
          await expect(pill.getByTestId('agent-orb')).toHaveCSS('opacity', '0.55');
        }
      }
      await page.screenshot({ path: info.outputPath('single-working-indicator.png') });

      const turns = await readFile(join(bridge.dir, 'army-acp-turns.jsonl'), 'utf8');
      expect(turns).toContain(prompt);
      await writeFile(join(bridge.dir, 'army-release'), 'release');
      await expect(transcript.getByText(/ARMY_REPLY:/).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
      await expect(transcript.getByTestId('agent-orb')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('completed.png') });
    });
  }
}
