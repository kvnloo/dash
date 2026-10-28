import {test,expect,pair} from './fixtures';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

test.describe('subagent strip',()=>{
 test.use({bridgeOptions:{subagents:true},viewport:{width:390,height:844}});
 test('a Hermes chat with delegated workers shows the subagent strip, newest first, and opens to a tree',async({page,bridge})=>{
  await pair(page,bridge);
  const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY native fixture'});
  await expect(row).toHaveCount(1,{timeout:30000});
  await row.click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();

  // Two live workers count; the ended third does not. The newest activity leads the collapsed line.
  const strip=page.getByRole('button',{name:'2 subagents working',exact:true});
  await expect(strip).toBeVisible({timeout:20000});
  await expect(strip).toContainText('ARMY worker verify · terminal');
  await expect(strip).toContainText('+1');
  // The ended worker is absent from the chat (strip and tree). The Orchestra page keeps recent
  // history on purpose and must show it as a finished subagent of this chat, never as a chat.
  const chat=page.getByTestId('chat-window');
  await expect(chat.getByText('ARMY worker done')).toHaveCount(0);
  const box=await strip.boundingBox();
  if(!box)throw Error('strip has no box');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x+box.width).toBeLessThanOrEqual(390);

  await strip.click({noWaitAfter:true});
  await expect(page.getByRole('treeitem',{name:/ARMY worker verify/})).toBeVisible();
  await expect(page.getByRole('treeitem',{name:/ARMY worker review/})).toBeVisible();
  await expect(chat.getByText('ARMY worker done')).toHaveCount(0);
  // Orchestra: all three workers count as subagents (one live), and only the two real chats as chats.
  await expect(page.getByText('subagent 3 · 1 live',{exact:true})).toHaveCount(1);
  await expect(page.getByText('chat 2 · 1 live',{exact:true})).toHaveCount(1);
  await strip.click({noWaitAfter:true});
  await expect(page.getByRole('treeitem',{name:/ARMY worker verify/})).toHaveCount(0);
 });
});
