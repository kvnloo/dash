// The prompt rail (quick-scroll minimap) on a long chat, at phone width. Real Expo web UI -> isolated
// real bridge -> a 1000-message chat. A chat opens with its newest 50 rows, and a tool-heavy chat spends
// a dozen rows per prompt, so a rail built from the loaded rows alone shows a handful of bars: the rail
// must stand for the whole chat. The rest of the chat is paged in behind the newest page, and that must
// never move what the owner is reading.
import {test,expect,pair,LONG_CHAT_PROMPTS,LONG_CHAT_TITLE,LONG_HERMES_PROMPTS,LONG_HERMES_TITLE} from './fixtures';
import type {Locator,Page} from 'playwright/test';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const pad=(n:number)=>String(n).padStart(3,'0');
const railOf=(page:Page)=>page.getByLabel('Prompt navigator',{exact:true});
const viewportOf=(page:Page)=>page.getByTestId('transcript-viewport');

/**
 * `newest` must be a row that stays mounted: the latest answer. The newest prompt sits above a latest answer taller than the
 * phone, so the virtualized list only mounts it while rows are still being measured; a locator can miss that instant.
 */
async function openChatByTitle(page:Page,title:string,newest:RegExp){
 const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:title});
 await expect(row).toHaveCount(1,{timeout:30000});
 await row.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await expect(viewportOf(page).getByText(newest).first()).toBeVisible({timeout:30000});
 await expect(railOf(page)).toBeVisible();
}

/** The transcript's scroll offset (distance from the latest message) and its topmost visible ARMY row. */
function reading(viewport:Locator){
 return viewport.evaluate(el=>{
  let scroller:Element|null=null;
  for(const e of [el,...Array.from(el.querySelectorAll('*'))]){const cs=getComputedStyle(e);if((cs.overflowY==='auto'||cs.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+10){scroller=e;break;}}
  const box=el.getBoundingClientRect();const rows:{text:string;top:number}[]=[];
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   const text=node.textContent?.trim();if(!text||!/^ARMY /.test(text))continue;
   const r=node.parentElement?.getBoundingClientRect();
   if(r&&r.height>0&&r.top>=box.top&&r.top<box.bottom)rows.push({text:text.slice(0,48),top:Math.round(r.top-box.top)});
  }
  rows.sort((a,b)=>a.top-b.top);
  return {fromBottom:scroller?Math.round(scroller.scrollHeight-scroller.clientHeight-scroller.scrollTop):Infinity,first:rows[0]??null};
 });
}

type Reading=Awaited<ReturnType<typeof reading>>;

/**
 * Where the reader is once the transcript has stopped moving. A chat that has just opened is still laying
 * its rows out for a moment (they are measured as they are drawn), so the reference is taken once two
 * readings 700 ms apart agree.
 */
async function stableReading(page:Page):Promise<Reading>{
 const viewport=viewportOf(page);
 let previous=await reading(viewport);
 for(let attempt=0;attempt<20;attempt++){
  await page.waitForTimeout(700);
  const now=await reading(viewport);
  if(sameReading(previous,now))return now;
  previous=now;
 }
 throw Error('the transcript never stopped moving');
}

/** The same row at the same place, the same distance from the latest message. */
function sameReading(expected:Reading,now:Reading):boolean{
 return now.first?.text===expected.first?.text&&Math.abs((now.first?.top??0)-(expected.first?.top??0))<=2&&Math.abs(now.fromBottom-expected.fromBottom)<=2;
}
function expectHeld(expected:Reading,now:Reading,message:string){
 expect(now.first?.text,message).toBe(expected.first?.text);
 expect(Math.abs((now.first?.top??0)-(expected.first?.top??0)),message).toBeLessThanOrEqual(2);
 expect(Math.abs(now.fromBottom-expected.fromBottom),message).toBeLessThanOrEqual(2);
}

/** The rail's bars, the rail's box, and the left and right edges of the message text on screen. */
async function railGeometry(page:Page){
 const rail=railOf(page);
 const box=await rail.boundingBox();if(!box)throw Error('Prompt navigator has no box');
 const bars=(await rail.getByTestId('rail-tick').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.top,r.bottom,r.left,r.right];}))).sort((a,b)=>(a[0]??0)-(b[0]??0));
 const text=await viewportOf(page).evaluate(el=>{
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let left=Infinity,right=0;
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   if(!node.textContent?.trim()||node.parentElement?.closest('[aria-label="Prompt navigator"],[aria-label^="Latest"]'))continue;
   const range=document.createRange();range.selectNodeContents(node);
   for(const r of Array.from(range.getClientRects())) if(r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight){left=Math.min(left,r.left);right=Math.max(right,r.right);}
  }
  return {left,right};
 });
 return {box,bars,text};
}

/** The bars cover the rail from top to bottom with no clump and no hole, and stay inside its gutter. */
function expectCoverage({box,bars}:Awaited<ReturnType<typeof railGeometry>>){
 const first=bars[0],last=bars[bars.length-1];if(!first||!last)throw Error('no rail bars');
 expect(first[0]).toBeLessThanOrEqual(box.y+box.height*.08);
 expect(last[1]).toBeGreaterThanOrEqual(box.y+box.height*.92);
 const gaps=bars.slice(1).map((t,i)=>t[0]-(bars[i]?.[0]??0));
 expect(Math.max(...gaps)).toBeLessThanOrEqual(3*box.height/bars.length);
 for(const t of bars){expect(t[2]).toBeGreaterThanOrEqual(box.x-1);expect(t[3]).toBeLessThanOrEqual(box.x+box.width+1);}
}

/** Tap the middle of the rail: Jump lands on the prompt the preview names. Drag to the top edge: prompt 1. Then Latest. */
async function expectTapDragJump(page:Page,prompts:number,label:(n:number)=>string,newest:RegExp){
 const viewport=viewportOf(page);
 const {box}=await railGeometry(page);
 await page.mouse.click(box.x+box.width/2,box.y+box.height*.5);
 const preview=page.getByLabel('Turn preview',{exact:true});
 await expect(preview).toBeVisible();
 const middle=Number(/Prompt (\d+)\//.exec(await preview.innerText())?.[1]);
 expect(middle).toBeGreaterThanOrEqual(Math.floor(prompts*.42));
 expect(middle).toBeLessThanOrEqual(Math.ceil(prompts*.58));
 await expect(preview).toContainText(`/${prompts}`);
 await expect(preview).toContainText(label(middle));
 await page.getByRole('button',{name:'Jump',exact:true}).click({noWaitAfter:true});
 await expect(viewport.getByText(label(middle),{exact:true}).first()).toBeInViewport({timeout:15000});
 await page.getByRole('button',{name:'Close turn preview',exact:true}).click({noWaitAfter:true});

 await page.mouse.move(box.x+box.width/2,box.y+box.height*.9);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y,{steps:12});await page.mouse.up();
 await expect(preview).toContainText(`Prompt 1/${prompts}`);
 await expect(preview).toContainText(label(1));
 await page.getByRole('button',{name:'Jump',exact:true}).click({noWaitAfter:true});
 await expect(viewport.getByText(label(1),{exact:true}).first()).toBeInViewport({timeout:15000});
 await page.getByRole('button',{name:'Close turn preview',exact:true}).click({noWaitAfter:true});
 await page.getByRole('button',{name:'Latest reply',exact:true}).click({noWaitAfter:true});
 await expect(viewport.getByText(newest).first()).toBeInViewport({timeout:15000});
}

const newestClaude=new RegExp(`^ARMY answer ${pad(LONG_CHAT_PROMPTS)} `);
const claudeLabel=(n:number)=>`ARMY prompt ${pad(n)}`;
const olderPages=/\/chats\/history\?.*before=/;
/**
 * Hold every older-page request until `release()`, then answer each after `delayMs`: the test takes its
 * reference of where the reader is before any page lands, and can watch the pages land one by one.
 */
async function holdOlderPages(page:Page,delayMs=0){
 let release=()=>{};
 const released=new Promise<void>(resolve=>{release=resolve;});
 await page.route(olderPages,async route=>{await released;if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));await route.continue();});
 return release;
}

test.describe('prompt rail on a 1000-message Claude Code chat',()=>{
 test.use({bridgeOptions:{longClaude:true},viewport:{width:390,height:844}});

 test('every prompt is on the rail, on the right edge clear of the text, and tap and drag jump to the prompt shown',async({page,bridge},info)=>{
  const release=await holdOlderPages(page);
  await pair(page,bridge);
  await openChatByTitle(page,LONG_CHAT_TITLE,newestClaude);
  const viewport=viewportOf(page);
  const ticks=railOf(page).getByTestId('rail-tick');

  // Only the newest page is loaded: the rail has a handful of bars (the newest page holds about 7 of the
  // 125 prompts) and the reader is at the latest message. Then the rest of the chat is paged in behind it.
  const atOpen=await stableReading(page);
  expect(await ticks.count()).toBeLessThan(LONG_CHAT_PROMPTS/4);
  await expect(viewport.getByText(newestClaude).first()).toBeInViewport();
  release();

  // Every prompt of the chat is a bar on the rail, however much of it the phone had loaded at first.
  await expect.poll(()=>ticks.count(),{timeout:60000,message:'one bar per prompt'}).toBe(LONG_CHAT_PROMPTS);
  const geometry=await railGeometry(page);
  expectCoverage(geometry);

  // Position: the default (right-handed) edge, and no message text on screen reaches into the rail.
  const wide=page.viewportSize()?.width??390;
  expect(geometry.box.x+geometry.box.width).toBeGreaterThanOrEqual(wide-2);
  expect(geometry.box.x).toBeGreaterThan(wide/2);
  expect(geometry.text.right).toBeGreaterThan(0);
  expect(geometry.text.right).toBeLessThanOrEqual(geometry.box.x+1);
  await page.screenshot({path:info.outputPath('rail-long-chat-390.png')});

  // Paging the rest of the chat in behind the newest page left the reader exactly where they were.
  await page.waitForTimeout(1000);
  expectHeld(atOpen,await reading(viewport),'paging the rest of the chat in moved the reader');
  await expect(viewport.getByText(newestClaude).first()).toBeInViewport();

  await expectTapDragJump(page,LONG_CHAT_PROMPTS,claudeLabel,newestClaude);
 });

 test('scrolling up while the rest of the chat is still paging in: the view holds, the rail still ends up whole, and the top of the list goes on',async({page,bridge})=>{
  // Every older page is held until the owner has scrolled up, then answered a page at a time (the phone's latency).
  const release=await holdOlderPages(page,600);
  await pair(page,bridge);
  await openChatByTitle(page,LONG_CHAT_TITLE,newestClaude);
  const viewport=viewportOf(page);
  const ticks=railOf(page).getByTestId('rail-tick');
  const vb=await viewport.boundingBox();if(!vb)throw Error('transcript has no box');
  const start=await stableReading(page);

  // The owner scrolls up 1000 px before any older page has landed.
  await page.mouse.move(vb.x+vb.width/3,vb.y+vb.height/2);
  for(let step=0;step<4;step++){await page.mouse.wheel(0,-250);await page.waitForTimeout(120);}
  const scrolled=await stableReading(page);
  expect(await ticks.count(),'the owner scrolled before the fill finished').toBeLessThan(LONG_CHAT_PROMPTS/4);
  expect(scrolled.fromBottom-start.fromBottom,'the scroll moved what the wheel asked for').toBeGreaterThanOrEqual(950);
  release();

  // The fill carries on behind the reader, and every page that lands leaves what they are reading where it was.
  let samples=0;
  const deadline=Date.now()+60000;
  while(await ticks.count()<LONG_CHAT_PROMPTS){
   expectHeld(scrolled,await reading(viewport),'a page landed under the reader');samples++;
   if(Date.now()>deadline)throw Error('the rail never became whole while the owner was scrolled up');
   await page.waitForTimeout(250);
  }
  expect(samples,'pages landed while the owner was reading').toBeGreaterThan(2);
  await page.waitForTimeout(500);
  expectHeld(scrolled,await reading(viewport),'the last page landed under the reader');

  // Scrolling on to the top of what the list holds lists the next page: the owner can still read the whole chat.
  const numberOf=(text?:string)=>Number(/(\d{3})/.exec(text??'')?.[1]??Infinity);
  const from=numberOf(scrolled.first?.text);
  await expect.poll(async()=>{await page.mouse.wheel(0,-1500);await page.waitForTimeout(150);return numberOf((await reading(viewport)).first?.text);},
   {timeout:60000,message:'scrolling up reaches older prompts'}).toBeLessThan(from-12);
 });

 test('a failed older page is retried, so a network blip does not leave the rail partial',async({page,bridge})=>{
  let refused=0;
  await page.route(olderPages,async route=>{if(refused<2){refused++;await route.abort('failed');return;}await route.continue();});
  await pair(page,bridge);
  await openChatByTitle(page,LONG_CHAT_TITLE,newestClaude);
  await expect.poll(()=>railOf(page).getByTestId('rail-tick').count(),{timeout:60000,message:'one bar per prompt after the blip'}).toBe(LONG_CHAT_PROMPTS);
  expect(refused).toBe(2);
 });
});

test.describe('prompt rail on the left thumb side',()=>{
 test.use({bridgeOptions:{longClaude:true},viewport:{width:390,height:844}});
 test('the rail is on the left edge and the message text starts clear of it',async({page,bridge},info)=>{
  await pair(page,bridge);
  // Settings, Thumb side: Left. (The rail, the X and Chat buttons and the Latest pill all move to that edge.)
  await page.evaluate(()=>{const key='dash.settings.v1';const settings=JSON.parse(localStorage.getItem(key)||'{}');settings.handedness='left';localStorage.setItem(key,JSON.stringify(settings));});
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('tab').nth(1)).toBeVisible({timeout:30000});
  await page.getByRole('tab').nth(1).click({noWaitAfter:true});
  await expect(page.getByTestId('chats-pane')).toBeVisible();
  await openChatByTitle(page,LONG_CHAT_TITLE,newestClaude);
  await expect.poll(()=>railOf(page).getByTestId('rail-tick').count(),{timeout:60000,message:'one bar per prompt'}).toBe(LONG_CHAT_PROMPTS);
  const geometry=await railGeometry(page);
  expectCoverage(geometry);
  expect(geometry.box.x).toBeLessThanOrEqual(2);
  expect(geometry.box.x+geometry.box.width).toBeLessThan((page.viewportSize()?.width??390)/2);
  expect(geometry.text.left).toBeGreaterThanOrEqual(geometry.box.x+geometry.box.width-1);
  await page.screenshot({path:info.outputPath('rail-long-chat-left-390.png')});
 });
});

test.describe('prompt rail on a 1000-message Hermes chat',()=>{
 test.use({bridgeOptions:{longHermes:true},viewport:{width:390,height:844}});
 test('every Hermes prompt is on the rail, on the right edge clear of the text, and tap and drag jump to the prompt shown',async({page,bridge},info)=>{
  let reachedStart=false;
  page.on('response',async response=>{
   if(!olderPages.test(response.url()))return;
   const body:unknown=await response.json().catch(()=>undefined);
   if(typeof body==='object'&&body!==null&&'before' in body&&body.before===null)reachedStart=true;
  });
  const release=await holdOlderPages(page);
  await pair(page,bridge);
  const newest=new RegExp(`^ARMY hermes answer ${pad(LONG_HERMES_PROMPTS)} `);
  await openChatByTitle(page,LONG_HERMES_TITLE,newest);
  const ticks=railOf(page).getByTestId('rail-tick');
  // Only the newest page is loaded and the reader is at the latest message; then the rest is paged in behind it.
  const atOpen=await stableReading(page);
  await expect(viewportOf(page).getByText(newest).first()).toBeInViewport();
  release();

  // The rest of the chat is paged in behind the newest page: wait for the page that reaches its start.
  // (A tap on the rail jumps, which would end the paging, so the rail is not touched until then.)
  await expect.poll(()=>reachedStart,{timeout:60000,message:'the start of the Hermes chat was paged in'}).toBe(true);
  await page.waitForTimeout(500);// the last page is on the rail a moment after its reply
  // 500 prompts cannot each have a bar of their own on a phone-height rail: neighbours fold into one bar,
  // so the rail is one dense column from top to bottom (at least one bar per 4 px).
  const box=await railOf(page).boundingBox();if(!box)throw Error('Prompt navigator has no box');
  await expect.poll(()=>ticks.count(),{timeout:15000,message:'the rail is a dense column of bars'}).toBeGreaterThanOrEqual(Math.floor(box.height/4));

  const geometry=await railGeometry(page);
  expectCoverage(geometry);
  expect(geometry.bars.length).toBeLessThanOrEqual(LONG_HERMES_PROMPTS);
  const wide=page.viewportSize()?.width??390;
  expect(geometry.box.x+geometry.box.width).toBeGreaterThanOrEqual(wide-2);
  expect(geometry.text.right).toBeGreaterThan(0);
  expect(geometry.text.right).toBeLessThanOrEqual(geometry.box.x+1);
  await page.screenshot({path:info.outputPath('rail-long-hermes-390.png')});
  expectHeld(atOpen,await reading(viewportOf(page)),'paging the rest of the chat in moved the reader');
  await expect(viewportOf(page).getByText(newest).first()).toBeInViewport();

  await expectTapDragJump(page,LONG_HERMES_PROMPTS,n=>`ARMY hermes prompt ${pad(n)}`,newest);
 });
});
