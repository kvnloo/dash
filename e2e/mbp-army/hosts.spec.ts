import { readFile, writeFile } from 'node:fs/promises';
import type { Page } from 'playwright/test';
import { join } from 'node:path';
import { test, expect, pair } from './fixtures';

test.use({bridgeOptions:{phoneHosts:true}});

test('Hosts lists phones without offering harnesses and hides stale unregistered phones', async ({page,bridge},info) => {
 await pair(page,bridge);
 const tab=page.getByRole('tab',{name:'Hosts',exact:true});
 await expect(tab).toBeVisible();
 await expect(page.getByRole('tab',{name:'Bots',exact:true})).toHaveCount(0);
 await tab.click({noWaitAfter:true});
 await expect(tab).toHaveAttribute('aria-selected','true');
 const s25=page.getByTestId('tree-row-host:kevins-s25-ultra');
 const s22=page.getByTestId('tree-row-host:galaxy-s22');
 await expect(s25).toContainText("Kevin's S25 Ultra");
 await expect(s25).toContainText('Phone');
 await expect(s25).toBeVisible();
 await expect(s22).toContainText('Galaxy S22+');
 await expect(s22).toBeVisible();
 await expect(page.getByTestId('tree-row-host:fleet-phone')).toBeVisible();
 await expect(page.getByTestId('tree-row-host:retired-phone')).toHaveCount(0);
 await s25.click({noWaitAfter:true});
 await expect(page.getByTestId('tree-row-kevins-s25-ultra:empty')).toContainText('No harnesses on a phone');
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 // Real bridge discovery evidence, captured before pairing by createBridge.
 const roster: unknown=JSON.parse(await readFile(join(bridge.dir,'fixture-roster.json'),'utf8'));
 expect(roster).toEqual(expect.objectContaining({hosts:expect.arrayContaining([
  expect.objectContaining({id:'kevins-s25-ultra',kind:'phone',online:true,agents:[]}),
  expect.objectContaining({id:'galaxy-s22',kind:'phone',online:false,agents:[],lastSeen:expect.any(String)}),
 ])}));
 expect(bridge.logs()).toContain('pair.claim');
 await page.screenshot({path:info.outputPath('hosts-phones.png')});
});

/** Ids of tree rows exactly one level below `parent`, in the on-screen order the user reads
 * (DOM order differs: expanded children can mount after later siblings). */
const childRows = (page: Page, parent: string) => page.locator('[data-testid^="tree-row-"]').evaluateAll((rows, parentId) => {
 const out: string[] = []; let level = -1;
 const visible = rows.filter(row => row.getBoundingClientRect().height > 0).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
 for (const row of visible) {
  const id = (row.getAttribute('data-testid') ?? '').replace(/^tree-row-/, ''); const at = Number(row.getAttribute('aria-level'));
  if (level < 0) { if (id === parentId) level = at; continue; }
  if (at <= level) break;
  if (at === level + 1) out.push(id);
 }
 return out;
}, parent);

// DA-045 (#638): a computer host expands one kind per level, Host > Harness > Profile > Chat.
// The fixture seeds a named Hermes profile `poteto` (own SessionDB, two chats) beside the default one.
test.describe('computer host tree', () => {
 test.use({bridgeOptions:{rosterHost:'studio',finishedSessions:true,hermesProfiles:['poteto']}});

 test('expanding a computer host shows harnesses, then Hermes profiles, then chats, one kind per level', async ({page,bridge},info) => {
  await pair(page,bridge);
  await page.getByRole('tab',{name:'Hosts',exact:true}).click({noWaitAfter:true});
  const host=page.getByTestId('tree-row-host:studio');
  await expect(host).toBeVisible({timeout:20000});
  await host.click({noWaitAfter:true});
  await expect(host).toHaveAttribute('aria-expanded','true');
  await expect.poll(() => childRows(page,'host:studio'),{timeout:20000}).toEqual(expect.arrayContaining(['studio:harness:hermes','studio:harness:codex','studio:harness:claude']));
  // Level 2 holds harnesses only: no profile and no chat beside them.
  expect((await childRows(page,'host:studio')).filter(id => !id.startsWith('studio:harness:'))).toEqual([]);
  await expect(page.getByTestId('tree-row-studio:harness:hermes')).toContainText('Hermes');
  await expect(page.getByTestId('tree-row-studio:harness:claude')).toContainText('Claude Code');

  // Level 3 under Hermes: one row per profile, never a raw chat beside a profile.
  const hermes=page.getByTestId('tree-row-studio:harness:hermes');
  await hermes.click({noWaitAfter:true});
  await expect(hermes).toHaveAttribute('aria-expanded','true');
  await expect.poll(() => childRows(page,'studio:harness:hermes'),{timeout:20000}).toEqual(expect.arrayContaining(['studio:hermes:profile:poteto','studio:hermes:profile:default']));
  expect((await childRows(page,'studio:harness:hermes')).filter(id => id.startsWith('studio:session:'))).toEqual([]);
  const poteto=page.getByTestId('tree-row-studio:hermes:profile:poteto');
  await expect(poteto).toContainText('poteto');
  await expect(poteto).toContainText('2 chats');

  // Level 4: poteto's own chats, and only them.
  await poteto.click({noWaitAfter:true});
  await expect(poteto).toHaveAttribute('aria-expanded','true');
  const one='studio:session:hermes:session:poteto:army-poteto-one', two='studio:session:hermes:session:poteto:army-poteto-two';
  await expect.poll(() => childRows(page,'studio:hermes:profile:poteto'),{timeout:20000}).toEqual([one,two]);
  await expect(page.getByTestId('tree-row-'+one)).toContainText('ARMY poteto chat one');
  await expect(page.getByTestId('tree-row-'+two)).toContainText('ARMY poteto chat two');
  expect(await childRows(page,'studio:harness:hermes')).not.toContain(one);
  // The default profile's native chat stays under default, not poteto.
  await page.getByTestId('tree-row-studio:hermes:profile:default').click({noWaitAfter:true});
  await expect.poll(() => childRows(page,'studio:hermes:profile:default'),{timeout:20000}).toContain('studio:session:hermes:session:default:army-fixture-session');

  // A non-Hermes harness lists its chats directly (no profile level).
  await page.getByTestId('tree-row-studio:harness:codex').click({noWaitAfter:true});
  const codexChat=page.locator('[data-testid^="tree-row-studio:"]').filter({hasText:'ARMY finished Codex native chat'});
  await expect(codexChat).toHaveCount(1,{timeout:20000});
  const chatId=(await codexChat.getAttribute('data-testid'))!.replace(/^tree-row-/,'');
  expect(await childRows(page,'studio:harness:codex')).toContain(chatId);
  expect(await childRows(page,'host:studio')).not.toContain(chatId);

  const dump=await page.locator('[data-testid^="tree-row-"]').evaluateAll(rows => rows.filter(row => row.getBoundingClientRect().height > 0).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(row => `${'  '.repeat(Math.max(0,Number(row.getAttribute('aria-level'))-1))}${row.getAttribute('data-testid')} | ${(row.textContent??'').trim()}`));
  await writeFile(info.outputPath('hosts-tree.txt'),dump.join('\n')+'\n');
  await page.screenshot({path:info.outputPath('hosts-tree.png')});
 });
});
