import { readFile } from 'node:fs/promises';
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
