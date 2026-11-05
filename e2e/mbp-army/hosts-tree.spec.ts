import { writeFile } from 'node:fs/promises';
import type { Page } from 'playwright/test';
import { test, expect, pair } from './fixtures';

// Kevin, 2026-11-05: no e2e ever expanded a computer host, so groot's mixed levels
// (profiles, harnesses and loose Hermes chats as siblings) shipped unseen.
test.use({bridgeOptions:{rosterHost:'groot',finishedSessions:true}});

/** Ids of rendered tree rows exactly one level below `parent`, read from the DOM the user sees. */
const childRows = (page: Page, parent: string) => page.locator('[data-testid^="tree-row-"]').evaluateAll((rows, parentId) => {
 const out: string[] = []; let level = -1;
 for (const row of rows) {
  const id = (row.getAttribute('data-testid') ?? '').replace(/^tree-row-/, ''); const at = Number(row.getAttribute('aria-level'));
  if (level < 0) { if (id === parentId) level = at; continue; }
  if (at <= level) break;
  if (at === level + 1) out.push(id);
 }
 return out;
}, parent);

test('expanding a computer host shows harnesses, then Hermes profiles, then chats, one kind per level', async ({page,bridge},info) => {
 await pair(page,bridge);
 await page.getByRole('tab',{name:'Hosts',exact:true}).click({noWaitAfter:true});
 const host=page.getByTestId('tree-row-host:groot');
 await expect(host).toBeVisible({timeout:20000});
 await host.click({noWaitAfter:true});
 await expect(host).toHaveAttribute('aria-expanded','true');
 await expect.poll(() => childRows(page,'host:groot'),{timeout:20000}).toEqual(expect.arrayContaining(['groot:harness:hermes','groot:harness:codex','groot:harness:claude']));
 // Level 2 holds harnesses only: no bot/profile and no chat beside them.
 expect((await childRows(page,'host:groot')).filter(id => !id.startsWith('groot:harness:'))).toEqual([]);
 await expect(page.getByTestId('tree-row-groot:harness:hermes')).toContainText('Hermes');
 await expect(page.getByTestId('tree-row-groot:harness:claude')).toContainText('Claude Code');

 await page.getByTestId('tree-row-groot:harness:hermes').click({noWaitAfter:true});
 await expect.poll(() => childRows(page,'groot:harness:hermes'),{timeout:20000}).not.toEqual([]);
 const underHermes=await childRows(page,'groot:harness:hermes');
 // Under Hermes: profiles, plus at most a New chat entry; never a raw chat row beside a profile.
 expect(underHermes.some(id => id.startsWith('groot:hermes:profile:'))).toBe(true);
 expect(underHermes.filter(id => id.startsWith('groot:session:'))).toEqual([]);

 await page.getByTestId('tree-row-groot:harness:codex').click({noWaitAfter:true});
 // The finished native Codex chat is a direct child of the Codex harness, not of the host.
 const codexChat=page.locator('[data-testid^="tree-row-groot:"]').filter({hasText:'ARMY finished Codex native chat'});
 await expect(codexChat).toHaveCount(1,{timeout:20000});
 const chatId=(await codexChat.getAttribute('data-testid'))!.replace(/^tree-row-/,'');
 expect(await childRows(page,'groot:harness:codex')).toContain(chatId);
 expect(await childRows(page,'host:groot')).not.toContain(chatId);

 const dump=await page.locator('[data-testid^="tree-row-"]').evaluateAll(rows => rows.map(row => `${'  '.repeat(Math.max(0,Number(row.getAttribute('aria-level'))-1))}${row.getAttribute('data-testid')} | ${(row.textContent??'').trim()}`));
 await writeFile(info.outputPath('hosts-tree.txt'),dump.join('\n')+'\n');
 await page.screenshot({path:info.outputPath('hosts-tree.png')});
});
