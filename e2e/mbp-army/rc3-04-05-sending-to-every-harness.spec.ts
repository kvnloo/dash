// RC3 tester army, area 05: sending to every harness (omp, codex, grok, claude, hermes, pi, fx).
// App under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc), served as a web export; bridge from the same commit.
// Real Expo UI -> isolated real Bun bridge -> scripted fixture agent (fixture-agent.ts). No route mocks, no
// debug-store seeding, no real model credentials. The only test-side setup is in the bridge's private temp dir:
// one bin wrapper per harness binary (all exec the fixture and export ARMY_HARNESS=<bin> so the fixture logs
// which binary got each turn), plus fixture history rows for the persisted-session journeys.
//
// RC3 transport facts this spec relies on (bridge/src/acp/supervisor.ts acpCommand, bridge/index.ts):
// - Default (DASH_ENABLE_LEGACY_CLI!=1): omp/hermes/grok/claude/codex run over ACP via `omp acp`, `hermes acp`,
//   `grok agent --no-leader stdio`, `claude-agent-acp`, `codex-acp`. pi and fx have no ACP adapter and are
//   reported unavailable.
// - Legacy CLI mode (DASH_ENABLE_LEGACY_CLI=1): availability is Bun.which(bin); pi (`--mode json`) and fx
//   (`ask --json`) run as one-shot CLIs. A separate isolated bridge is started for that lane.
import {test,expect,pair,composer,send,createBridge,type Bridge,bun} from './fixtures';
import type {Page,TestInfo} from 'playwright/test';
import {appendFile,readFile,rename,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {hostname} from 'node:os';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

type Harness={id:string;name:string;bin:string;cli?:'pi'|'fx'};
// Order and display names are bridge/src/harnesses.ts HARNESSES.
const OMP:Harness={id:'omp',name:'OMP',bin:'omp'};
const CODEX:Harness={id:'codex',name:'Codex',bin:'codex-acp'};
const GROK:Harness={id:'grok',name:'Grok',bin:'grok'};
const CLAUDE:Harness={id:'claude',name:'Claude Code',bin:'claude-agent-acp'};
const HERMES:Harness={id:'hermes',name:'Hermes',bin:'hermes'};
const PI:Harness={id:'pi',name:'Pi',bin:'pi',cli:'pi'};
const FX:Harness={id:'fx',name:'fx',bin:'fx',cli:'fx'};
const ACP=[OMP,CODEX,GROK,CLAUDE,HERMES];
const ALL=[OMP,CODEX,GROK,CLAUDE,HERMES,PI,FX];
const SESSION='army-fixture-session';
// theme.ts colors.ok / colors.textFaint (night palette, and the proof-mono palette if the export used it).
const OK_DOT=['rgb(152, 207, 139)','rgb(240, 240, 237)'];
const FAINT_DOT=['rgb(94, 91, 82)','rgb(116, 116, 111)'];

const sq=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
const re=(s:string)=>new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));

/** One fixture wrapper per harness binary in the bridge's private PATH dir. Atomic rename: the bridge may exec a wrapper while it is replaced. */
async function installHarnessBins(b:Bridge,list:Harness[]){
 for(const h of list){
  const path=join(b.dir,'bin',h.bin);
  await writeFile(path+'.army-tmp','#!/bin/sh\nexport ARMY_HARNESS='+h.bin+'\n'+(h.cli?'export ARMY_FIXTURE_CLI='+h.cli+'\n':'')+'exec '+sq(bun)+' '+sq(join(__dirname,'fixture-agent.ts'))+' "$@"\n',{mode:0o700});
  await rename(path+'.army-tmp',path);
 }
}
type Call={harness:string;method?:string;cli?:string;sessionId?:string|null;resumed?:string|null;text?:string};
async function calls(b:Bridge):Promise<Call[]>{
 try{return (await readFile(join(b.dir,'army-harness-calls.jsonl'),'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line) as Call);}catch{return [];}
}
async function rosterHosts(b:Bridge){
 const token=(await readFile(join(b.dir,'.dash/token'),'utf8')).trim();
 const body=await (await fetch(`http://127.0.0.1:${b.port}/roster`,{headers:{Authorization:`Bearer ${token}`}})).json() as {hosts:{id:string;self:boolean;agents:{id:string;kind:string;sessionId?:string;status:string}[]}[]};
 const self=body.hosts.find(h=>h.self);if(!self)throw Error('roster has no self host');
 return self;
}

type Frame=Record<string,unknown>;
/** Records the real app<->bridge WebSocket traffic (observation only; nothing is altered). */
function recordWire(page:Page,b:Bridge){
 const sent:Frame[]=[];const got:Frame[]=[];
 const parse=(payload:string|Buffer,into:Frame[])=>{try{const v:unknown=JSON.parse(String(payload));for(const f of Array.isArray(v)?v:[v])if(typeof f==='object'&&f!==null)into.push(f as Frame);}catch{/* non-JSON frame */}};
 page.on('websocket',ws=>{
  if(!ws.url().includes(':'+b.port))return;
  ws.on('framesent',f=>parse(f.payload,sent));ws.on('framereceived',f=>parse(f.payload,got));
 });
 return {sent,got};
}
type Wire=ReturnType<typeof recordWire>;
async function chatFrame(wire:Wire,harness:string,text:string){
 await expect.poll(()=>wire.sent.some(f=>f.type==='chat'&&f.harness===harness&&String(f.text).includes(text)),{message:`app sent a chat frame for ${harness}`}).toBe(true);
 const frame=wire.sent.find(f=>f.type==='chat'&&f.harness===harness&&String(f.text).includes(text));
 if(!frame)throw Error('chat frame vanished');
 return frame;
}
/** The bridge started the turn on `harness`, streamed text and finished with done exitCode 0. */
async function expectCompletedTurn(wire:Wire,harness:string,text:string){
 const frame=await chatFrame(wire,harness,text);const id=frame.id;
 await expect.poll(()=>wire.got.some(f=>f.type==='session'&&f.id===id&&f.harnessId===harness),{message:`session event for ${harness}`}).toBe(true);
 await expect.poll(()=>wire.got.some(f=>f.type==='delta'&&f.id===id),{message:'streamed delta'}).toBe(true);
 await expect.poll(()=>wire.got.find(f=>f.type==='done'&&f.id===id)?.exitCode,{timeout:20000,message:'done event'}).toBe(0);
 return frame;
}

const NEW_CHAT='Create new chat';
const chip=(page:Page)=>page.getByRole('button',{name:'Choose harness',exact:true});
const closePicker=(page:Page)=>page.getByRole('button',{name:'Close harness picker',exact:true});
const pickerRow=(page:Page,h:Harness,available=true)=>page.getByRole('button',{name:available?h.name:`${h.name}, unavailable`,exact:true});
const badge=(page:Page)=>page.getByTestId('chat-window-badge');
const optionsTrigger=(page:Page)=>page.getByRole('button',{name:'Options. Current surface: Chat',exact:true});
const back=(page:Page)=>page.getByRole('button',{name:'Back',exact:true});
// Spec fix: In-app feedback is on by default, which swaps the Main search bar placeholder to 'Feedback for Dash' (MainScreen.tsx).
const searchBox=(page:Page)=>page.getByPlaceholder(/^((Search or message|Feedback for) Dash|Message .+)$/);

/** Pair, then New chat from the workspace header: RC3 opens it full screen with the harness chip. */
async function openFullscreen(page:Page,b:Bridge){
 await pair(page,b);
 await page.getByRole('button',{name:NEW_CHAT,exact:true}).first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await expect(chip(page)).toBeVisible();
}
/** Back to Main, select the exact new row (never the first roster row) and reopen it as a window. */
async function openWindow(page:Page,b:Bridge){
 await openFullscreen(page,b);
 await back(page).click({noWaitAfter:true});
 const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('New chat',{exact:true})});
 await expect(row).toHaveCount(1);
 await row.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
}
async function openPicker(page:Page,mode:'full'|'window'){
 if(mode==='full')await chip(page).click({noWaitAfter:true});
 else{await optionsTrigger(page).click({noWaitAfter:true});await page.getByRole('button',{name:/^Harness, /}).click({noWaitAfter:true});}
 await expect(closePicker(page)).toBeVisible();
}
async function pickHarness(page:Page,h:Harness,mode:'full'|'window'){
 await openPicker(page,mode);
 await pickerRow(page,h).click({noWaitAfter:true});
 await expect(closePicker(page)).toHaveCount(0);
 if(mode==='full')await expect(chip(page)).toContainText(`${h.name} · Change`);
 else await expect(badge(page)).toContainText(h.name);
}
async function sendAndExpectReply(page:Page,text:string){
 await send(page,text);
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByText(re('ARMY_REPLY: '+text)).filter({visible:true}).first()).toBeVisible({timeout:20000});
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
}
/** Settings > Harnesses on <host>: one row per harness, labelled installed/not found, with an ok or faint dot. */
async function expectSettingsHarnesses(page:Page,expected:Map<string,boolean>){
 await page.getByRole('button',{name:'Open settings',exact:true}).first().click({noWaitAfter:true});
 // Spec fix: BridgePull (always mounted) renders the same 'Harnesses on <host>' label as Settings; scope to the smallest block holding Settings-only 'Thumb side' plus the label.
 const title=`Harnesses on ${hostname()}`;
 const settings=page.locator('div').filter({has:page.getByText('Thumb side',{exact:true})}).filter({has:page.getByText(title,{exact:true})}).last();
 await expect(settings.getByText(title,{exact:true})).toHaveCount(1);
 await expect(settings.getByText(title,{exact:true})).toBeVisible();
 for(const h of ALL){
  const available=expected.get(h.id);
  const row=page.getByLabel(`${h.name}, ${available?'installed':'not found'}`,{exact:true});
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  await expect(row).toContainText(h.name);
  const dot=await row.evaluate(el=>{const divs=el.querySelectorAll('div');const last=divs[divs.length-1];return last?getComputedStyle(last).backgroundColor:'';});
  expect(available?OK_DOT:FAINT_DOT,`${h.name} status dot`).toContain(dot);
 }
}
/** Reveal a Bots-pane tree row: expand the host, then each harness/bot group until the row renders. */
async function revealTreeRow(page:Page,host:string,testId:string){
 const target=page.getByTestId(testId);
 const groups=page.locator(`[data-testid^="tree-row-${host}:harness:"], [data-testid^="tree-row-${host}:bot:"]`);
 await expect(page.getByTestId(`tree-row-host:${host}`)).toBeVisible({timeout:20000});
 if(await groups.count()===0)await page.getByTestId(`tree-row-host:${host}`).click({noWaitAfter:true});
 await expect(groups.first()).toBeVisible();
 const ids=(await groups.evaluateAll(els=>els.map(e=>e.getAttribute('data-testid')||''))).filter(id=>!id.endsWith(':new')&&!id.includes(':session:'));
 for(const id of ids){
  if(await target.isVisible())break;
  await page.getByTestId(id).click({noWaitAfter:true});
  await target.waitFor({state:'visible',timeout:2000}).catch(()=>undefined);
 }
 await expect(target).toBeVisible();
 return target;
}
async function openBots(page:Page){
 await page.getByRole('tab').nth(0).click({noWaitAfter:true});
 await expect(page.getByRole('tab').nth(0)).toHaveAttribute('aria-selected','true');
}
async function startLegacyBridge(info:TestInfo){
 const b=await createBridge(false,{env:{DASH_ENABLE_LEGACY_CLI:'1'}});
 await installHarnessBins(b,[PI,FX]);
 return {b,stop:async()=>{await b.stop();await writeFile(info.outputPath('legacy-bridge.log'),b.logs());}};
}

test('Settings lists every bridge harness: ACP adapters installed (ok dot), pi and fx not found (faint dot)',async({page,bridge})=>{
 await installHarnessBins(bridge,ACP);
 const wire=recordWire(page,bridge);
 await pair(page,bridge);
 // The bridge's own hello list is the source of truth the screen must mirror.
 await expect.poll(()=>wire.got.some(f=>Array.isArray(f.harnesses))).toBe(true);
 const hello=wire.got.find(f=>Array.isArray(f.harnesses));
 const listed=(hello?.harnesses as {id:string;available:boolean}[]);
 expect(listed.map(h=>h.id)).toEqual(ALL.map(h=>h.id));
 const expected=new Map(listed.map(h=>[h.id,h.available]));
 for(const h of ACP)expect(expected.get(h.id),h.id).toBe(true);
 expect(expected.get('pi')).toBe(false);expect(expected.get('fx')).toBe(false);
 await expectSettingsHarnesses(page,expected);
});

test('harness picker: new chat defaults to OMP, unavailable rows are disabled and inert, Close dismisses',async({page,bridge})=>{
 await installHarnessBins(bridge,ACP);
 await openFullscreen(page,bridge);
 // No saved default yet: the chat falls back to omp.
 await expect(chip(page)).toContainText('OMP · Change');
 await expect(composer(page)).toHaveAttribute('placeholder',/OMP/);
 await openPicker(page,'full');
 for(const h of ACP)await expect(pickerRow(page,h)).toBeEnabled();
 for(const h of [PI,FX]){
  await expect(pickerRow(page,h,false)).toBeVisible();
  await expect(pickerRow(page,h,false)).toBeDisabled();
 }
 await expect(page.getByText('Not installed on the bridge machine',{exact:true})).toHaveCount(2);
 // A disabled row does nothing: the picker stays open and the harness is unchanged.
 await pickerRow(page,PI,false).click({force:true,noWaitAfter:true});
 await expect(closePicker(page)).toBeVisible();
 await expect(pickerRow(page,PI,false)).toBeVisible();
 await closePicker(page).click({noWaitAfter:true});
 await expect(closePicker(page)).toHaveCount(0);
 await expect(chip(page)).toContainText('OMP · Change');
 // Windowed chat reaches the same picker through the options menu, and Close works there too.
 await back(page).click({noWaitAfter:true});
 const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('New chat',{exact:true})});
 await expect(row).toHaveCount(1);await row.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await openPicker(page,'window');
 await expect(pickerRow(page,FX,false)).toBeDisabled();
 await closePicker(page).click({noWaitAfter:true});
 await expect(closePicker(page)).toHaveCount(0);
 await expect(badge(page)).toContainText('OMP');
});

for(const h of [CLAUDE,CODEX,OMP,HERMES,GROK])test(`${h.name}: pick it, send, the reply streams from the ${h.id} harness and completes`,async({page,bridge})=>{
 await installHarnessBins(bridge,ACP);
 const wire=recordWire(page,bridge);
 await openWindow(page,bridge);
 if(h===OMP)await expect(badge(page)).toContainText('OMP'); // default harness, no pick needed
 else await pickHarness(page,h,'window');
 await expect(composer(page)).toHaveAttribute('placeholder',re(h.name));
 const text=`hello ${h.id} ARMY_TO_${h.id.toUpperCase()}`;
 await sendAndExpectReply(page,text);
 await expectCompletedTurn(wire,h.id,text);
 // Spec fix: once the session attaches, the badge text shows the profile/session ('hermes… · army-fix'); the harness name is in the identity label.
 await expect(badge(page)).toHaveAttribute('aria-label',re('harness '+h.name+','));
 // The fixture binary for exactly this harness received the prompt.
 await expect.poll(async()=>(await calls(bridge)).some(c=>c.harness===h.bin&&c.method==='session/prompt'&&c.text?.includes(text))).toBe(true);
 expect((await calls(bridge)).filter(c=>c.method==='session/prompt'&&c.text?.includes(text)).map(c=>c.harness)).toEqual([h.bin]);
 // Options: the Live surface switch exists only for Hermes chats.
 await optionsTrigger(page).click({noWaitAfter:true});
 await expect(page.getByRole('button',{name:/^Harness, /})).toBeVisible();
 await expect(page.getByRole('button',{name:/^Surface, /})).toHaveCount(h===HERMES?1:0);
 await page.getByRole('button',{name:'Close Options. Current surface: Chat',exact:true}).click({noWaitAfter:true});
});

test('switching harness saves the default; reopening a harness reuses its empty chat instead of duplicating',async({page,bridge})=>{
 await installHarnessBins(bridge,ACP);
 await openFullscreen(page,bridge);
 await pickHarness(page,CODEX,'full');
 await back(page).click({noWaitAfter:true});
 // The picker saved codex as the default harness: the next new chat starts on it.
 await page.getByRole('button',{name:NEW_CHAT,exact:true}).first().click({noWaitAfter:true});
 await expect(chip(page)).toContainText('Codex · Change');
 await back(page).click({noWaitAfter:true});
 const newRows=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('New chat',{exact:true})});
 const openClaudeFromSearch=async()=>{
  await searchBox(page).fill('/harness Claude');
  await page.getByRole('button',{name:/^Claude Code, /}).first().click({noWaitAfter:true});
  await expect(chip(page)).toContainText('Claude Code · Change');
  await expect(composer(page)).toHaveValue('');
  await back(page).click({noWaitAfter:true});
  await searchBox(page).fill('');
  await page.getByRole('tab').nth(1).click({noWaitAfter:true});
  await expect(page.getByTestId('chats-pane')).toBeVisible();
 };
 await openClaudeFromSearch();
 await expect.poll(()=>newRows.count()).toBeGreaterThan(0);
 const firstIds=(await newRows.evaluateAll(els=>els.map(e=>e.getAttribute('data-testid')||''))).sort();
 await openClaudeFromSearch();
 const secondIds=(await newRows.evaluateAll(els=>els.map(e=>e.getAttribute('data-testid')||''))).sort();
 expect(secondIds,'second open reuses the empty Claude Code chat').toEqual(firstIds);
 // Opening the harness also saved it as the default.
 await page.getByRole('button',{name:NEW_CHAT,exact:true}).first().click({noWaitAfter:true});
 await expect(chip(page)).toContainText('Claude Code · Change');
});

test('harness error: a Claude Code fixture error shows on the reply and the composer is usable again',async({page,bridge})=>{
 await installHarnessBins(bridge,ACP);
 const wire=recordWire(page,bridge);
 await openWindow(page,bridge);await pickHarness(page,CLAUDE,'window');
 const failing='ARMY_ERROR claude harness failure';
 await send(page,failing);
 // Spec fix: bridge/src/acp/client.ts acpRequestFailure lets only a closed set of diagnostic templates cross onto the phone,
 // so the reply shows the templated ACP error and the agent's own message must not appear.
 await expect(page.getByText(/ACP request failed during session\/prompt \(code -32000\)/).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByText(/ARMY_EXPECTED_AGENT_ERROR/)).toHaveCount(0);
 const frame=await chatFrame(wire,'claude',failing);
 await expect.poll(()=>wire.got.some(f=>f.type==='error'&&f.id===frame.id)).toBe(true);
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
 await composer(page).fill('retry after claude error');
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText(/ARMY_REPLY: retry after claude error/).filter({visible:true}).first()).toBeVisible();
 await expectCompletedTurn(wire,'claude','retry after claude error');
});

test.describe('legacy CLI harnesses (pi, fx)',()=>{
 test('Settings in legacy CLI mode: pi and fx installed (ok dot), ACP-only codex and grok not found',async({page},info)=>{
  const {b,stop}=await startLegacyBridge(info);
  try{
   const wire=recordWire(page,b);
   await pair(page,b);
   await expect.poll(()=>wire.got.some(f=>Array.isArray(f.harnesses))).toBe(true);
   const listed=(wire.got.find(f=>Array.isArray(f.harnesses))?.harnesses as {id:string;available:boolean}[]);
   const expected=new Map(listed.map(h=>[h.id,h.available]));
   expect(expected.get('pi')).toBe(true);expect(expected.get('fx')).toBe(true);
   expect(expected.get('codex')).toBe(false);expect(expected.get('grok')).toBe(false);
   await expectSettingsHarnesses(page,expected);
  }finally{await stop();}
 });

 test('Pi: pick it, send, the reply streams from pi and completes; the next send resumes the Pi session; a pi failure is shown',async({page},info)=>{
  const {b,stop}=await startLegacyBridge(info);
  try{
   const wire=recordWire(page,b);
   await openWindow(page,b);await pickHarness(page,PI,'window');
   await sendAndExpectReply(page,'hello pi');
   const first=await expectCompletedTurn(wire,'pi','hello pi');
   expect(wire.got.some(f=>f.type==='session'&&f.id===first.id&&f.sessionId==='army-pi-session')).toBe(true);
   await expect.poll(async()=>(await calls(b)).some(c=>c.harness==='pi'&&c.cli==='pi'&&c.text==='hello pi'&&c.resumed===null)).toBe(true);
   await composer(page).fill('second pi turn');
   await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
   await expect(page.getByText(/ARMY_REPLY: second pi turn/).filter({visible:true}).first()).toBeVisible();
   const second=await expectCompletedTurn(wire,'pi','second pi turn');
   expect(second.sessionId).toBe('army-pi-session');
   await expect.poll(async()=>(await calls(b)).some(c=>c.harness==='pi'&&c.text==='second pi turn'&&c.resumed==='army-pi-session')).toBe(true);
   await send(page,'ARMY_ERROR pi failure');
   await expect(page.getByText(/ARMY_EXPECTED_CLI_ERROR/).filter({visible:true}).first()).toBeVisible();
   await composer(page).fill('pi after error');
   await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
  }finally{await stop();}
 });

 test('fx: pick it, send, the fixture reply arrives from fx and completes; an fx failure is shown and the composer recovers',async({page},info)=>{
  const {b,stop}=await startLegacyBridge(info);
  try{
   const wire=recordWire(page,b);
   await openWindow(page,b);await pickHarness(page,FX,'window');
   await sendAndExpectReply(page,'hello fx');
   const turn=await expectCompletedTurn(wire,'fx','hello fx');
   expect(wire.got.some(f=>f.type==='session'&&f.id===turn.id&&f.sessionId==='army-fx-session')).toBe(true);
   await expect.poll(async()=>(await calls(b)).some(c=>c.harness==='fx'&&c.cli==='fx'&&c.text==='hello fx')).toBe(true);
   await send(page,'ARMY_ERROR fx failure');
   await expect(page.getByText(/ARMY_EXPECTED_CLI_ERROR/).filter({visible:true}).first()).toBeVisible();
   await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
   await composer(page).fill('fx after error');
   await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
   await expect(page.getByText(/ARMY_REPLY: fx after error/).filter({visible:true}).first()).toBeVisible();
   const after=await expectCompletedTurn(wire,'fx','fx after error');
   expect(after.sessionId).toBe('army-fx-session');
  }finally{await stop();}
 });
});

test('Bots pane: tapping an installed harness opens a chat on it; an unavailable harness opens nothing',async({page,bridge})=>{
 await installHarnessBins(bridge,ACP);
 const host=(await rosterHosts(bridge)).id;
 const wire=recordWire(page,bridge);
 await pair(page,bridge);await openBots(page);
 // Unavailable (pi has no ACP adapter): openAgentConversation refuses, so no chat opens. Its
 // 'Session unavailable' Alert is native-only (react-native-web Alert.alert is a no-op).
 await revealTreeRow(page,host,`tree-row-${host}:new:harness:pi`);
 await page.getByTestId(`tree-row-${host}:new:harness:pi`).click({noWaitAfter:true});
 await expect(page.getByTestId(`tree-row-host:${host}`)).toBeVisible();
 await expect(chip(page)).toHaveCount(0);
 // Spec fix: composer(page) (role textbox 'Message') also matches the Main search bar; the chat composer is the 'composer-field' wrapper.
 await expect(page.getByTestId('composer-field')).toHaveCount(0);
 // Installed: the harness chat opens on Claude Code and a send reaches it with the roster target.
 await revealTreeRow(page,host,`tree-row-${host}:new:harness:claude`);
 await page.getByTestId(`tree-row-${host}:new:harness:claude`).click({noWaitAfter:true});
 await expect(chip(page)).toContainText('Claude Code · Change');
 await sendAndExpectReply(page,'hello from bots pane');
 const frame=await expectCompletedTurn(wire,'claude','hello from bots pane');
 expect(frame.profileId).toBe('harness:claude');
 expect(frame.hostId).toBe(host);
 // The refused pi tap never produced a turn.
 expect(wire.sent.some(f=>f.type==='chat'&&f.harness==='pi')).toBe(false);
});

test('persisted OMP session: the discoverable process is listed, opening loads history, a send continues the same session',async({page,bridge})=>{
 await installHarnessBins(bridge,ACP);
 const marker='ARMY_OMP_HISTORY_MARKER earlier prompt';
 await appendFile(join(bridge.dir,'.omp/agent/sessions/army-fixture/fixture_army-fixture-session.jsonl'),
  JSON.stringify({type:'message',id:'army-omp-hist-1',timestamp:'2026-10-27T00:00:00.000Z',message:{role:'user',content:[{type:'text',text:marker}]}})+'\n'+
  JSON.stringify({type:'message',id:'army-omp-hist-2',timestamp:'2026-10-27T00:00:01.000Z',message:{role:'assistant',content:[{type:'text',text:'ARMY_OMP_HISTORY_REPLY'}]}})+'\n');
 const self=await rosterHosts(bridge);
 const omp=self.agents.find(a=>a.kind==='omp'&&a.sessionId===SESSION);
 if(!omp)throw Error('fixture OMP process missing from roster');
 const wire=recordWire(page,bridge);
 await pair(page,bridge);await openBots(page);
 const row=await revealTreeRow(page,self.id,`tree-row-${self.id}:session:${omp.id}`);
 await row.click({noWaitAfter:true});
 await expect(chip(page)).toContainText('OMP · Change');
 await expect.poll(()=>wire.got.some(f=>f.type==='history'&&f.harness==='omp'&&f.sessionId===SESSION&&JSON.stringify(f.messages).includes(marker)),{timeout:30000,message:'history reply for the OMP session'}).toBe(true);
 await expect(page.getByText(marker).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByText('ARMY_OMP_HISTORY_REPLY').filter({visible:true}).first()).toBeVisible();
 await sendAndExpectReply(page,'continue omp session');
 const frame=await expectCompletedTurn(wire,'omp','continue omp session');
 expect(frame.sessionId).toBe(SESSION);
 expect(frame.profileId).toBe(omp.id);
 expect(wire.got.some(f=>f.type==='session'&&f.id===frame.id&&f.sessionId===SESSION)).toBe(true);
 await expect.poll(async()=>(await calls(bridge)).some(c=>c.harness==='omp'&&c.method==='session/load'&&c.sessionId===SESSION)).toBe(true);
});

test('persisted Hermes session: the SQLite row is listed, opening loads history, a send continues the same session',async({page,bridge})=>{
 await installHarnessBins(bridge,ACP);
 const marker='ARMY_HERMES_HISTORY_MARKER earlier question';
 const seed=spawnSync(bun,['-e',"const {Database}=require('bun:sqlite');const db=new Database(process.argv[1]);db.run('CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT,timestamp REAL,active INTEGER)');const q=db.query('INSERT INTO messages (session_id,role,content,timestamp,active) VALUES (?,?,?,?,1)');const t=Date.now()/1000-60;q.run(process.argv[2],'user',process.argv[3],t);q.run(process.argv[2],'assistant','ARMY_HERMES_HISTORY_REPLY',t+1);db.close();",join(bridge.dir,'.hermes/state.db'),SESSION,marker],{encoding:'utf8'});
 expect(seed.status,seed.stderr).toBe(0);
 const self=await rosterHosts(bridge);
 const hermes=self.agents.find(a=>a.kind==='hermes'&&a.sessionId===SESSION);
 if(!hermes)throw Error('fixture Hermes session missing from roster');
 const wire=recordWire(page,bridge);
 await pair(page,bridge);
 // Listed in Chats (host session row) and in the Bots tree.
 await expect(page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('ARMY native fixture')})).toHaveCount(1,{timeout:30000});
 await openBots(page);
 const row=await revealTreeRow(page,self.id,`tree-row-${self.id}:session:${hermes.id}`);
 await row.click({noWaitAfter:true});
 await expect(chip(page)).toContainText('Hermes · Change');
 await expect.poll(()=>wire.got.some(f=>f.type==='history'&&f.harness==='hermes'&&f.sessionId===SESSION&&JSON.stringify(f.messages).includes(marker)),{timeout:30000,message:'history reply for the Hermes session'}).toBe(true);
 await expect(page.getByText(marker).filter({visible:true}).first()).toBeVisible();
 await sendAndExpectReply(page,'continue hermes session');
 const frame=await expectCompletedTurn(wire,'hermes','continue hermes session');
 expect(frame.sessionId).toBe(SESSION);
 expect(wire.got.some(f=>f.type==='session'&&f.id===frame.id&&f.sessionId===SESSION)).toBe(true);
 await expect.poll(async()=>(await calls(bridge)).some(c=>c.harness==='hermes'&&c.method==='session/load'&&c.sessionId===SESSION)).toBe(true);
});
