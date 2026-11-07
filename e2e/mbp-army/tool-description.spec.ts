import {test,expect,openChat,send} from './fixtures';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

// Logical phone widths, not physical screenshot pixels; no native/DPR acceptance claim.
for (const width of [360,480]) {
 test.describe(`tool descriptions at ${width}`,()=>{
  test.use({viewport:{width,height:780}});
  test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

  test('tool rows describe a write with capped arguments and open its retained details',async({page,bridge})=>{
   await openChat(page,bridge);
   await send(page,'ARMY_TOOL_DETAIL save release notes');
   await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
   const row=page.getByTestId('reply-tool-row');
   // Before #514's fix this says "Write · write_file": parsing capped JSON loses the path.
   await expect(row).toContainText('Write');
   await expect(row).toContainText('/project/release-notes.md');
   await expect(row).toHaveAccessibleName(/Write, \/project\/release-notes\.md, completed/);
   const bounds=await row.boundingBox();
   if(!bounds)throw Error('tool row has no bounds');
   expect(bounds.width).toBeLessThanOrEqual(width);
   expect(bounds.height).toBeLessThanOrEqual(40);
   await row.click({noWaitAfter:true});
   await expect(page.getByText('ARMY_WRITE_RESULT: release notes saved',{exact:true})).toBeVisible();
   // Details are still fetched over the authenticated bridge after the turn ends.
   await page.getByRole('button',{name:'Load retained output (up to 1 MiB)',exact:true}).last().click({noWaitAfter:true});
   await expect(page.getByText('write_file · /project/release-notes.md',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Arguments',exact:true}).click({noWaitAfter:true});
   await expect(page.getByText('"content":',{exact:false}).first()).toBeVisible();
   await page.getByRole('button',{name:'Output',exact:true}).click({noWaitAfter:true});
   await expect(page.getByText('ARMY_WRITE_RESULT: release notes saved',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Close tool details',exact:true}).click({noWaitAfter:true});
   await expect(row).toContainText('/project/release-notes.md');
   // The prompt reached the isolated ACP process, rather than a seeded transcript.
   expect(await readFile(join(bridge.dir,'army-acp-turns.jsonl'),'utf8')).toContain('ARMY_TOOL_DETAIL save release notes');
  });
 });
}
