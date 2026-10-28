// RC3 area 01: navigation shell, top nav (AppNav/GelNav), workspace header, connection banner,
// bridge pull-down sheet and the Main global search bar.
// Same isolated fixtures as army.spec.ts: real web export, real isolated bridge, scripted ACP agent.
// Selectors come from kvnloo/dash integ/rc3-20261027 (written against 2c948dc) (GelNav.tsx, BridgePull.tsx,
// WorkspaceHeader.tsx, ConnectionPill.tsx, GesturePager.tsx, MainScreen.tsx, GlobalSearchBar.tsx).
import {test,expect,web,type Bridge,bun} from './fixtures';
import type {Page} from 'playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const tab=(page:Page,name:'Hosts'|'Chats'|'Orchestra')=>page.getByRole('tab',{name,exact:true});
const btn=(page:Page,name:string|RegExp)=>page.getByRole('button',typeof name==='string'?{name,exact:true}:{name});
const heading=(page:Page,name:string)=>page.getByRole('heading',{name,exact:true});
const search=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
const chatComposer=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Pair the real web export with the isolated bridge and stop on Main WITHOUT choosing a tab. */
async function pairCold(page:Page,b:Bridge){
 await page.goto(web,{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('100.64.0.1',{exact:true}).waitFor({timeout:120000});
 await page.getByPlaceholder('100.64.0.1',{exact:true}).fill('127.0.0.1:'+b.port);
 await page.getByLabel('Bootstrap token',{exact:true}).fill(b.bootstrap);
 await btn(page,'Pair over Tailscale').click({noWaitAfter:true});
 await expect(tab(page,'Orchestra')).toBeVisible({timeout:25000});
}
async function toChats(page:Page){
 await tab(page,'Chats').click({noWaitAfter:true});
 await expect(tab(page,'Chats')).toHaveAttribute('aria-selected','true');
 await expect(page.getByTestId('chats-pane')).toBeVisible();
}
/** Gold pill offset in slots: GelNav pillStyle translates the pill track by progress*NAV_SLOT_WIDTH. */
async function pillSlots(page:Page){
 const slot=(await tab(page,'Hosts').boundingBox())?.width;if(!slot)throw Error('nav tab has no box');
 const x=await page.getByLabel('Primary mobile workspace',{exact:true}).first().evaluate(el=>{const pill=el.firstElementChild;if(!pill)throw Error('gold pill missing');const t=getComputedStyle(pill).transform;return t&&t!=='none'?new DOMMatrix(t).m41:0;});
 return x/slot;
}
/** Pager progress from the real track transform: GesturePager translates by -progress*pageWidth. */
async function pagerProgress(page:Page){
 return page.getByTestId('main-pager-track').evaluate(el=>{const t=getComputedStyle(el).transform;const x=t&&t!=='none'?new DOMMatrix(t).m41:0;const w=el.parentElement?.getBoundingClientRect().width||1;return -x/w;});
}
/** Largest rotation (degrees) under the Bridge details chevron button. */
async function chevronDeg(page:Page){
 return btn(page,'Bridge details').evaluate(el=>{let best=0;for(const n of Array.from(el.querySelectorAll('*'))){const t=getComputedStyle(n).transform;if(!t||t==='none')continue;const m=new DOMMatrix(t);best=Math.max(best,Math.abs(Math.atan2(m.m12,m.m11)*180/Math.PI));}return best;});
}
async function openSheet(page:Page){
 await btn(page,'Bridge details').click({noWaitAfter:true});
 await expect(btn(page,'Dismiss bridge details')).toBeVisible();
 await expect(btn(page,'Edit bridge')).toBeVisible();
}
/** Fixture-only Hermes rows in the isolated HERMES_HOME (same schema seed-gate.ts creates).
 *  Call only while the bridge is stopped: the chat index ingests Hermes incrementally past a per-profile
 *  high-water mark (hermesIngest), and these rows are older than the fixture row seed-gate wrote, so a live
 *  bridge would only pick them up at its next full reconcile (every 10 min), never within the test. */
function seedHermesSessions(b:Bridge,prefix:string,count:number){
 const script=`const {Database}=await import('bun:sqlite');const db=new Database(process.env.HERMES_HOME+'/state.db');
db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,source TEXT,title TEXT,started_at REAL,last_activity_at REAL,message_count INTEGER,cwd TEXT,archived INTEGER,hidden INTEGER,parent_session_id TEXT,end_reason TEXT,model_config TEXT)');
const q=db.query('INSERT OR REPLACE INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');const now=Date.now()/1000;
for(let i=1;i<=${count};i++){const n=String(i).padStart(2,'0');q.run('army-page-'+n,'acp','${prefix} '+n,now-600+i,now-600+i,0,process.env.DASH_CWD,0,0,null,null,'{}');}db.close();`;
 execFileSync(bun,['-e',script],{env:{...process.env,HERMES_HOME:join(b.dir,'.hermes'),DASH_CWD:b.dir},stdio:'pipe'});
}

/** Stop the bridge, write the fixture rows while it is down, restart it and wait until GET /chats serves them. */
async function reseedHermes(b:Bridge,prefix:string,count:number){
 await b.stop();
 seedHermesSessions(b,prefix,count);
 await b.start();
 const first=prefix+' 01',last=prefix+' '+String(count).padStart(2,'0');
 await expect.poll(async()=>{
  try{
   const token=(await readFile(join(b.dir,'.dash/token'),'utf8')).trim();
   const text=await (await fetch(`http://127.0.0.1:${b.port}/chats?limit=200`,{headers:{Authorization:`Bearer ${token}`}})).text();
   return text.includes(first)&&text.includes(last);
  }catch{return false;}
 },{timeout:45000,message:'real bridge chat index must serve the seeded Hermes rows'}).toBe(true);
}

test.describe('rc3 01 top nav and pager',()=>{
 test('cold start opens Main on Orchestra (tab 2) with Orchestra selected',async({page,bridge})=>{
  await pairCold(page,bridge);
  await expect(tab(page,'Orchestra')).toHaveAttribute('aria-selected','true');
  await expect(tab(page,'Chats')).toHaveAttribute('aria-selected','false');
  await expect(tab(page,'Hosts')).toHaveAttribute('aria-selected','false');
  await expect(page.getByTestId('orchestra-graph')).toBeVisible();
  await expect.poll(()=>pillSlots(page)).toBeCloseTo(2,1);
 });

 test('tap Chats moves the gold pill to the middle dot and renders chats-pane',async({page,bridge})=>{
  await pairCold(page,bridge);await toChats(page);
  await expect(tab(page,'Orchestra')).toHaveAttribute('aria-selected','false');
  await expect.poll(()=>pillSlots(page)).toBeCloseTo(1,1);
  await expect(heading(page,'Chats workspace')).toBeVisible();
 });

 test('tap Hosts then Orchestra switches panes and selection',async({page,bridge})=>{
  await pairCold(page,bridge);
  await tab(page,'Hosts').click({noWaitAfter:true});
  await expect(tab(page,'Hosts')).toHaveAttribute('aria-selected','true');
  await expect(heading(page,'Hosts workspace')).toBeVisible();
  await expect.poll(()=>pillSlots(page)).toBeCloseTo(0,1);
  await expect.poll(()=>pagerProgress(page)).toBeCloseTo(0,1);
  await tab(page,'Orchestra').click({noWaitAfter:true});
  await expect(tab(page,'Orchestra')).toHaveAttribute('aria-selected','true');
  await expect(page.getByTestId('orchestra-graph')).toBeVisible();
  await expect.poll(()=>pillSlots(page)).toBeCloseTo(2,1);
 });

 test('swipe pager Chats to Orchestra: pill tracks the finger 1:1 and settles without a second animation',async({page,bridge})=>{
  await pairCold(page,bridge);await toChats(page);
  await expect.poll(()=>pagerProgress(page)).toBeCloseTo(1,2);
  const box=await page.getByTestId('main-pager').boundingBox();if(!box)throw Error('pager has no box');
  const y=box.y+box.height*0.9,x0=box.x+box.width*0.8;
  await page.mouse.move(x0,y);await page.mouse.down();
  await page.mouse.move(x0-box.width*0.3,y,{steps:10});
  // Mid-drag: one shared value drives both the track and the pill.
  const mid=await pagerProgress(page),pillMid=await pillSlots(page);
  expect(mid).toBeGreaterThan(1.05);expect(mid).toBeLessThan(1.95);
  expect(Math.abs(pillMid-mid)).toBeLessThan(0.03);
  await page.mouse.move(x0-box.width*0.65,y,{steps:10});
  const deep=await pagerProgress(page);expect(Math.abs((await pillSlots(page))-deep)).toBeLessThan(0.03);
  await page.mouse.up();
  // Settle: sample every frame; the pill must approach 2 monotonically and never overshoot or bounce.
  const samples=await page.evaluate(()=>new Promise<number[]>(resolve=>{const out:number[]=[];const pager=document.querySelector('[aria-label="Primary mobile workspace"]');const pill=pager?.firstElementChild;const tabEl=document.querySelector('[role="tab"]');const slot=tabEl?tabEl.getBoundingClientRect().width:1;const t0=performance.now();const tick=()=>{const t=pill?getComputedStyle(pill).transform:'none';out.push(t&&t!=='none'?new DOMMatrix(t).m41/slot:0);if(performance.now()-t0<1500)requestAnimationFrame(tick);else resolve(out);};tick();}));
  for(let i=1;i<samples.length;i++)expect(samples[i]!).toBeGreaterThanOrEqual(samples[i-1]!-0.005);
  expect(Math.max(...samples)).toBeLessThanOrEqual(2.005);
  expect(samples.at(-1)!).toBeCloseTo(2,2);
  await expect(tab(page,'Orchestra')).toHaveAttribute('aria-selected','true');
  await expect(page.getByTestId('orchestra-graph')).toBeVisible();
  await expect.poll(()=>pagerProgress(page)).toBeCloseTo(2,2);
 });

 test('Expand circle opens the Voice screen',async({page,bridge})=>{
  await pairCold(page,bridge);
  await btn(page,'Expand').click({noWaitAfter:true});
  await expect(page.getByRole('heading',{name:/^(Voice|Live call)$/})).toBeVisible();
  await expect(page.getByTestId('voice-caption')).toBeVisible();
 });

 test('S Pen mode pill toggles Normal and Annotate and the annotation overlay',async({page,bridge})=>{
  await pairCold(page,bridge);
  const label=page.getByTestId('spen-mode-label');
  await expect(label).toHaveText('Normal');
  await expect(page.getByTestId('spen-mode-pill')).toHaveAttribute('aria-label','S Pen mode: Normal. Switch to Annotate');
  await page.getByTestId('spen-mode-pill').click({noWaitAfter:true});
  await expect(label).toHaveText('Annotate');
  await expect(page.getByTestId('spen-mode-pill')).toHaveAttribute('aria-label','S Pen mode: Annotate. Switch to Normal');
  await expect(page.getByTestId('annotation-tray')).toBeVisible();
  await expect(page.getByLabel('Annotation mode on',{exact:true})).toHaveCount(1);
  await page.getByTestId('spen-mode-pill').click({noWaitAfter:true});
  await expect(label).toHaveText('Normal');
  await expect(page.getByTestId('annotation-tray')).toHaveCount(0);
  await expect(page.getByLabel('Annotation mode on',{exact:true})).toHaveCount(0);
 });

 test('web: dragging down on the top nav does not attach the pull gesture',async({page,bridge})=>{
  await pairCold(page,bridge);
  const box=await tab(page,'Orchestra').boundingBox();if(!box)throw Error('tab has no box');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2,box.y+260,{steps:12});await page.mouse.up();
  await page.waitForTimeout(600);
  await expect(btn(page,'Dismiss bridge details')).toHaveCount(0);
  expect(await chevronDeg(page)).toBeLessThan(1);
  await expect(tab(page,'Orchestra')).toHaveAttribute('aria-selected','true');
 });
});

test.describe('rc3 01 bridge pull-down sheet',()=>{
 test('chevron opens the sheet rotated 180 degrees; Dismiss closes it',async({page,bridge})=>{
  await pairCold(page,bridge);
  expect(await chevronDeg(page)).toBeLessThan(1);
  await expect(btn(page,'Dismiss bridge details')).toHaveCount(0);
  await openSheet(page);
  await expect.poll(()=>chevronDeg(page)).toBeGreaterThan(179);
  const dim=btn(page,'Dismiss bridge details');const box=await dim.boundingBox();if(!box)throw Error('dim has no box');
  await dim.click({position:{x:box.width/2,y:box.height-24},noWaitAfter:true});
  await expect(btn(page,'Dismiss bridge details')).toHaveCount(0);
  await expect(btn(page,'Edit bridge')).toHaveCount(0);
  await expect.poll(()=>chevronDeg(page)).toBeLessThan(1);
 });

 test('sheet shows connection status, Hosts and every harness on the host',async({page,bridge})=>{
  await pairCold(page,bridge);await openSheet(page);
  const harnessLabel=page.getByText(/^Harnesses on /);await expect(harnessLabel).toBeVisible();
  const host=((await harnessLabel.textContent())??'').replace(/^Harnesses on /,'').trim();
  expect(host.length).toBeGreaterThan(0);expect(host).not.toBe('this host');
  // Online status row is labelled with the connected host name.
  await expect(btn(page,host)).toBeVisible();
  await expect(page.getByText('Hosts',{exact:true})).toBeVisible();
  await expect(page.getByText('this laptop',{exact:true}).filter({visible:true}).first()).toBeVisible();
  await expect(btn(page,'New OMP chat')).toBeVisible();
  await expect(btn(page,'New Hermes chat')).toBeVisible();
  // Every harness chip is exactly one of: available (New X chat) or not installed.
  const chips=page.getByRole('button',{name:/^New .+ chat$|, not installed$/});
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
 });

 test('New <harness> in the sheet creates that harness chat and opens Chat',async({page,bridge})=>{
  await pairCold(page,bridge);await openSheet(page);
  await btn(page,'New Hermes chat').click({noWaitAfter:true});
  await expect(chatComposer(page)).toBeVisible();
  await expect(chatComposer(page)).toHaveAttribute('placeholder',/Hermes/);
  await expect(btn(page,'Dismiss bridge details')).toHaveCount(0);
 });

 test('Edit bridge (paired) opens Settings',async({page,bridge})=>{
  await pairCold(page,bridge);await openSheet(page);
  await expect(btn(page,'Pair')).toHaveCount(0);
  await btn(page,'Edit bridge').click({noWaitAfter:true});
  await expect(heading(page,'Settings')).toBeVisible();
 });
});

test.describe('rc3 01 workspace header',()=>{
 test('Open event trace opens Trace',async({page,bridge})=>{
  await pairCold(page,bridge);await toChats(page);
  await btn(page,'Open event trace').first().click({noWaitAfter:true});
  await expect(heading(page,'Trace')).toBeVisible();
 });

 test('Create new chat opens a full-screen chat for the default harness',async({page,bridge})=>{
  await pairCold(page,bridge);await toChats(page);
  await btn(page,'Create new chat').first().click({noWaitAfter:true});
  await expect(chatComposer(page)).toBeVisible();
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await btn(page,'Back').click({noWaitAfter:true});
  await expect(page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('New chat',{exact:true})})).toHaveCount(1);
 });

 test('Open settings opens Settings',async({page,bridge})=>{
  await pairCold(page,bridge);await toChats(page);
  await btn(page,'Open settings').first().click({noWaitAfter:true});
  await expect(heading(page,'Settings')).toBeVisible();
 });

 test('pending upstream approvals show the labelled action and open Approvals',async({page,bridge})=>{
  await pairCold(page,bridge);await toChats(page);
  const action=btn(page,'Upstream approvals, 1 pending').first();
  await expect(action).toBeVisible();
  await expect(action).toContainText('Approvals');await expect(action).toContainText('1');
  await action.click({noWaitAfter:true});
  await expect(heading(page,'Approvals')).toBeVisible();
  await expect(page.getByText('Dry run · Nothing will be posted',{exact:true})).toBeVisible();
 });

 test('Orchestra workspace header is title-only',async({page,bridge})=>{
  await pairCold(page,bridge);
  await expect(heading(page,'Orchestra workspace')).toBeVisible();
  // The workspace actions (Create new chat, trace, settings...) move into the Orchestra graph dock (OrchestraPane
  // actions={<WorkspaceActions/>}); the header row itself, the title's parent, must hold no button.
  await expect(heading(page,'Orchestra workspace').locator('xpath=..').getByRole('button')).toHaveCount(0);
 });
});

test.describe('rc3 01 connection banner',()=>{
 test('killed bridge shows the banner; Retry reconnects when the bridge is back',async({page,bridge})=>{
  await pairCold(page,bridge);await toChats(page);
  await expect(page.getByTestId('connection-banner')).toHaveCount(0);
  await bridge.stop();
  const banner=page.getByTestId('connection-banner');
  await expect(banner).toBeVisible({timeout:20000});
  const copy=page.getByTestId('connection-banner-copy');
  await expect(copy).toHaveAttribute('aria-label',/^(Bridge unreachable|Connecting to bridge)\. /);
  // Let the automatic backoff grow to its 8 s step so the manual Retry is what reconnects.
  await expect(copy).toHaveAttribute('aria-label',/^Bridge unreachable\. .*Queued drafts kept$/,{timeout:20000});
  await expect(banner.getByText('Bridge unreachable',{exact:true})).toBeVisible();
  await page.waitForTimeout(9000);
  await expect(copy).toHaveAttribute('aria-label',/^Bridge unreachable\. /,{timeout:12000});
  await bridge.start();
  const retry=page.getByTestId('connection-retry');
  await expect(retry).toHaveAttribute('aria-label','Retry bridge connection');
  await retry.click({noWaitAfter:true});
  await expect(banner).toHaveCount(0,{timeout:6000});
  await openSheet(page);
  await expect(page.getByText(/^Harnesses on /)).toBeVisible();
 });
});

test.describe('rc3 01 global search bar',()=>{
 test('Mention inserts @, Voice input opens Voice, Send submits the note into a chat',async({page,bridge})=>{
  await pairCold(page,bridge);
  // #506: the bar names the configured agent (default harness OMP in the fixture); feedback on/off no longer changes the placeholder.
  await expect(search(page)).toHaveAttribute('placeholder','Message OMP');
  await btn(page,'Mention').click({noWaitAfter:true});
  await expect(search(page)).toHaveValue('@');
  await expect(search(page)).toBeFocused();
  await search(page).fill('');
  await btn(page,'Voice input').click({noWaitAfter:true});
  await expect(page.getByRole('heading',{name:/^(Voice|Live call)$/})).toBeVisible();
  await btn(page,'Back').click({noWaitAfter:true});
  await expect(search(page)).toBeVisible();
  await search(page).fill('army global note');
  await expect(btn(page,'Voice input')).toHaveCount(0);
  await btn(page,'Send').click({noWaitAfter:true});
  // Feedback on: Send files the note as a typed feedback turn into the Dash feedback chat and opens Chat
  // (MainScreen onSend -> submitInAppFeedback); the note is the first user message, not a composer draft.
  await expect(chatComposer(page)).toBeVisible();
  await expect(page.getByTestId('transcript-viewport').getByText('army global note',{exact:true})).toBeVisible();
 });

 test('typing a query lists a conversation row; tapping it opens that chat',async({page,bridge})=>{
  await pairCold(page,bridge);
  await search(page).fill('ARMY native');
  await expect(page.getByText('Chats',{exact:true}).filter({visible:true}).first()).toBeVisible();
  const row=btn(page,/^ARMY native fixture,/).first();
  await expect(row).toBeVisible({timeout:30000});
  await expect(btn(page,'See all chats matching “army native”')).toBeVisible();
  await row.click({noWaitAfter:true});
  await expect(chatComposer(page)).toBeVisible();
  await expect(page.getByText('ARMY native fixture').filter({visible:true}).first()).toBeVisible();
 });

 test('harness search row opens that harness chat; skill and plugin scopes answer honestly',async({page,bridge})=>{
  await pairCold(page,bridge);
  // A bare '/harness' is the composer's slash-command trigger (composerTrigger): the bar shows the harness command
  // suggestions instead of the scoped search. The scope search runs once the scope word is followed by a space.
  await search(page).fill('/harness ');
  await expect(page.getByText(/^\/harness · all /)).toBeVisible();
  await expect(btn(page,/^OMP, Harness, Available/)).toBeVisible();
  await search(page).fill('/skill ');
  await expect(page.getByText('The bridge does not report skill inventory yet.',{exact:true})).toBeVisible();
  await search(page).fill('/plugin ');
  await expect(page.getByText('The bridge does not report plugin inventory yet.',{exact:true})).toBeVisible();
  await search(page).fill('/harness hermes');
  const row=btn(page,/^Hermes, Harness, Available/);
  await expect(row).toBeVisible();
  await row.click({noWaitAfter:true});
  await expect(chatComposer(page)).toHaveAttribute('placeholder',/Hermes/);
 });

 test('product search row opens OrchestraDetail for that project',async({page,bridge})=>{
  await pairCold(page,bridge);
  const project=basename(bridge.dir);
  await search(page).fill('@product '+project);
  const row=btn(page,new RegExp('^'+esc(project)+', Product'));
  await expect(row).toBeVisible({timeout:30000});
  await row.click({noWaitAfter:true});
  await expect(heading(page,'Orchestra')).toBeVisible();
  await expect(page.getByText(project).filter({visible:true}).first()).toBeVisible();
 });

 test('bot search row without a chat target is labelled unavailable and does not open a chat',async({page,bridge})=>{
  // Fixture-only Hermes profile with a messaging platform enabled and no running gateway:
  // the bridge reports it as a bot whose agent is not in the roster (no target).
  const profile=join(bridge.dir,'.hermes','profiles','armybot');await mkdir(profile,{recursive:true});
  await writeFile(join(profile,'config.yaml'),'platforms:\n  telegram:\n    enabled: true\n');
  await pairCold(page,bridge);
  await search(page).fill('@bots armybot');
  const row=btn(page,/^armybot, Bot/);
  await expect(row).toBeVisible({timeout:30000});
  await expect(row).toHaveAttribute('aria-label',/Chat unavailable in Dash/);
  await row.click({noWaitAfter:true});
  // RN-web Alert.alert is a no-op, so the '<bot name>' dialog is native-only; the web contract is: no navigation.
  await page.waitForTimeout(800);
  await expect(search(page)).toHaveValue('@bots armybot');
  await expect(tab(page,'Orchestra')).toBeVisible();
 });

 test('chat-scope search loads older matches when scrolled to the end',async({page,bridge})=>{
  await reseedHermes(bridge,'ARMYPAGE',25);
  await pairCold(page,bridge);
  await search(page).fill('@chats armypage');
  await expect(btn(page,/^ARMYPAGE 25,/)).toBeVisible({timeout:45000});
  // First remote page is 20 chats (newest first): ARMYPAGE 01 is not in it yet.
  await expect(btn(page,/^ARMYPAGE 01,/)).toHaveCount(0);
  const first=btn(page,/^ARMYPAGE 25,/);const box=await first.boundingBox();if(!box)throw Error('row has no box');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await expect.poll(async()=>{
   await page.mouse.wheel(0,4000);
   const more=btn(page,'Keep searching older messages');
   if(await more.count())await more.first().click({noWaitAfter:true});
   return btn(page,/^ARMYPAGE 01,/).count();
  },{timeout:30000,intervals:[400,800,1200]}).toBeGreaterThan(0);
  await expect(btn(page,/^ARMYPAGE 01,/)).toBeVisible();
 });
});
