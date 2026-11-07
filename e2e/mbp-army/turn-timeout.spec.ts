import {test,expect,openChat,composer,send} from './fixtures';

test.afterEach(async({page},info)=>{
 if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});
});

test.describe('local ACP absolute ceiling',()=>{
 test.use({bridgeOptions:{env:{DASH_TURN_TIMEOUT_MS:'4000'}}});

 test('local ACP absolute ceiling shows timeout and keeps composer usable',async({page,bridge})=>{
  await openChat(page,bridge);
  await send(page,'ARMY_MS=8000 beyond the absolute ceiling');
  await expect(page.getByText(/ACP turn timed out/i).first()).toBeVisible({timeout:8500});
  await composer(page).fill('after ceiling');
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_REPLY: after ceiling/).first()).toBeVisible({timeout:9000});
 });
});

test.describe('ACP progress refreshes stall',()=>{
 test.use({bridgeOptions:{env:{DASH_ACP_STALL_MS:'3000',DASH_TURN_TIMEOUT_MS:'30000'}}});

 test('ACP progress frames keep the local turn alive until completion',async({page,bridge})=>{
  await openChat(page,bridge);
  await send(page,'ARMY_MS=6000 ARMY_TICK=1000 progressing work');
  await expect(page.getByText(/ARMY_REPLY: ARMY_MS=6000 ARMY_TICK=1000/).first()).toBeVisible({timeout:11000});
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
  await expect(page.getByText(/ACP turn timed out/i)).toHaveCount(0);
 });
});

test.describe('ACP silence expires before its ceiling',()=>{
 test.use({bridgeOptions:{env:{DASH_ACP_STALL_MS:'3000',DASH_TURN_TIMEOUT_MS:'30000'}}});

 test('silent ACP turn stalls promptly and restores the composer',async({page,bridge})=>{
  await openChat(page,bridge);
  const began = performance.now();
  await send(page,'ARMY_HANG no adapter frames after startup');
  await expect(page.getByText(/ACP turn timed out/i).first()).toBeVisible({timeout:5900});
  expect(performance.now()-began).toBeLessThan(6000);
  await composer(page).fill('after stall');
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_REPLY: after stall/).first()).toBeVisible({timeout:9000});
 });
});
