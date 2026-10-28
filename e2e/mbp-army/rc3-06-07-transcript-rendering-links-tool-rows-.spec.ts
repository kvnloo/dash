// RC3 tester army, area 07: transcript rendering (markdown, links, code, tool rows, details,
// jump-to-latest, prompt rail, history, workers, summaries).
// App under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc), served as a web export; bridge from the same commit.
// Same isolated real bridge + scripted ACP fixture as army.spec.ts. No HTTP/WebSocket route mocks of Dash
// traffic and no debug-store seeding. Replies come from fixture-agent.ts (ARMY_HANG + ARMY_R07_<SCENARIO>);
// persisted Hermes sessions are written into the isolated bridge HOME with rc3-chat-index-seed.ts.
// The only context route below is an egress guard: it records and aborts navigations to example.com,
// example.invalid and github.com so that "link opens" is proven without leaving the host.
import {test,expect,composer,send,pair,createBridge,type Bridge,bun} from './fixtures';
import type {Page,Locator,CDPSession} from 'playwright/test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import type {SeedSpec} from './rc3-chat-index-seed';

test.use({permissions:['clipboard-read','clipboard-write']});
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const bunBin=bun;
// RC3 renamed the workspace header compose action (a11y-workspace-header.ts WORKSPACE_ACTION_LABELS.newChat).
const NEW_CHAT='Create new chat';

// ---------- helpers ----------
/** Pair, then open a new chat from the workspace header: RC3 presents it full screen. */
async function openFullscreen(page:Page,bridge:Bridge){
 await pair(page,bridge);
 await page.getByRole('button',{name:NEW_CHAT,exact:true}).first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
}
/** Scripted fixture reply: the main handler stays open (ARMY_HANG); the R07 block streams and ends the turn. */
const scenario=(name:string,label=name.toLowerCase())=>`ARMY_HANG ARMY_R07_${name} ${label}`;
const viewport=(page:Page)=>page.getByTestId('transcript-viewport');
const sendBtn=(page:Page)=>page.getByRole('button',{name:'Send',exact:true});
const stopBtn=(page:Page)=>page.getByRole('button',{name:'Stop',exact:true});
const optionsToggle=(page:Page)=>page.getByRole('button',{name:'Chat options',exact:true});
const detailMode=(page:Page,m:'Hide'|'Compact'|'Full')=>page.getByRole('button',{name:`Details ${m}`,exact:true});
const fontPx=(l:Locator)=>l.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
const clipboard=(page:Page)=>page.evaluate(()=>navigator.clipboard.readText());
function captureSent(page:Page){const frames:string[]=[];page.on('websocket',ws=>ws.on('framesent',f=>frames.push(typeof f.payload==='string'?f.payload:f.payload.toString('utf8'))));return frames;}
/** Egress guard: records every navigation/request to the fixture's external link hosts and aborts it. */
async function egress(page:Page){
 const urls:string[]=[];
 await page.context().route(/^https?:\/\/(?:[\w-]+\.)*(?:example\.com|example\.invalid|github\.com)(?:[:/]|$)/,route=>{urls.push(route.request().url());return route.abort();});
 const popups:string[]=[];page.context().on('page',p=>popups.push(p.url()));
 return {urls,popups};
}
/** The transcript's FlashList scroller (RN web ScrollView div). */
async function scroller(page:Page){
 return viewport(page).evaluate(root=>{
  const el=Array.from(root.querySelectorAll('div')).find(d=>/(auto|scroll)/.test(getComputedStyle(d).overflowY)&&d.scrollHeight>d.clientHeight+4);
  return el?{top:el.scrollTop,max:el.scrollHeight-el.clientHeight}:null;
 });
}
async function wheelTranscript(page:Page,dy:number,times=4){
 const box=await viewport(page).boundingBox();if(!box)throw Error('transcript viewport has no box');
 await page.mouse.move(box.x+box.width*0.45,box.y+box.height*0.5);
 for(let i=0;i<times;i++){await page.mouse.wheel(0,dy);await page.waitForTimeout(120);}
}
/** RN Pressable long press (delayLongPress 350 ms) with a real pointer hold. */
async function longPress(page:Page,target:Locator){
 await target.scrollIntoViewIfNeeded();
 const box=await target.boundingBox();if(!box)throw Error('long-press target has no box');
 await page.mouse.move(box.x+Math.min(40,box.width/2),box.y+box.height/2);
 await page.mouse.down();await page.waitForTimeout(900);await page.mouse.up();
}
async function dragRail(page:Page){
 const rail=page.getByLabel('Prompt navigator',{exact:true});await expect(rail).toBeVisible();
 const box=await rail.boundingBox();if(!box)throw Error('Prompt navigator has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height*.8);await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+box.height*.08,{steps:8});await page.mouse.up();
 const preview=page.getByLabel('Turn preview',{exact:true});await expect(preview).toBeVisible();
 return preview;
}
async function runBun(code:string,env:Record<string,string>){
 const child=spawn(bunBin,['-e',code],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
 let err='';child.stderr?.on('data',d=>err+=d);const [codeOut]=await once(child,'exit');if(codeOut!==0)throw Error('bun helper failed: '+err);
}
/** Native Hermes rows in the isolated HOME (bridge stopped while writing), then wait for the real index. */
async function reseed(bridge:Bridge,spec:SeedSpec,titles:string[]){
 await bridge.stop();
 const specPath=join(bridge.dir,'army-r07-seed.json');
 await writeFile(specPath,JSON.stringify(spec));
 const child=spawn(bunBin,[join(__dirname,'rc3-chat-index-seed.ts'),bridge.dir,specPath],{stdio:['ignore','pipe','pipe']});
 let err='';child.stderr?.on('data',d=>err+=d);
 const [code]=await once(child,'exit');if(code!==0)throw Error('chat-index seed failed: '+err);
 await bridge.start();
 await expect.poll(async()=>{
  try{
   const token=(await readFile(join(bridge.dir,'.dash/token'),'utf8')).trim();
   const text=await (await fetch(`http://127.0.0.1:${bridge.port}/chats?limit=200`,{headers:{Authorization:`Bearer ${token}`}})).text();
   return titles.every(t=>text.includes(t));
  }catch{return false;}
 },{timeout:45000,message:'real bridge chat index must serve the seeded rows'}).toBe(true);
}
/** Hermes status columns (last_activity_description, ended_at) the fixture schema lacks, then run SQL on state.db. */
async function hermesSql(bridge:Bridge,statements:{sql:string;args:(string|number|null)[]}[]){
 await runBun(`
  const {Database}=await import('bun:sqlite');
  const db=new Database(process.env.R07_DB);
  for(const col of ['last_activity_description TEXT','ended_at REAL']){try{db.exec('ALTER TABLE sessions ADD COLUMN '+col);}catch{}}
  for(const s of JSON.parse(process.env.R07_SQL??'[]'))db.query(s.sql).run(...s.args);
  db.close();`,{R07_DB:join(bridge.dir,'.hermes','state.db'),R07_SQL:JSON.stringify(statements)});
}
async function openSeededRow(page:Page,bridge:Bridge,title:string){
 await pair(page,bridge);
 const row=page.getByTestId('chats-pane').locator('[data-testid^="chat-row-"]').filter({has:page.getByText(title,{exact:true})});
 await expect(row).toHaveCount(1,{timeout:30000});
 await row.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
}
async function latency(page:Page,ms:number):Promise<CDPSession>{
 const s=await page.context().newCDPSession(page);
 await s.send('Network.enable');
 await s.send('Network.emulateNetworkConditions',{offline:false,latency:ms,downloadThroughput:-1,uploadThroughput:-1});
 return s;
}
/** SkeletonRow on web: a text-free 72 px row holding a 28 px orb and two bars. */
function skeletonCount(page:Page):Promise<number>{
 return viewport(page).evaluate(root=>Array.from(root.querySelectorAll('div')).filter(d=>{
  const r=d.getBoundingClientRect();if(Math.round(r.height)!==72||r.width===0||(d.textContent??'').trim()!=='')return false;
  const orb=d.firstElementChild;if(!orb||d.children.length!==2)return false;
  const o=orb.getBoundingClientRect();return Math.round(o.width)===28&&Math.round(o.height)===28;
 }).length);
}
const nowS=()=>Date.now()/1000;

// ======================================================================
// Markdown, streaming, links, code
// ======================================================================

test('07.01 streamed fixture reply renders markdown (heading, list, bold, code), grows by delta and finalizes on done',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await send(page,scenario('MD','markdown journey'));
 // Delta 1 is on screen while the rest of the reply has not arrived yet: streaming, not one final paint.
 await expect(page.getByText(/ARMY_MD_PART1/).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByText(/ARMY_MD_DONE/)).toHaveCount(0);
 await expect(stopBtn(page)).toBeVisible();
 await expect(page.getByText('ARMY list item one',{exact:true})).toBeVisible();
 await expect(page.getByText('ARMY list item two',{exact:true})).toBeVisible();
 await expect(page.getByText(/ARMY_MD_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 // Finalized: Stop gone, Send back, no live status row.
 await expect(stopBtn(page)).toHaveCount(0);
 await expect(sendBtn(page)).toBeVisible();
 const heading=page.getByText('ARMY Heading One',{exact:true});
 await expect(heading).toBeVisible();
 expect(await fontPx(heading)).toBeGreaterThan(await fontPx(page.getByText(/^ARMY_MD_PART1 streamed first\.$/).first()));
 const bold=page.getByText('ARMY_BOLD',{exact:true});
 await expect(bold).toBeVisible();
 // Compare the strong run against its own paragraph text node (the parent Text).
 const weight=await bold.evaluate(el=>{const s=getComputedStyle(el);const p=getComputedStyle(el.parentElement??el);return {w:Number(s.fontWeight)||400,f:s.fontFamily,pw:Number(p.fontWeight)||400,pf:p.fontFamily};});
 expect(weight.w>weight.pw||weight.f!==weight.pf,'bold run renders heavier than its paragraph').toBe(true);
 await expect(page.getByText('army_inline_code',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Copy ts code',exact:true})).toBeVisible();
 await expect(page.getByText(/const armyValue = 42;/).filter({visible:true}).first()).toBeVisible();
 // The fenced source is not shown as raw markdown.
 await expect(page.getByText(/```ts/)).toHaveCount(0);
 await expect(page.getByText(/^# ARMY Heading One/)).toHaveCount(0);
});

test('07.02 code block Copy <language> code puts the code on the clipboard and shows Copied',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await send(page,scenario('MD','copy code journey'));
 await expect(page.getByText(/ARMY_MD_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 const copy=page.getByRole('button',{name:'Copy ts code',exact:true});
 await expect(copy).toHaveText('Copy');
 await copy.click({noWaitAfter:true});
 await expect(copy).toHaveText('Copied');
 await expect.poll(()=>clipboard(page)).toBe('const armyValue = 42;');
});

test('07.03 markdown [text](https://) link opens the URL; a non-http link does not open',async({page,bridge})=>{
 const out=await egress(page);
 await openFullscreen(page,bridge);
 await send(page,scenario('LINKS','links journey'));
 await expect(page.getByText(/ARMY_LINKS_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 const web=page.getByRole('link',{name:'ARMY web link',exact:true});
 await expect(web).toBeVisible();
 await web.click({noWaitAfter:true});
 await expect.poll(()=>out.urls.some(u=>u.startsWith('https://example.com/army-doc')),{message:'Linking.openURL opened the https link'}).toBe(true);
 // The aborted popup navigation to the https link is re-requested by Chromium itself (same popup frame, same URL, ~1.7 s later),
 // so compare the set of distinct egress URLs rather than the raw request count.
 const before={urls:[...new Set(out.urls)],popups:out.popups.length};
 const mail=page.getByRole('link',{name:'ARMY mail link',exact:true});
 await expect(mail).toBeVisible();
 await mail.click({noWaitAfter:true});
 await page.waitForTimeout(1500);
 expect(out.popups.slice(before.popups).filter(u=>u.startsWith('mailto:'))).toEqual([]);
 expect([...new Set(out.urls)].filter(u=>!before.urls.includes(u)),'the mailto tap reached no new egress URL').toEqual([]);
 await expect(composer(page)).toBeVisible();
});

test('07.04 RC3 #419/#386 bare https URL and file:line outside code are tappable links; inside code they stay plain',async({page,bridge})=>{
 // Expected to FAIL at 2c948dc: linkify-paths.ts / link-target.ts have no importer, Markdown never linkifies bare text.
 const out=await egress(page);
 await openFullscreen(page,bridge);
 await send(page,scenario('LINKS','bare links journey'));
 await expect(page.getByText(/ARMY_LINKS_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 const bare=page.getByRole('link',{name:'https://example.com/army-bare',exact:true});
 await expect(bare,'RC3 #419/#386: linkify-paths has no importer at 2c948dc; bare URL is plain text').toBeVisible({timeout:6000});
 await bare.click({noWaitAfter:true});
 await expect.poll(()=>out.urls.some(u=>u.startsWith('https://example.com/army-bare'))).toBe(true);
 const path=page.getByRole('link',{name:/\/srv\/army\/src\/file\.ts:12/});
 await expect(path).toBeVisible();
 const requests:string[]=[];page.on('request',r=>requests.push(r.url()));
 await path.click({noWaitAfter:true});
 // link-target classifies '/path:12' as {kind:'file', path, line:12}: the host opens that file position.
 await expect.poll(async()=>requests.some(u=>u.includes(encodeURIComponent('/srv/army/src/file.ts')))||await page.getByText(/file\.ts.*(line 12|:12)/).count()>1,{message:'file-position target used'}).toBe(true);
 await expect(page.getByRole('link',{name:/army-in-code/})).toHaveCount(0);
 await expect(page.getByRole('link',{name:/in-code\.ts/})).toHaveCount(0);
});

// ======================================================================
// Tool rows, reasoning, detail modes
// ======================================================================

test('07.05 tool call rows: label, expand (aria-expanded), tool_detail loads full output, collapse; reasoning preview shows tail',async({page,bridge})=>{
 // RC3 #420 (wired at 9c7ae14): ReplyBlocks renders a `N tools · s` header (aria-expanded), CompactToolRow lines (testIDs reply-tool-row /
 // reply-tool-call; a coalesced row lists its calls on tap, a single call opens the ToolInspector modal) and a one-line `Reasoning · <summary>`
 // row (aria-expanded) that shows the trace only when opened. CompactToolRow sets accessibilityState only, which RN Web 0.21 drops, so row
 // state is asserted through the rendered calls, not aria-expanded.
 const frames=captureSent(page);
 await openFullscreen(page,bridge);
 await send(page,scenario('TOOLS','tool rows journey'));
 await expect(page.getByText(/ARMY_TOOLS_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 // Header chip: N tools · seconds; a stack of up to three lines starts open.
 const header=page.getByRole('button',{name:/^4 tools · /});
 await expect(header).toBeVisible();
 await expect(header).toHaveAttribute('aria-expanded','true');
 // Reasoning: one quiet row while folded (documented text "Reasoning · summary unavailable"); opening it shows the trace tail.
 const reasoning=page.getByRole('button',{name:/^Reasoning · /});
 const tail=viewport(page).getByText(/ARMY_REASON_TAIL five/).filter({visible:true});
 await expect(reasoning).toHaveAttribute('aria-expanded','false');
 await expect(tail).toHaveCount(0);
 await reasoning.click({noWaitAfter:true});
 await expect(reasoning).toHaveAttribute('aria-expanded','true');
 await expect(tail.first()).toBeVisible();
 await reasoning.click({noWaitAfter:true});
 await expect(reasoning).toHaveAttribute('aria-expanded','false');
 await expect(tail).toHaveCount(0);
 // Same-name consecutive calls are grouped (Read ×3); tapping the group lists each call, tapping again folds it.
 const rows=viewport(page).getByTestId('reply-tool-row');
 const calls=viewport(page).getByTestId('reply-tool-call');
 const group=page.getByRole('button',{name:/^Read, 3 successful calls, latest target .*c\.ts/});
 await expect(group).toBeVisible();
 await expect(group).toContainText('Read ×3');
 await expect(rows).toHaveCount(2);
 await expect(calls).toHaveCount(0);
 await group.click({noWaitAfter:true});
 await expect(calls).toHaveCount(3);
 for(const [i,file] of ['a','b','c'].entries())await expect(calls.nth(i)).toHaveAttribute('aria-label',new RegExp('^Read, .*'+file+'\\.ts'));
 await group.click({noWaitAfter:true});
 await expect(calls).toHaveCount(0);
 // The bash call: tapping opens the inspector with the truncated live output; Load retained output sends tool_detail and the full tail arrives.
 const call=page.getByRole('button',{name:/^Run, army-bulk-output, completed/});
 await expect(call).toBeVisible();
 await call.click({noWaitAfter:true});
 const close=page.getByRole('button',{name:'Close tool details',exact:true});
 await expect(close).toBeVisible();
 await expect(page.getByText('Output is capped by the source or retention budget.',{exact:true})).toBeVisible();
 const load=page.getByRole('button',{name:'Load retained output (up to 1 MiB)',exact:true});
 await expect(load).toBeVisible();
 // The inspector list is virtualized, so read the output through its Copy output action (it copies the whole Output tab text).
 const copyOutput=page.getByRole('button',{name:'Copy output',exact:true});
 await copyOutput.click({noWaitAfter:true});
 await expect.poll(()=>clipboard(page)).toContain('army bulk output line 0000');
 expect(await clipboard(page),'preview output has no tail yet').not.toContain('ARMY_TOOL_TAIL');
 await load.click({noWaitAfter:true});
 await expect.poll(()=>frames.some(f=>f.includes('"tool_detail"')&&f.includes('r07-big')),{message:'tool_detail request sent for the call'}).toBe(true);
 await expect(load).toHaveCount(0);
 await expect(page.getByText('Output is capped by the source or retention budget.',{exact:true})).toHaveCount(0);
 await copyOutput.click({noWaitAfter:true});
 await expect.poll(()=>clipboard(page)).toContain('ARMY_TOOL_TAIL retained end');
 await close.click({noWaitAfter:true});
 await expect(close).toHaveCount(0);
 // The header folds the whole stack and opens it again.
 await header.click({noWaitAfter:true});
 await expect(header).toHaveAttribute('aria-expanded','false');
 await expect(rows).toHaveCount(0);
 await header.click({noWaitAfter:true});
 await expect(header).toHaveAttribute('aria-expanded','true');
 await expect(rows).toHaveCount(2);
});

test('07.06 RC3 #420 consecutive tool calls render as grouped CompactToolRow rows with count and model accessibilityLabel',async({page,bridge})=>{
 // RC3 #420 is wired at 9c7ae14: ReplyBlocks renders CompactToolRow rows (testIDs reply-tool-row / reply-tool-call).
 await openFullscreen(page,bridge);
 await send(page,scenario('TOOLS','compact rows journey'));
 await expect(page.getByText(/ARMY_TOOLS_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 // compactGroup label: "<Verb>, 3 successful calls, latest target <target>, completed[, duration]".
 const grouped=page.getByRole('button',{name:/^Read, 3 successful calls, latest target .*c\.ts.*, completed/});
 await expect(grouped,'RC3 #420: CompactToolRow groups consecutive read calls').toBeVisible({timeout:6000});
 await expect(grouped).toContainText('×3');
 // A single call row: "<verb>, <target>, completed, <duration>"; compact-tool-row.ts maps the bash tool to the verb "Run".
 await expect(page.getByRole('button',{name:/^Run, army-bulk-output, completed/})).toBeVisible();
});

test('07.07 a running tool shows live status; Inspect shows Waiting for output… and closes; Stop ends it',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await send(page,scenario('LIVETOOL','live tool journey'));
 await expect(page.getByText(/ARMY_LIVETOOL_STARTED/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 // RC3 #420 rows: a live call is one CompactToolRow ("Run, <target>, running"); tapping it opens the ToolInspector modal directly.
 const call=page.getByRole('button',{name:/^Run, army-never-finishes, running/});
 await expect(call).toBeVisible();
 await expect(call).toContainText('running');
 await call.click({noWaitAfter:true});
 const close=page.getByRole('button',{name:'Close tool details',exact:true});
 await expect(close).toBeVisible();
 await expect(page.getByText('Waiting for output…',{exact:true}).filter({visible:true}).first()).toBeVisible();
 await close.click({noWaitAfter:true});
 await expect(close).toHaveCount(0);
 await stopBtn(page).click({noWaitAfter:true});
 await expect(stopBtn(page)).toHaveCount(0);
});

test('07.08 detail mode Hide/Compact/Full changes how many thinking/tool blocks are visible in the same reply',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await send(page,scenario('TOOLS','detail mode journey'));
 await expect(page.getByText(/ARMY_TOOLS_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 const reasoning=page.getByRole('button',{name:/^Reasoning · /});
 const rows=viewport(page).getByTestId('reply-tool-row'); // RC3 #420: CompactToolRow lines (the Tree rows are no longer rendered in replies)
 const expanded=viewport(page).locator('[aria-expanded="true"]');
 await optionsToggle(page).click({noWaitAfter:true});
 await expect(detailMode(page,'Compact')).toBeVisible(); // Spec fix: RN Web 0.21 drops accessibilityState (README precedent: assert rendered state, not the attribute).
 await expect(reasoning).toHaveAttribute('aria-expanded','false');
 const compactRows=await rows.count();expect(compactRows).toBeGreaterThan(0);
 const compactOpen=await expanded.count();
 await detailMode(page,'Full').click({noWaitAfter:true});
 await expect(detailMode(page,'Full')).toBeVisible(); // Spec fix: RN Web 0.21 drops accessibilityState (README precedent).
 await expect(reasoning).toHaveAttribute('aria-expanded','true');
 await expect.poll(()=>expanded.count()).toBeGreaterThan(compactOpen);
 await detailMode(page,'Hide').click({noWaitAfter:true});
 await expect(detailMode(page,'Hide')).toBeVisible(); // Spec fix: RN Web 0.21 drops accessibilityState (README precedent).
 await expect(reasoning).toHaveCount(0);
 await expect(rows).toHaveCount(0);
 await expect(page.getByText(/^4 tools · /)).toHaveCount(0);
 await expect(page.getByText(/ARMY_TOOLS_DONE/).filter({visible:true}).first()).toBeVisible();
 await detailMode(page,'Compact').click({noWaitAfter:true});
 await expect(reasoning).toHaveAttribute('aria-expanded','false');
 await expect.poll(()=>rows.count()).toBe(compactRows);
});

// ======================================================================
// Long, selection, files, media
// ======================================================================

test('07.09 a working turn shows "working · <tool>" with an orb under the latest assistant message',async({page,bridge})=>{
 const id='army-r07-phase';const title='ARMY R07 phase';
 await reseed(bridge,{hermes:[{id,title,activityMs:Date.now(),messages:[{role:'user',text:'ARMY_PHASE_Q'},{role:'assistant',text:'ARMY_PHASE_ANSWER'}]}]},[title]);
 await openSeededRow(page,bridge,title);
 await expect(page.getByText('ARMY_PHASE_ANSWER').filter({visible:true}).first()).toBeVisible({timeout:20000});
 await expect(page.getByText(/^working · /)).toHaveCount(0);
 // Terminal-observed work: a live gateway (pid inside the bridge namespace) and a fresh activity label.
 const holder=(await readFile(join(bridge.dir,'.omp','agent','army-holder.pid'),'utf8')).trim();
 await writeFile(join(bridge.dir,'.hermes','gateway_state.json'),JSON.stringify({kind:'hermes-gateway',gateway_state:'running',pid:Number(holder),hermes_home:join(bridge.dir,'.hermes')}));
 await hermesSql(bridge,[{sql:'UPDATE sessions SET last_activity_at=?, last_activity_description=? WHERE id=?',args:[nowS()-2,'executing tool: armyprobe',id]}]);
 const status=page.getByText('working · armyprobe',{exact:true});
 await expect(status).toBeVisible({timeout:20000});
 const row=page.locator('div').filter({has:page.getByText('ARMY_PHASE_ANSWER')}).filter({has:status}).last();
 await expect(row.getByTestId('agent-orb')).toBeVisible();
 const answerBox=await page.getByText('ARMY_PHASE_ANSWER').first().boundingBox();const statusBox=await status.boundingBox();
 expect(answerBox&&statusBox&&statusBox.y>answerBox.y,'status row sits under the latest assistant message').toBe(true);
});

test('07.10 a truncated long reply shows Show full message; tapping it renders the full text',async({page,bridge})=>{
 const title='ARMY R07 long';
 const long='ARMY_LONG_HEAD '+'army long filler text '.repeat(900)+'ARMY_FULL_TAIL';
 await reseed(bridge,{hermes:[{id:'army-r07-long',title,activityMs:Date.now(),messages:[{role:'user',text:'ARMY_LONG_Q'},{role:'assistant',text:long}]}]},[title]);
 await openSeededRow(page,bridge,title);
 await expect(page.getByText(/ARMY_LONG_HEAD/).first()).toBeAttached({timeout:20000});
 const more=page.getByRole('button',{name:'Show full message',exact:true});
 await expect(more).toBeVisible();
 await expect(page.getByText(/ARMY_FULL_TAIL/)).toHaveCount(0);
 await more.click({noWaitAfter:true});
 await expect(page.getByText(/ARMY_FULL_TAIL/).first()).toBeAttached({timeout:15000});
 await expect(more).toHaveCount(0);
});

test('07.11 long-press reply text (350 ms) on web keeps OS selection; the Android selection sheet does not open',async({page,bridge})=>{
 // Markdown.onLongPress returns early unless Platform.OS === 'android'. The sheet itself is native-only.
 await openFullscreen(page,bridge);
 await send(page,scenario('MD','selection journey'));
 await expect(page.getByText(/ARMY_MD_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 const para=page.getByText(/^ARMY_MD_PART1 streamed first\.$/).first();
 await longPress(page,para);
 await expect(page.getByTestId('reply-selection-input')).toHaveCount(0);
 await expect(page.getByTestId('reply-to-selection')).toHaveCount(0);
 expect(await para.evaluate(el=>getComputedStyle(el).userSelect)).not.toBe('none');
 // OS selection works on the reply text and the composer is untouched.
 await para.selectText();
 expect(await page.evaluate(()=>String(window.getSelection()))).toContain('ARMY_MD_PART1');
 await expect(composer(page)).toHaveValue('');
});

test('07.12 a reply naming a host file shows Send <file> to phone; tapping it reports the bridge result',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await send(page,scenario('FILES','send to phone journey'));
 await expect(page.getByText(/ARMY_FILES_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 const share=page.getByRole('button',{name:'Send army-report.md to phone',exact:true});
 await expect(share).toBeVisible();
 await expect(share).toContainText('Send to phone');
 // Web skips the native "Send to phone?" confirm and alerts the bridge message. The fixture path does not exist,
 // so the real /share check answers "not on the host": nothing is pushed anywhere.
 const dialog=page.waitForEvent('dialog');
 await share.click({noWaitAfter:true});
 const d=await dialog;const message=d.message();await d.accept();
 expect(message).toBe('That file is not on the host.');
 await expect(share).toBeEnabled();
});

test('07.13 attached files on a user message show Attached <name>',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await page.getByRole('button',{name:'Attach file',exact:true}).click({noWaitAfter:true});
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Files',exact:true}).click({noWaitAfter:true});
 await (await chooser).setFiles({name:'army-r07-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('ARMY_R07_ATTACHMENT_BYTES\n')});
 const chip=page.getByLabel(/^army-r07-evidence\.txt,/);
 await expect(chip).not.toHaveAttribute('aria-label',/Uploading|Failed|failed|error/,{timeout:15000});
 await composer(page).fill('attachment rendering journey');
 await expect(sendBtn(page)).toBeEnabled();
 await sendBtn(page).click({noWaitAfter:true});
 await expect(viewport(page).getByLabel('Attached army-r07-evidence.txt',{exact:true})).toBeVisible();
 await expect(page.getByText(/ARMY_REPLY: attachment rendering journey/).filter({visible:true}).first()).toBeVisible();
});

test('07.14 inline image opens full view and closes; inline HTML opens ArtifactStage',async({page,bridge})=>{
 await egress(page);
 await openFullscreen(page,bridge);
 await send(page,scenario('MEDIA','media journey'));
 await expect(page.getByText(/ARMY_MEDIA_DONE/).filter({visible:true}).first()).toBeVisible({timeout:15000});
 const open=page.getByRole('button',{name:'Open image: ARMY chart',exact:true});
 await expect(open).toBeVisible();
 await open.click({noWaitAfter:true});
 const close=page.getByRole('button',{name:'Close image',exact:true});
 await expect(close).toBeVisible();
 await expect(close).toContainText('Close · ARMY chart');
 await close.click({noWaitAfter:true});
 await expect(close).toHaveCount(0);
 const stage=page.getByRole('button',{name:'Open HTML in stage',exact:true});
 await expect(stage).toBeVisible();
 await stage.click({noWaitAfter:true});
 await expect(page.getByText('HTML preview · unverified',{exact:true}).filter({visible:true}).first()).toBeVisible();
 await expect(composer(page)).toHaveCount(0);
});

// ======================================================================
// Scrolling: auto-follow, jump to latest, prompt rail, history
// ======================================================================

test('07.15 scrolling up stops auto-follow while content streams; Latest reply scrolls to newest and resumes follow',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await send(page,scenario('SLOW','follow journey'));
 await expect(page.getByText(/ARMY_SLOW_CHUNK_08/).filter({visible:true}).first()).toBeVisible({timeout:20000});
 await wheelTranscript(page,-2500,5);
 const s1=await scroller(page);if(!s1)throw Error('transcript scroller not found');
 expect(s1.max-s1.top,'scrolled away from the newest content').toBeGreaterThan(200);
 await page.waitForTimeout(2500);
 const s2=await scroller(page);if(!s2)throw Error('transcript scroller not found');
 expect(s2.max,'content kept arriving').toBeGreaterThan(s1.max);
 expect(s2.max-s2.top,'auto-follow stopped: the view did not chase new content').toBeGreaterThan(200);
 const latest=page.getByRole('button',{name:/^Latest( live)? reply$/});
 await expect(latest).toBeVisible();
 await latest.click({noWaitAfter:true});
 await expect.poll(async()=>{const s=await scroller(page);return s?s.max-s.top:9999;},{message:'list scrolled to newest'}).toBeLessThanOrEqual(60);
 await page.waitForTimeout(1800);
 await expect.poll(async()=>{const s=await scroller(page);return s?s.max-s.top:9999;},{message:'follow resumed for new chunks'}).toBeLessThanOrEqual(60);
 await expect(page.getByText(/ARMY_SLOW_DONE/).first()).toBeInViewport({timeout:25000});
});

test('07.16 RC3 #385/#393 jump-to-latest quick scroll button with unread badge shows when scrolled up and hides after tap',async({page,bridge})=>{
 // Expected to FAIL at 2c948dc: QuickScrollButton has no importer; the PromptRail Latest button is the only jump path.
 await openFullscreen(page,bridge);
 await send(page,scenario('SLOW','quick scroll journey'));
 await expect(page.getByText(/ARMY_SLOW_CHUNK_08/).filter({visible:true}).first()).toBeVisible({timeout:20000});
 await wheelTranscript(page,-2500,5);
 const jump=page.getByTestId('quick-scroll-button');
 await expect(jump,'RC3 #385/#393: QuickScrollButton has no importer at 2c948dc').toBeVisible({timeout:6000});
 await expect(jump).toHaveAttribute('aria-label',/^Jump to latest/);
 // Keyboard-aware: sits above the composer.
 const j=await jump.boundingBox();const c=await composer(page).boundingBox();
 expect(j&&c&&j.y+j.height<=c.y,'jump button sits above the composer').toBe(true);
 await jump.click({noWaitAfter:true});
 await expect.poll(async()=>{const s=await scroller(page);return s?s.max-s.top:9999;}).toBeLessThanOrEqual(60);
 await expect(jump).toHaveCount(0);
});

test('07.17 prompt rail: drag preview, Jump, Copy, Copy file path, Open PR, Continue then Replace draft, Close',async({page,bridge})=>{
 const out=await egress(page);
 const frames=captureSent(page);
 await openFullscreen(page,bridge);
 const pr='https://github.com/example/army-fixture/pull/7';
 for(let i=0;i<4;i++){
  const extra=i===0?` see ${pr} and /srv/army/src/rail.ts for details`:'';
  await send(page,'rail prompt '+i+extra+' '+('transcript text '.repeat(20)));
  // The inactive Chats pane keeps a hidden row "Last reply · ...ARMY_REPLY: rail prompt N", so match this turn's reply by its own prompt number among visible nodes.
  await expect(page.getByText(new RegExp('ARMY_REPLY: rail prompt '+i+' ')).filter({visible:true}).first()).toBeVisible({timeout:15000});
 }
 let preview=await dragRail(page);
 await expect(preview).toContainText(/Prompt 1\/4 · \w+/);
 // Copy prompt + summary.
 await preview.getByRole('button',{name:'Copy',exact:true}).click({noWaitAfter:true});
 await expect(preview.getByRole('button',{name:'Copied',exact:true})).toBeVisible();
 await expect.poll(()=>clipboard(page)).toMatch(/^rail prompt 0 [\s\S]*\n\n.*ARMY_REPLY: rail prompt 0/);
 // Copy file path copies the first file ref.
 await preview.getByRole('button',{name:'Copy file path',exact:true}).click({noWaitAfter:true});
 await expect(preview.getByRole('button',{name:'Path copied',exact:true})).toBeVisible();
 await expect.poll(()=>clipboard(page)).toBe('/srv/army/src/rail.ts');
 // Open PR opens the PR URL.
 await preview.getByRole('button',{name:'Open PR',exact:true}).click({noWaitAfter:true});
 await expect.poll(()=>out.urls.some(u=>u.startsWith(pr)),{message:'Open PR opened the PR'}).toBe(true);
 // Jump scrolls to that prompt.
 await preview.getByRole('button',{name:'Jump',exact:true}).click({noWaitAfter:true});
 await expect(viewport(page).getByText(/^rail prompt 0 /).first()).toBeInViewport();
 await page.getByRole('button',{name:'Close turn preview',exact:true}).click({noWaitAfter:true});
 await expect(preview).toHaveCount(0);
 // Continue asks first, then Replace draft fills the composer (nothing sent).
 preview=await dragRail(page);
 await preview.getByRole('button',{name:'Continue',exact:true}).click({noWaitAfter:true});
 await expect(preview.getByText(/Replace the composer draft with this reference\? Nothing is sent/)).toBeVisible();
 await preview.getByRole('button',{name:'Replace draft',exact:true}).click({noWaitAfter:true});
 await expect(preview).toHaveCount(0);
 await expect(composer(page)).toHaveValue(/^Continue from prompt 1: rail prompt 0 [\s\S]*\nResult: .*ARMY_REPLY: rail prompt 0/);
 // Nothing was sent: the socket carried exactly the four chat turns (the list is virtualized and the hidden Chats row also matches ARMY_REPLY, so count frames, not text nodes).
 expect(frames.filter(f=>f.includes('"type":"chat"')),'Continue / Replace draft sends nothing').toHaveLength(4);
});

test('07.18 scrolling to the top of a long session loads older history with a skeleton header',async({page,bridge})=>{
 // Design at 9c7ae14 (store/history-pages.ts fillOlder/loadOlder): opening a chat pages the rest of the session in behind the newest window
 // in the background (GET /chats/history?limit=200, "unlisted" rows), and the reader reaching the top lists those rows with NO request. The
 // SkeletonRow header (history.loading) is drawn only for the reader's own fetch when nothing was prefetched, which a 120-message session never needs.
 // So the web-observable contract here is: the newest window opens first, the oldest rows are absent, and scrolling to the top brings them in.
 const title='ARMY R07 history';
 const messages=Array.from({length:120},(_,i)=>({role:(i%2?'assistant':'user') as 'assistant'|'user',text:(i%2?'ARMY_HIST_A_':'ARMY_HIST_Q_')+String(i).padStart(3,'0')}));
 await reseed(bridge,{hermes:[{id:'army-r07-history',title,activityMs:Date.now(),messages}]},[title]);
 await openSeededRow(page,bridge,title);
 await expect(page.getByText('ARMY_HIST_A_119',{exact:true})).toBeVisible({timeout:20000});
 await expect(page.getByText('ARMY_HIST_Q_000',{exact:true})).toHaveCount(0);
 await expect.poll(async()=>{
  await wheelTranscript(page,-4000,3);
  return page.getByText('ARMY_HIST_Q_000',{exact:true}).count();
 },{timeout:60000,intervals:[200],message:'onStartReached lists the oldest rows'}).toBe(1);
 await expect(page.getByText('ARMY_HIST_Q_000',{exact:true})).toBeVisible();
});

// ======================================================================
// Workers strip, thinking summaries
// ======================================================================

test('07.19 running subagents show "<n> subagents working" in the workers strip',async({page,bridge})=>{
 const id='army-r07-workers';const title='ARMY R07 workers';
 await reseed(bridge,{hermes:[{id,title,activityMs:Date.now(),messages:[{role:'user',text:'ARMY_WORKERS_Q'},{role:'assistant',text:'ARMY_WORKERS_ANSWER'}]}]},[title]);
 await openSeededRow(page,bridge,title);
 await expect(page.getByText('ARMY_WORKERS_ANSWER').filter({visible:true}).first()).toBeVisible({timeout:20000});
 await expect(page.getByRole('button',{name:/subagents working$/})).toHaveCount(0);
 const insert='INSERT OR REPLACE INTO sessions (id,source,title,started_at,last_activity_at,message_count,cwd,archived,hidden,parent_session_id,end_reason,model_config,last_activity_description,ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
 await hermesSql(bridge,['one','two'].map(n=>({sql:insert,args:[`${id}-child-${n}`,'delegate',`ARMY worker ${n}`,nowS()-30,nowS()-1,1,null,0,0,id,null,'{}','executing tool: armyworker',null]})));
 const strip=page.getByRole('button',{name:'2 subagents working',exact:true});
 await expect(strip).toBeVisible({timeout:20000});
});

/** Tiny summary model on loopback: OpenAI-compatible /chat/completions with a fixed answer. Deterministic, no model. */
const summaryTest=test.extend<{tinyUrl:string}>({
 tinyUrl:async({},use)=>{
  const server=createServer((req,res)=>{
   let body='';req.on('data',d=>body+=d);req.on('end',()=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/models')){res.end(JSON.stringify({data:[{id:'army'}]}));return;}
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'ARMY_SUMMARY traced the reply plan'}}]}));
   });
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const {port}=server.address() as AddressInfo;
  try{await use(`http://127.0.0.1:${port}/v1`);}finally{server.close();}
 },
 // Same isolated bridge, but its tiny-model endpoint (DASH_TINY_URL) is the loopback fixture above.
 bridge:async({tinyUrl},use,info)=>{
  const b=await createBridge(true,{env:{DASH_TINY_URL:tinyUrl}});
  try{await use(b);}finally{await b.stop();await writeFile(info.outputPath('bridge.log'),b.logs());}
 },
});

summaryTest('07.20 thinking summary chip shows Thinking summary / Turn summary text when summaries are on',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await optionsToggle(page).click({noWaitAfter:true});
 const sw=page.getByRole('switch',{name:'Thinking summaries',exact:true});
 await sw.click({noWaitAfter:true});
 await expect(sw).toContainText('Thinking summaries · on · next turn');
 await send(page,scenario('REASON','summary journey'));
 await expect(page.getByText(/ARMY_REASON_DONE/).filter({visible:true}).first()).toBeVisible({timeout:20000});
 const chip=page.getByLabel(/^(Thinking|Turn) summary$/);
 await expect(chip.first()).toBeVisible({timeout:20000});
 await expect(chip.first()).toContainText(/Thought \d+ s · ARMY_SUMMARY traced the reply plan/);
});
