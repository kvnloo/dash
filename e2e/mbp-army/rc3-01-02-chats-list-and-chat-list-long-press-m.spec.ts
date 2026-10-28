// RC3 tester army, area 02: Chats list and chat-list long-press menu.
// App + bridge under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc).
// Real Expo web UI -> isolated real bridge -> fixture ACP agent. Index rows come from
// fixture-native Hermes state.db / AgentsView sessions.db written into the isolated HOME
// (rc3-chat-index-seed.ts) and indexed by the real bridge on boot. No route mocks.
import {test,expect,pair,openChat,composer,chatRow,web,type Bridge,bun} from './fixtures';
import type {Page,Locator,CDPSession} from 'playwright/test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {SeedSpec,HermesSeed} from './rc3-chat-index-seed';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const bunBin=bun;
// The app style is rgba(215,185,134,.035); Chromium serializes that alpha as 0.04 in getComputedStyle.
const ACTIVE_TINT='rgba(215, 185, 134, 0.04)';
const SHEET_TIMEOUT=6000; // #415 sheet: fail fast and report, do not hang the run.

// ---------- bridge-side fixture data ----------
async function reseed(bridge:Bridge,spec:SeedSpec,expectTitles:string[]=[]){
 await bridge.stop();
 const specPath=join(bridge.dir,'army-index-seed.json');
 await writeFile(specPath,JSON.stringify(spec));
 const child=spawn(bunBin,[join(__dirname,'rc3-chat-index-seed.ts'),bridge.dir,specPath],{stdio:['ignore','pipe','pipe']});
 let err='';child.stderr?.on('data',d=>err+=d);
 const [code]=await once(child,'exit');if(code!==0)throw Error('chat-index seed failed: '+err);
 await bridge.start();
 if(expectTitles.length)await waitIndexed(bridge,expectTitles);
}
/** The real bridge GET /chats lists every seeded title (or the absence of one) before the UI is asserted. */
async function waitIndexed(bridge:Bridge,titles:string[],absent:string[]=[]){
 await expect.poll(async()=>{
  try{
   const token=(await readFile(join(bridge.dir,'.dash/token'),'utf8')).trim();
   const res=await fetch(`http://127.0.0.1:${bridge.port}/chats?limit=200`,{headers:{Authorization:`Bearer ${token}`}});
   const text=await res.text();
   return titles.every(t=>text.includes(t))&&absent.every(t=>!text.includes(t));
  }catch{return false;}
 },{timeout:45000,message:'real bridge chat index must serve the seeded rows'}).toBe(true);
}
function hermesRows(prefix:string,count:number,startMs:number,stepMs=1000,extra:Partial<HermesSeed>={}):HermesSeed[]{
 return Array.from({length:count},(_,i)=>{const n=String(i+1).padStart(2,'0');return {id:`army-${prefix.replace(/\W+/g,'-').toLowerCase()}-${n}`,title:`${prefix} ${n}`,cwd:`/srv/army/projects/${prefix.replace(/\W+/g,'-').toLowerCase()}-${n}`,activityMs:startMs-i*stepMs,...extra};});
}
/** Kill the fixture-only discoverable OMP holder of this bridge (comm "omp", this HOME's agent dir). */
async function killOmpHolder(bridge:Bridge):Promise<number>{
 const want='PI_CODING_AGENT_DIR='+join(bridge.dir,'.omp','agent');let killed=0;
 for(const pid of await readdir('/proc')){
  if(!/^\d+$/.test(pid))continue;
  try{
   if((await readFile(`/proc/${pid}/comm`,'utf8')).trim()!=='omp')continue;
   if(!(await readFile(`/proc/${pid}/environ`,'utf8')).split('\0').includes(want))continue;
   process.kill(Number(pid),'SIGTERM');killed++;
  }catch{/* raced exit or foreign process */}
 }
 return killed;
}

// ---------- UI helpers (role/testID selectors from RC3 source) ----------
const pane=(page:Page)=>page.getByTestId('chats-pane');
const rows=(page:Page)=>pane(page).locator('[data-testid^="chat-row-"]');
const rowByTitle=(page:Page,title:string)=>rows(page).filter({has:page.getByText(title,{exact:true})});
async function selectChats(page:Page){
 await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');
 await expect(pane(page)).toBeVisible();
}
/** RN Pressable long press (delayLongPress 350 ms) with a real pointer hold. */
async function longPress(page:Page,target:Locator){
 await target.scrollIntoViewIfNeeded();
 const box=await target.boundingBox();if(!box)throw Error('long-press target has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();await page.waitForTimeout(900);await page.mouse.up();
}
/** confirmDestructive on web is window.confirm(`${title}\n\n${message}`). */
function answerNextDialog(page:Page,accept:boolean):Promise<string>{
 return new Promise(resolve=>page.once('dialog',async d=>{const m=d.message();if(accept)await d.accept();else await d.dismiss();resolve(m);}));
}
async function setInAppFeedback(page:Page,on:boolean){
 await page.getByRole('button',{name:'Open settings',exact:true}).first().click({noWaitAfter:true});
 const sw=page.getByRole('switch',{name:'In-app feedback',exact:true});
 await expect(sw).toBeVisible();
 // Spec fix: RN Web 0.21 does not map accessibilityState.checked to aria-checked; assert the rendered On/Off.
 if(((await sw.innerText()).includes('On'))!==on)await sw.click({noWaitAfter:true});
 await expect(sw).toContainText(on?'On':'Off');
 await page.getByRole('button',{name:'Back',exact:true}).first().click({noWaitAfter:true});
 await selectChats(page);
}
/** SkeletonRow on web: a text-free 72 px row holding a 28 px orb and two bars (no a11y attrs survive RN web). */
function skeletonCount(page:Page):Promise<number>{
 return pane(page).evaluate(root=>Array.from(root.querySelectorAll('div')).filter(d=>{
  const r=d.getBoundingClientRect();if(Math.round(r.height)!==72||r.width===0||(d.textContent??'').trim()!==''||d.querySelector('[role],[data-testid]'))return false;
  const orb=d.firstElementChild;if(!orb||d.children.length!==2)return false;
  const o=orb.getBoundingClientRect();return Math.round(o.width)===28&&Math.round(o.height)===28;
 }).length);
}
async function scrollChatsToEnd(page:Page){
 const box=await pane(page).boundingBox();if(!box)throw Error('chats pane has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 for(let i=0;i<6;i++)await page.mouse.wheel(0,5000);
}
async function latency(page:Page,ms:number,cdp?:CDPSession):Promise<CDPSession>{
 const s=cdp??await page.context().newCDPSession(page);
 await s.send('Network.enable');
 await s.send('Network.emulateNetworkConditions',{offline:false,latency:ms,downloadThroughput:-1,uploadThroughput:-1});
 return s;
}
const sheet=(page:Page)=>page.getByTestId('bottom-action-sheet');
/** Spec fix (0e145ec): a long-press only opens the themed row sheet and does nothing else; every action is an explicit choice in it.
 *  Rows are picked by their visible text (the sheet's aria-labels carry a ", N of M" suffix and differ per menu model). */
async function longPressOpensSheet(page:Page,target:Locator){
 await longPress(page,target);
 await expect(sheet(page),'long-press must open the row sheet').toBeVisible({timeout:SHEET_TIMEOUT});
}
async function deleteViaSheet(page:Page,target:Locator){
 await longPressOpensSheet(page,target);
 await sheet(page).getByText('Delete from this phone',{exact:true}).click({noWaitAfter:true});
}
/** Open a remote Hermes row once (it becomes a phone conversation with a session id), then return to Chats. */
async function adoptRemoteRow(page:Page,title:string){
 await rowByTitle(page,title).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await expect(rowByTitle(page,title)).not.toContainText('Not opened yet');
}

// ======================================================================
// Chats list
// ======================================================================
test.describe('RC3 02 Chats list (clean index)',()=>{
 test.use({persistSession:false});

 test('Chats with zero conversations shows No chats yet',async({page,bridge})=>{
  await pair(page,bridge);
  await expect(pane(page).getByText('No chats yet',{exact:true})).toBeVisible({timeout:20000});
  await expect(rows(page)).toHaveCount(0);
 });

 test('remote index loading shows 6 skeleton rows, then rows replace them',async({page,bridge})=>{
  const now=Date.now();const seeded=hermesRows('ARMY skeleton row',3,now-5000);
  await reseed(bridge,{hermes:seeded},seeded.map(r=>r.title));
  await page.goto(web,{waitUntil:'domcontentloaded'});
  await page.getByPlaceholder('100.64.0.1',{exact:true}).waitFor({timeout:120000});
  await page.getByPlaceholder('100.64.0.1',{exact:true}).fill('127.0.0.1:'+bridge.port);
  await page.getByLabel('Bootstrap token',{exact:true}).fill(bridge.bootstrap);
  // Real network latency (CDP emulation) keeps GET /chats in flight; the response is the real bridge's.
  const cdp=await latency(page,3000);
  await page.getByRole('button',{name:'Pair over Tailscale',exact:true}).click({noWaitAfter:true});
  await expect(page.getByRole('tab').nth(1)).toBeVisible({timeout:60000});
  await selectChats(page);
  await expect.poll(()=>skeletonCount(page),{timeout:30000,intervals:[100]}).toBe(6);
  await latency(page,0,cdp);
  for(const r of seeded)await expect(rowByTitle(page,r.title)).toBeVisible({timeout:30000});
  expect(await skeletonCount(page)).toBe(0);
 });

 test('rows are grouped under date headers with row counts',async({page,bridge})=>{
  const now=Date.now();const midnight=new Date(now);midnight.setHours(0,0,0,0);
  const today=hermesRows('ARMY today row',3,now-5000);
  const yesterday=hermesRows('ARMY yesterday row',2,midnight.getTime()-6*3600_000);
  await reseed(bridge,{hermes:[...today,...yesterday]},[...today,...yesterday].map(r=>r.title));
  await pair(page,bridge);
  await expect(rowByTitle(page,'ARMY today row 01')).toBeVisible({timeout:30000});
  const todayHeader=pane(page).getByText('Today',{exact:true});
  await expect(todayHeader).toBeVisible();
  await expect(todayHeader.locator('xpath=..')).toHaveText(/^Today\s*3$/);
  const yHeader=pane(page).getByText('Yesterday',{exact:true});
  await expect(yHeader).toBeVisible();
  await expect(yHeader.locator('xpath=..')).toHaveText(/^Yesterday\s*2$/);
  // Today header sits above its rows, Yesterday below them.
  const [tb,rb,yb]=await Promise.all([todayHeader.boundingBox(),rowByTitle(page,'ARMY today row 03').boundingBox(),yHeader.boundingBox()]);
  expect(tb&&rb&&yb&&tb.y<rb.y&&rb.y<yb.y).toBeTruthy();
 });

 test('row shows title, time, harness/host badge, working folder, activity and preview; foreign row is View only',async({page,bridge})=>{
  const now=Date.now();
  const hermes=[{id:'army-content-row',title:'ARMY content row',cwd:'/srv/army/projects/alpha',activityMs:now-5000,messages:[{role:'user' as const,text:'hi'},{role:'assistant' as const,text:'hello.'}]}];
  const av=[{id:'army-foreign-row',agent:'claude',machine:'army-remote-box',title:'ARMY foreign row',cwd:'/srv/army/projects/beta',endedMs:now-15000}];
  await reseed(bridge,{hermes,agentsview:av},['ARMY content row','ARMY foreign row']);
  await pair(page,bridge);
  const row=rowByTitle(page,'ARMY content row');
  await expect(row).toBeVisible({timeout:30000});
  await expect(row.getByText(/^(now|\d+[mhd])$/)).toBeVisible();
  await expect(row.getByRole('img',{name:/^Hermes · /})).toBeVisible();
  await expect(row.getByText('Folder · alpha',{exact:true})).toBeVisible();
  await expect(row.getByLabel('Working folder: /srv/army/projects/alpha',{exact:true})).toBeVisible();
  await expect(row.getByText('Not opened yet',{exact:true})).toBeVisible();
  await expect(row.getByText(/^\d+ messages? · Hermes$/)).toBeVisible();
  await expect(row.getByLabel('View only',{exact:true})).toHaveCount(0);
  const foreign=rowByTitle(page,'ARMY foreign row');
  await expect(foreign).toBeVisible();
  await expect(foreign.getByLabel('View only',{exact:true})).toBeVisible();
  await expect(foreign.getByText(/· army-remote-box$/)).toBeVisible();
  await expect(foreign.getByLabel('Working folder: /srv/army/projects/beta',{exact:true})).toBeVisible();
 });

 test('tap a remote-only row: it becomes a phone conversation and Chat opens with its history',async({page,bridge})=>{
  const now=Date.now();
  await reseed(bridge,{hermes:[{id:'army-history-session',title:'ARMY history row',cwd:'/srv/army/projects/hist',activityMs:now-5000,
   messages:[{role:'user',text:'ARMY_HISTORY_USER question'},{role:'assistant',text:'ARMY_HISTORY_ASSISTANT answer.'}]}]},['ARMY history row']);
  await pair(page,bridge);
  const row=rowByTitle(page,'ARMY history row');
  await expect(row.getByText('Not opened yet',{exact:true})).toBeVisible({timeout:30000});
  const remoteId=await row.getAttribute('data-testid');
  await row.click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByText(/ARMY_HISTORY_ASSISTANT answer/).filter({visible:true}).first()).toBeVisible({timeout:20000});
  await expect(page.getByText(/ARMY_HISTORY_USER question/).filter({visible:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
  await expect(rowByTitle(page,'ARMY history row')).toHaveCount(1);
  await expect(rowByTitle(page,'ARMY history row')).not.toContainText('Not opened yet');
  await expect(rowByTitle(page,'ARMY history row')).toHaveCSS('background-color',ACTIVE_TINT);
  expect(await rowByTitle(page,'ARMY history row').getAttribute('data-testid')).not.toBe(remoteId);
 });

 test('scroll to bottom loads the next page with 3 footer skeleton rows',async({page,bridge})=>{
  const seeded=hermesRows('ARMY page row',60,Date.now()-5000);
  await reseed(bridge,{hermes:seeded},['ARMY page row 01','ARMY page row 60']);
  await pair(page,bridge);
  await expect(rowByTitle(page,'ARMY page row 01')).toBeVisible({timeout:30000});
  await expect(rowByTitle(page,'ARMY page row 60')).toHaveCount(0);
  const cdp=await latency(page,3000);
  await scrollChatsToEnd(page);
  await expect.poll(()=>skeletonCount(page),{timeout:15000,intervals:[100]}).toBe(3);
  await latency(page,0,cdp);
  await expect.poll(async()=>{await scrollChatsToEnd(page);return rowByTitle(page,'ARMY page row 60').count();},{timeout:30000}).toBe(1);
  await expect(rowByTitle(page,'ARMY page row 60')).toBeVisible();
  expect(await skeletonCount(page)).toBe(0);
 });

 test('remote index error shows "<error> · Retry" in the footer and Retry reloads',async({page,bridge})=>{
  const seeded=hermesRows('ARMY retry row',60,Date.now()-5000);
  await reseed(bridge,{hermes:seeded},['ARMY retry row 01','ARMY retry row 60']);
  await pair(page,bridge);
  await expect(rowByTitle(page,'ARMY retry row 01')).toBeVisible({timeout:30000});
  await bridge.stop();
  await scrollChatsToEnd(page);
  const retry=pane(page).getByRole('button',{name:/· Retry$/});
  await expect.poll(async()=>{await scrollChatsToEnd(page);return retry.count();},{timeout:20000}).toBe(1);
  await expect(retry).toHaveText("Can't reach the bridge. · Retry");
  await bridge.start();
  await retry.click({noWaitAfter:true});
  await expect.poll(async()=>{await scrollChatsToEnd(page);return rowByTitle(page,'ARMY retry row 60').count();},{timeout:30000}).toBe(1);
  await expect(retry).toHaveCount(0);
 });

 test('long-press with In-app feedback Off confirms Delete chat?; Cancel keeps, Delete removes from phone only and the index row comes back',async({page,bridge})=>{
  await reseed(bridge,{hermes:[{id:'army-delete-session',title:'ARMY delete row',cwd:'/srv/army/projects/del',activityMs:Date.now()-5000,messages:[{role:'user',text:'u'},{role:'assistant',text:'a.'}]}]},['ARMY delete row']);
  await pair(page,bridge);
  await expect(rowByTitle(page,'ARMY delete row')).toBeVisible({timeout:30000});
  await adoptRemoteRow(page,'ARMY delete row');
  await setInAppFeedback(page,false);
  const localId=await rowByTitle(page,'ARMY delete row').getAttribute('data-testid');
  // Long-press opens the row sheet; choosing Delete from this phone asks first (native confirm on web).
  let dialog=answerNextDialog(page,false);
  await deleteViaSheet(page,rowByTitle(page,'ARMY delete row'));
  expect(await dialog).toBe('Delete chat?\n\nThis removes it from this phone only.');
  await expect(page.getByTestId(localId??'missing')).toHaveCount(1);
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  dialog=answerNextDialog(page,true);
  await deleteViaSheet(page,rowByTitle(page,'ARMY delete row'));
  expect(await dialog).toBe('Delete chat?\n\nThis removes it from this phone only.');
  await expect(page.getByTestId(localId??'missing')).toHaveCount(0);
  // Phone-local delete only: the host's index row is listed again as not opened.
  await expect(rowByTitle(page,'ARMY delete row')).toHaveCount(1,{timeout:20000});
  await expect(rowByTitle(page,'ARMY delete row').getByText('Not opened yet',{exact:true})).toBeVisible();
  await waitIndexed(bridge,['ARMY delete row']);
 });
});

test.describe('RC3 02 Chats list (live fixture session)',()=>{
 test('host-running session row shows the gold live dot and Live on host label',async({page,bridge})=>{
  await pair(page,bridge);
  const live=pane(page).getByLabel('Live on host',{exact:true});
  await expect(live.first()).toBeVisible({timeout:30000});
  await expect(live.first()).toHaveCSS('background-color',/^rgb/);
  const box=await live.first().boundingBox();
  expect(box&&Math.round(box.width)===4&&Math.round(box.height)===4).toBeTruthy();
 });

 test('tap a local chat row: row gets the active tint and the Chat window opens',async({page,bridge})=>{
  await openChat(page,bridge);
  await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await expect(chatRow(page)).toHaveCSS('background-color',ACTIVE_TINT);
  await chatRow(page).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(composer(page)).toBeVisible();
 });

 test('ended chats: Clear ended confirm; Cancel keeps rows, Clear ended removes them',async({page,bridge})=>{
  await pair(page,bridge);
  const liveRow=rows(page).filter({has:page.getByLabel('Live on host',{exact:true})}).first();
  await expect(liveRow).toBeVisible({timeout:30000});
  // Spec fix: a never-opened live row is a host-index row (chats.v1 prunes never-opened adopted rows), not a phone
  // conversation, so it can never read "ended". Open it once so it is a phone conversation, then return to Chats.
  await liveRow.click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await expect(liveRow).toHaveAttribute('data-testid',/^chat-row-live:omp:/);
  const id=await liveRow.getAttribute('data-testid');if(!id)throw Error('live row id missing');
  const clear=pane(page).getByRole('button',{name:'Clear ended',exact:true});
  await expect(clear).toHaveCount(0);
  expect(await killOmpHolder(bridge)).toBeGreaterThan(0);
  await expect(page.getByTestId(id).getByText('ended',{exact:true})).toBeVisible({timeout:45000});
  await expect(clear).toBeVisible();
  let dialog=answerNextDialog(page,false);
  await clear.click({noWaitAfter:true});
  expect(await dialog).toBe('Clear ended chats?\n\nSaved history is removed from this phone only.');
  await expect(page.getByTestId(id)).toHaveCount(1);
  await expect(clear).toBeVisible();
  dialog=answerNextDialog(page,true);
  await clear.click({noWaitAfter:true});
  await dialog;
  await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(clear).toHaveCount(0);
 });

 test('long-press with In-app feedback On submits "Selected chat <title>" and navigates to Chat',async({page,bridge})=>{
  await openChat(page,bridge);
  await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
  await setInAppFeedback(page,true);
  // Spec fix (0e145ec): long-press only opens the row sheet and sends nothing; feedback is sent by choosing its row.
  await longPressOpensSheet(page,chatRow(page));
  await expect(page.getByText(/Selected chat New chat/).filter({visible:true})).toHaveCount(0);
  await sheet(page).getByText(/^Send feedback/).click({noWaitAfter:true});
  await expect(page.getByTestId('composer-field')).toBeVisible();
  await expect(page.getByText(/Selected chat New chat/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 });

 test('long-press with In-app feedback Off deletes a phone-only New chat row after confirm',async({page,bridge})=>{
  await openChat(page,bridge);
  await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
  await setInAppFeedback(page,false);
  const row=chatRow(page);
  const dialog=answerNextDialog(page,true);
  await deleteViaSheet(page,row);
  expect(await dialog).toBe('Delete chat?\n\nThis removes it from this phone only.');
  await expect(row).toHaveCount(0);
 });
});

// ======================================================================
// RC3 #415 chat-row long-press menu (BottomActionSheet). At 2c948dc ChatsPane wires long-press
// through rowLongPress and nothing imports chatRowMenu/BottomActionSheet: expected to FAIL here.
// ======================================================================
test.describe('RC3 #415 chat-row long-press bottom action sheet',()=>{
 test.use({persistSession:false});
 const TITLE='ARMY menu row';
 const SESSION='army-menu-session';
 async function prepared(page:Page,bridge:Bridge,feedback:boolean){
  await reseed(bridge,{hermes:[{id:SESSION,title:TITLE,cwd:'/srv/army/projects/menu',activityMs:Date.now()-5000,messages:[{role:'user',text:'u'},{role:'assistant',text:'a.'}]},
   {id:'army-menu-other',title:'ARMY menu other',cwd:'/srv/army/projects/other',activityMs:Date.now()-9000}]},[TITLE,'ARMY menu other']);
  await pair(page,bridge);
  await expect(rowByTitle(page,TITLE)).toBeVisible({timeout:30000});
  await adoptRemoteRow(page,TITLE);
  await setInAppFeedback(page,feedback);
 }
 async function openMenu(page:Page,title=TITLE){
  await longPress(page,rowByTitle(page,title));
  await expect(sheet(page),'#415 long-press must open the themed bottom action sheet').toBeVisible({timeout:SHEET_TIMEOUT});
 }
 // BottomActionSheet appends ", <position> of <total>" to every option's aria-label (sheetA11y), so match the label then that suffix.
 const option=(page:Page,label:string)=>sheet(page).getByRole('button',{name:new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+', \\d+ of \\d+$')});

 test('sheet shows chat title and Open, Open as window, Copy session id, Send feedback, Delete from this phone',async({page,bridge})=>{
  await prepared(page,bridge,true);
  await openMenu(page);
  await expect(sheet(page).getByRole('heading',{name:TITLE,exact:true})).toBeVisible();
  const labels=[`Open chat: ${TITLE}`,`Open chat as window: ${TITLE}`,`Copy session id for chat: ${TITLE}`,`Send feedback about chat: ${TITLE}`,`Delete chat from this phone: ${TITLE}`];
  for(const [i,l] of labels.entries())await expect(sheet(page).getByRole('button',{name:`${l}, ${i+1} of ${labels.length}`,exact:true})).toBeVisible();
  await expect(sheet(page).getByText('Open',{exact:true})).toBeVisible();
  await expect(sheet(page).getByText('Open as window',{exact:true})).toBeVisible();
  await expect(sheet(page).getByText('Copy session id',{exact:true})).toBeVisible();
  await expect(sheet(page).getByText('Send feedback',{exact:true})).toBeVisible();
  await expect(sheet(page).getByText('Delete from this phone',{exact:true})).toBeVisible();
  await expect(page.getByTestId('bottom-action-sheet-option-delete-local')).toBeVisible();
 });

 test('Send feedback hidden with feedback Off; Copy session id hidden for a row without a session',async({page,bridge})=>{
  await prepared(page,bridge,false);
  await openMenu(page,'ARMY menu other');
  await expect(option(page,'Send feedback about chat: ARMY menu other')).toHaveCount(0);
  await expect(option(page,'Open chat: ARMY menu other')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  // New chat before any prompt has no session id.
  await page.getByRole('button',{name:'Create new chat',exact:true}).first().click({noWaitAfter:true});
  await expect(composer(page)).toBeVisible();
  await page.getByRole('button',{name:'Back',exact:true}).click({noWaitAfter:true});
  await openMenu(page,'New chat');
  await expect(option(page,'Copy session id for chat: New chat')).toHaveCount(0);
  await expect(option(page,'Delete chat from this phone: New chat')).toBeVisible();
 });

 test('menu Open opens the chat like a tap',async({page,bridge})=>{
  await prepared(page,bridge,false);
  await openMenu(page);
  await option(page,`Open chat: ${TITLE}`).click({noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
 });

 test('menu Open as window opens the chat windowed',async({page,bridge})=>{
  await prepared(page,bridge,false);
  await openMenu(page);
  await option(page,`Open chat as window: ${TITLE}`).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
 });

 test('menu Copy session id puts the session id on the clipboard',async({page,bridge,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:web});
  await prepared(page,bridge,false);
  await openMenu(page);
  await option(page,`Copy session id for chat: ${TITLE}`).click({noWaitAfter:true});
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain(SESSION);
 });

 test('menu Delete from this phone asks Delete chat? and Cancel keeps the row',async({page,bridge})=>{
  await prepared(page,bridge,false);
  const id=await rowByTitle(page,TITLE).getAttribute('data-testid');
  await openMenu(page);
  const dialog=answerNextDialog(page,false);
  await option(page,`Delete chat from this phone: ${TITLE}`).click({noWaitAfter:true});
  expect(await dialog).toBe('Delete chat?\n\nThis removes it from this phone only.');
  await expect(page.getByTestId(id??'missing')).toHaveCount(1);
 });

 test('Close actions backdrop and Escape close the sheet with no action',async({page,bridge})=>{
  await prepared(page,bridge,false);
  let dialogs=0;page.on('dialog',d=>{dialogs++;void d.dismiss();});
  await openMenu(page);
  await page.getByTestId('bottom-action-sheet-backdrop').click({position:{x:10,y:10},noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
  await openMenu(page);
  await page.getByRole('button',{name:'Close actions',exact:true}).click({noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
  await openMenu(page);
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await expect(rowByTitle(page,TITLE)).toHaveCount(1);
  expect(dialogs).toBe(0);
 });

 test('a row that disappears while the menu is open invalidates the selection',async({page,bridge})=>{
  await prepared(page,bridge,false);
  let dialogs=0;page.on('dialog',d=>{dialogs++;void d.dismiss();});
  await openMenu(page,'ARMY menu other');
  // Host hides the remote-only row; the real bridge drops it from the index on reboot reconcile.
  await reseed(bridge,{hermes:[{id:'army-menu-other',title:'ARMY menu other',activityMs:Date.now()-9000,hidden:true}]});
  await waitIndexed(bridge,[TITLE],['ARMY menu other']);
  await expect(rowByTitle(page,'ARMY menu other')).toHaveCount(0,{timeout:45000});
  await option(page,'Delete chat from this phone: ARMY menu other').click({noWaitAfter:true});
  await page.waitForTimeout(500);
  expect(dialogs).toBe(0);
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await expect(rowByTitle(page,TITLE)).toHaveCount(1);
 });
});
