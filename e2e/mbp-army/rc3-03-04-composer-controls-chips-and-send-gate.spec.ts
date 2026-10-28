// RC3 tester army, area 04: composer controls, chips and send gate.
// App + bridge under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc). Same isolated fixtures as army.spec.ts:
// real web export -> real per-test bridge -> scripted ACP fixture. No route mocks, no phone, no live services.
// Tests marked "RC3 ... expect FAIL at 2c948dc" target components that have no importer at that commit.
import {test,expect,pair,openChat,composer,chooseHarness,send,chatRow,createBridge,web,type Bridge} from './fixtures';
import {mkdtemp,readFile,writeFile,mkdir,chmod,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Page} from 'playwright/test';

// Spec fix: launchOptions must be file-level (forces a new worker); fake media flags are harmless for the rest of this file.
test.use({launchOptions:{args:[...(process.env.ARMY_HEADED==='1'?['--ozone-platform=wayland']:[]),'--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],slowMo:Number(process.env.ARMY_SLOWMO||30)}});
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

// ---------- helpers (local to this lane) ----------
const controls=(page:Page)=>page.getByTestId('composer-controls');
const primary=(page:Page,name:string)=>controls(page).getByRole('button',{name,exact:true});
const transcript=(page:Page)=>page.getByTestId('transcript-viewport');
async function rpcLog(b:Bridge):Promise<{method:string;text?:string}[]>{
 try{return (await readFile(join(b.dir,'army-rpc-methods.jsonl'),'utf8')).split('\n').filter(Boolean).map(l=>JSON.parse(l));}catch{return [];}
}
const promptsSent=async(b:Bridge)=>(await rpcLog(b)).filter(r=>r.method==='session/prompt').map(r=>r.text??'');
const ARMY_COMMANDS=[{name:'army-help',description:'ARMY fixture help command'},{name:'army-review',description:'ARMY fixture review command'}];
async function advertiseCommands(b:Bridge){await writeFile(join(b.dir,'army-commands.json'),JSON.stringify(ARMY_COMMANDS));}
const placeholder=(page:Page)=>composer(page).getAttribute('placeholder');
/** Kill the fixture-only discoverable OMP holder of this bridge (comm "omp", this HOME's agent dir): a live OMP session ends with its host process. */
async function killOmpHolder(b:Bridge):Promise<number>{
 const want='PI_CODING_AGENT_DIR='+join(b.dir,'.omp','agent');let killed=0;
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

// A bridge whose native Hermes context reader is a fixture script (DASH_HERMES_PYTHON is read by the real
// /chat/context route). No Hermes source, no owner home: it prints one deterministic snapshot with categories.
const SNAPSHOT={sessionId:'army-fixture-session',model:'army-fixture-model',provider:'army',used:42000,maximum:200000,threshold:160000,estimated:true,source:'ARMY fixture native snapshot',revision:'army-1',
 categories:[{id:'system',label:'System',tokens:12000,estimated:true,details:[{label:'ARMY system prompt',tokens:12000}]},{id:'tools',label:'Tools',tokens:8000,estimated:true,details:[]},{id:'messages',label:'Messages',tokens:22000,estimated:true,details:[]}],notes:['ARMY fixture snapshot']};
const ctxTest=test.extend({
 bridge: async({persistSession},use,testInfo)=>{
  const dir=await mkdtemp(join(process.env.ARMY_TMP||tmpdir(),'dash-army-ctx-'));
  const json=join(dir,'snapshot.json');await writeFile(json,JSON.stringify(SNAPSHOT));
  const script=join(dir,'fixture-python');await writeFile(script,"#!/bin/sh\nexec cat '"+json+"'\n");await chmod(script,0o700);
  const b=await createBridge(persistSession,{env:{DASH_HERMES_PYTHON:script}});
  try{await use(b);}finally{await b.stop();await writeFile(testInfo.outputPath('bridge.log'),b.logs());}
 },
});
ctxTest.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

// ---------- Send, placeholder, disabled ----------
test('04 type in Message and tap Send: user message lands and fixture reply streams',async({page,bridge})=>{
 await openChat(page,bridge);
 await expect(page.getByTestId('composer-field')).toBeVisible();
 await composer(page).fill('ARMY_SLOW composer send journey');
 await primary(page,'Send').click({noWaitAfter:true});
 await expect(transcript(page).getByText(/composer send journey/).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 await expect(primary(page,'Stop')).toBeVisible();
 await expect(page.getByText(/ARMY_REPLY: ARMY_SLOW composer send journey/).filter({visible:true}).first()).toBeVisible({timeout:18000});
 await expect(composer(page)).toHaveValue('');
 await expect.poll(()=>promptsSent(bridge)).toEqual(expect.arrayContaining([expect.stringContaining('composer send journey')]));
});

test('04 RC3 primary action carries testID composer-primary-action (expect FAIL at 2c948dc: ComposerPrimaryAction has no importer)',async({page,bridge})=>{
 await openChat(page,bridge);await composer(page).fill('primary action testID');
 const action=page.getByTestId('composer-primary-action');
 await expect(action).toBeVisible();
 await expect(action).toHaveAttribute('aria-label','Send');
});

test('04 placeholder reflects harness name, streaming, queued count and offline',async({page,bridge})=>{
 await openChat(page,bridge);
 await expect.poll(()=>placeholder(page)).toMatch(/^Message (\S.*|…)$/);
 await send(page,'ARMY_SLOW placeholder streaming');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 await expect.poll(()=>placeholder(page)).toBe('Queue next message…');
 await composer(page).fill('placeholder queued one');
 await primary(page,'Queue').click({noWaitAfter:true});
 await expect.poll(()=>placeholder(page)).toBe('Queue another (1)…');
 await expect(page.getByText(/ARMY_REPLY: placeholder queued one/).filter({visible:true}).first()).toBeVisible({timeout:30000});
 await expect.poll(()=>placeholder(page),{timeout:15000}).toMatch(/^Message /);
 await bridge.stop();
 await expect.poll(()=>placeholder(page),{timeout:20000}).toBe('Waiting for the bridge…');
});

test('04 placeholder names Hermes after switching harness',async({page,bridge})=>{
 await openChat(page,bridge);await chooseHarness(page,'Hermes');
 await expect.poll(()=>placeholder(page)).toMatch(/^Message Hermes|^Message…$/);
});

test('04 composer offline: a text Send queues in the outbox, Attach stays blocked, nothing reaches the agent until the bridge returns',async({page,bridge})=>{
 await openChat(page,bridge);
 await bridge.stop();
 await expect(page.getByText(/tap to retry|Connecting to bridge|Offline|Disconnected/i).filter({visible:true}).first()).toBeVisible({timeout:20000});
 await composer(page).fill('offline queued send');
 // Delivery outbox (COV-G04): text-only Send is accepted offline and kept on the phone.
 await expect(primary(page,'Send')).toBeEnabled();
 await expect(page.getByRole('button',{name:'Attach file',exact:true})).toBeDisabled();
 await primary(page,'Send').click({noWaitAfter:true});
 await expect(composer(page)).toHaveValue('');
 expect(await promptsSent(bridge),'nothing reaches the agent while the bridge is down').not.toEqual(expect.arrayContaining([expect.stringContaining('offline queued send')]));
 await bridge.start();
 await expect.poll(async()=>(await promptsSent(bridge)).filter(t=>t.includes('offline queued send')).length,{timeout:30000,message:'delivered once after the bridge returns'}).toBe(1);
});

// Open-in placeholder + target error. The fixture-only OMP holder process (same PID namespace as the
// bridge) is recorded as the live CLI owner of the fixture Hermes session, which is how the real bridge
// derives openIn. Spec fix: a self-host Hermes session resumes by session id and needs no roster row
// (app/src/lib/live-sessions.ts resumableWithoutRoster), so hiding its native row is NOT a target error.
// A live OMP session does end with its host process (omp: profiles are the documented exception), so the
// target-error half ends the fixture OMP holder and opens that live OMP chat instead.
test('04 open-in host placeholder, then target error disables the composer',async({page,bridge})=>{
 const pid=Number((await readFile(join(bridge.dir,'.omp/agent/army-holder.pid'),'utf8')).trim());
 expect(pid).toBeGreaterThan(0);
 await mkdir(join(bridge.dir,'.hermes/runtime'),{recursive:true});
 await writeFile(join(bridge.dir,'.hermes/runtime/active_sessions.json'),JSON.stringify({entries:[{session_id:'army-fixture-session',pid,surface:'cli'}]}));
 await pair(page,bridge);
 const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('ARMY native fixture',{exact:true})});
 await expect(row.first()).toBeVisible({timeout:45000});
 await row.first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await expect.poll(()=>placeholder(page),{timeout:30000}).toBe('Reply to session…');
 // Target error: a live OMP chat ends when the host stops listing it. Back to the list, open the live OMP row, then end the holder.
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 const live=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByLabel('Live on host',{exact:true})}).first();
 await expect(live).toBeVisible({timeout:30000});
 await live.click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await expect(page.getByRole('button',{name:'Attach file',exact:true})).toBeEnabled();
 expect(await killOmpHolder(bridge)).toBeGreaterThan(0);
 await expect(page.getByRole('alert').filter({hasText:'This chat has ended on the host. Its saved history is still on this phone.'}).first()).toBeVisible({timeout:45000});
 await composer(page).fill('target error blocked send');
 await expect(primary(page,'Send')).toBeDisabled();
 await expect(page.getByRole('button',{name:'Attach file',exact:true})).toBeDisabled();
});

// ---------- Queue / Stop / Steer mode ----------
test('04 streaming without steer: primary is Queue and the message is queued, not sent',async({page,bridge})=>{
 await openChat(page,bridge);await send(page,'ARMY_SLOW queue gate first');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 await composer(page).fill('queue gate second');
 await expect(primary(page,'Queue')).toBeEnabled();
 await primary(page,'Queue').click({noWaitAfter:true});
 await expect(page.getByRole('button',{name:'1 queued',exact:true})).toBeVisible();
 await expect(composer(page)).toHaveValue('');
 await expect(primary(page,'Stop')).toBeVisible();
 // Still running: the queued text must not have reached the agent yet.
 expect(await promptsSent(bridge)).not.toEqual(expect.arrayContaining([expect.stringContaining('queue gate second')]));
 await expect(page.getByText(/ARMY_REPLY: ARMY_SLOW queue gate first/).filter({visible:true}).first()).toBeVisible({timeout:18000});
 await expect(page.getByText(/ARMY_REPLY: queue gate second/).filter({visible:true}).first()).toBeVisible({timeout:18000});
});

test('04 streaming with empty draft: Stop sends a cancel and streaming stops',async({page,bridge})=>{
 await openChat(page,bridge);await send(page,'ARMY_HANG stop gate');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 await expect(composer(page)).toHaveValue('');
 await primary(page,'Stop').click({noWaitAfter:true});
 await expect.poll(async()=>(await rpcLog(bridge)).some(r=>r.method==='session/cancel'),{timeout:15000,message:'session/cancel must reach the ACP agent'}).toBe(true);
 await expect(primary(page,'Stop')).toHaveCount(0);
 await expect(primary(page,'Send')).toBeVisible();
});

test('04 steerable Hermes turn: mode row toggles Steer/Queue and the next send uses that mode',async({page,bridge})=>{
 await openChat(page,bridge);await chooseHarness(page,'Hermes');
 await send(page,'ARMY_HANG steer mode target');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByText('Steer the running turn',{exact:true})).toBeVisible();
 const toQueue=page.getByRole('button',{name:'Choose Queue for next turn',exact:true});
 await expect(toQueue).toBeVisible();
 await composer(page).fill('mode toggle queued');
 await expect(primary(page,'Steer')).toBeVisible();
 await toQueue.click({noWaitAfter:true});
 await expect(page.getByText('Queue for next turn',{exact:true})).toBeVisible();
 await expect(primary(page,'Queue')).toBeVisible();
 await primary(page,'Queue').click({noWaitAfter:true});
 await expect(page.getByRole('button',{name:'1 queued',exact:true})).toBeVisible();
 expect(await promptsSent(bridge)).not.toEqual(expect.arrayContaining([expect.stringContaining('mode toggle queued')]));
 const toSteer=page.getByRole('button',{name:'Choose Steer the running turn',exact:true});
 await expect(toSteer).toBeVisible();
 await toSteer.click({noWaitAfter:true});
 await expect(page.getByText('Steer the running turn',{exact:true})).toBeVisible();
 await composer(page).fill('mode toggle steer');
 await expect(primary(page,'Steer')).toBeVisible();
 await primary(page,'Steer').click({noWaitAfter:true});
 // Steer path: delivered or visibly rejected, and never silently added to the queue.
 await expect(page.getByText(/Steering is|steer.*(unavailable|unsupported|not supported)|Steer.*(unavailable|unsupported)|Delivery failed|Could not steer|No native API|No live|Steered/i).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'2 queued',exact:true})).toHaveCount(0);
});

// ---------- Draft persistence ----------
test('04 draft persists across navigating to another tab and back to the same chat',async({page,bridge})=>{
 await openChat(page,bridge);
 const draft='composer lane draft survives tab hop';
 await composer(page).fill(draft);
 await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});
 await page.getByRole('tab').nth(0).click({noWaitAfter:true});
 await expect(page.getByRole('tab').nth(0)).toHaveAttribute('aria-selected','true');
 await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 await chatRow(page).click({noWaitAfter:true});
 await expect(composer(page)).toHaveValue(draft);
});

// ---------- Slash / mention suggestions ----------
test('04 slash: harness commands listed, tap inserts, no match shows the empty copy',async({page,bridge})=>{
 await advertiseCommands(bridge);
 await openChat(page,bridge);
 await composer(page).fill('/');
 const panel=page.getByLabel('Composer suggestions',{exact:true});
 await expect(panel).toBeVisible();
 await expect(panel.getByText(/^\S+ commands$/)).toBeVisible();
 await expect(panel.getByRole('button',{name:'/army-help',exact:true})).toBeVisible({timeout:25000});
 await expect(panel.getByRole('button',{name:'/army-review',exact:true})).toBeVisible();
 await panel.getByRole('button',{name:'/army-review',exact:true}).click({noWaitAfter:true});
 await expect(composer(page)).toHaveValue('/army-review ');
 await composer(page).fill('/zzzarmynomatch');
 await expect(page.getByText('No matching commands advertised by this harness.',{exact:true})).toBeVisible();
});

test('04 slash /u shows /usage row and tapping it opens the /usage card',async({page,bridge})=>{
 await openChat(page,bridge);
 await composer(page).fill('/u');
 const usage=page.getByRole('button',{name:'/usage',exact:true});
 await expect(usage).toBeVisible();
 await expect(page.getByText('This chat’s context and account quotas',{exact:true})).toBeVisible();
 await usage.click({noWaitAfter:true});
 const card=page.getByLabel('Usage details',{exact:true});
 await expect(card).toBeVisible();
 await expect(card.getByText('/usage',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close usage details',exact:true}).click({noWaitAfter:true});
 await expect(card).toHaveCount(0);
});

test('04 mention: @ lists workspace files and tapping one inserts the mention',async({page,bridge})=>{
 // Make the bridge working directory a Git workspace holding exactly one mentionable file.
 await writeFile(join(bridge.dir,'.gitignore'),'/*\n!/.gitignore\n!/army-mention-target.md\n');
 await writeFile(join(bridge.dir,'army-mention-target.md'),'ARMY mention fixture\n');
 const init=spawnSync('git',['init','-q'],{cwd:bridge.dir,encoding:'utf8'});expect(init.status,init.stderr).toBe(0);
 await openChat(page,bridge);
 await composer(page).fill('@army-mention');
 const panel=page.getByLabel('Composer suggestions',{exact:true});
 await expect(panel.getByText('Mention a file, session, bot or agent',{exact:true})).toBeVisible();
 const rowButton=panel.getByRole('button',{name:'@army-mention-target.md',exact:true});
 await expect(rowButton).toBeVisible({timeout:25000});
 await rowButton.click({noWaitAfter:true});
 await expect(composer(page)).toHaveValue('@army-mention-target.md ');
});

test('04 mention: a suggestion load failure shows a warning with Retry loading suggestions',async({page,bridge})=>{
 // Bridge cwd is not a Git workspace: the real /suggestions route reports the file listing failure.
 await openChat(page,bridge);
 await composer(page).fill('@');
 const panel=page.getByLabel('Composer suggestions',{exact:true});
 await expect(panel.getByText('Mention a file, session, bot or agent',{exact:true})).toBeVisible();
 await expect(panel.getByRole('alert').first()).toBeVisible({timeout:25000});
 const retry=panel.getByRole('button',{name:'Retry loading suggestions',exact:true});
 await expect(retry).toBeVisible();
 const again=page.waitForRequest(r=>r.url().startsWith(`http://127.0.0.1:${bridge.port}/suggestions`),{timeout:15000});
 await retry.click({noWaitAfter:true});
 await again;
});

// ---------- Context window chip / card ----------
ctxTest('04 context chip opens card with segments + legend; legend highlights; compaction state; dismiss and close',async({page,bridge})=>{
 await openChat(page,bridge);await chooseHarness(page,'Hermes');
 await send(page,'context chip journey');
 await expect(page.getByText(/ARMY_REPLY: context chip journey/).filter({visible:true}).first()).toBeVisible();
 const gauge=page.getByRole('button',{name:/^Context window,/});
 await expect(gauge).toHaveAttribute('aria-label',/approximately 21 percent/,{timeout:45000});
 await gauge.click({noWaitAfter:true});
 const card=page.getByLabel('Context window details',{exact:true});
 await expect(card).toBeVisible();
 await expect(card.getByText('Model · army-fixture-model',{exact:true})).toBeVisible();
 // The grid is one image (the cells are unlabelled SVG rects); each category segment is a legend button named "<Label>, estimated <tokens> tokens, <pct>".
 await expect(card.getByRole('img',{name:'Context grid',exact:true})).toBeAttached();
 for(const name of ['System','Tools','Messages']) await expect(card.getByRole('button',{name:new RegExp('^'+name+', estimated \\d')})).toBeVisible();
 const legend=card.getByRole('button',{name:/^System, /});
 await expect(legend).toBeVisible();
 await legend.click({noWaitAfter:true});
 await expect(card.getByText('ARMY system prompt',{exact:true})).toBeVisible();
 await expect(card.getByRole('button',{name:/^Tools, /})).toHaveCSS('opacity','0.4');
 // Compaction: either an enabled Compact now, or the explicit unavailable control (bridge without compaction).
 const compact=card.getByRole('button',{name:'Compact now',exact:true});
 const unavailable=card.getByRole('button',{name:'Compaction unavailable on this host',exact:true});
 await expect(compact.or(unavailable)).toBeVisible();
 if(await compact.count()){await compact.click({noWaitAfter:true});await expect(card.getByRole('alert').last()).toBeVisible({timeout:30000});}
 else await expect(unavailable).toBeDisabled();
 await page.getByRole('button',{name:'Dismiss usage details',exact:true}).click({position:{x:4,y:4},noWaitAfter:true});
 await expect(card).toHaveCount(0);
 await gauge.click({noWaitAfter:true});await expect(card).toBeVisible();
 await page.getByRole('button',{name:'Close usage details',exact:true}).click({noWaitAfter:true});
 await expect(card).toHaveCount(0);
});

ctxTest('04 RC3 #396 model chip shows the host-reported model (expect FAIL at 2c948dc: ComposerStatChips not mounted)',async({page,bridge})=>{
 await openChat(page,bridge);await chooseHarness(page,'Hermes');
 await send(page,'ARMY_SLOW model chip journey');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 await expect(page.getByTestId('composer-stat-chips')).toBeVisible({timeout:20000});
 await expect(page.getByTestId('composer-stat-model')).toContainText('army-fixture-model',{timeout:45000});
});

// ---------- Attachments ----------
test('04 Attach file opens the chooser; Cancel closes it with nothing attached',async({page,bridge})=>{
 await openChat(page,bridge);
 await page.getByRole('button',{name:'Attach file',exact:true}).click({noWaitAfter:true});
 const sheet=page.getByTestId('attachment-sheet');
 await expect(sheet).toBeVisible();
 for(const name of ['Photos','Files','Cancel attachment']) await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel attachment',exact:true}).click({noWaitAfter:true});
 await expect(sheet).toHaveCount(0);
 await expect(page.getByLabel('Attachments',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:/^Remove /})).toHaveCount(0);
});

async function attachFiles(page:Page,files:{name:string;mimeType:string;buffer:Buffer}[]){
 await page.getByRole('button',{name:'Attach file',exact:true}).click({noWaitAfter:true});
 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'Files',exact:true}).click({noWaitAfter:true});
 await (await chooser).setFiles(files);
}
const fileOf=(name:string)=>({name,mimeType:'text/plain',buffer:Buffer.from('ARMY '+name+'\n')});

test('04 attached file shows a draft chip with name and meta; Remove clears it',async({page,bridge})=>{
 await openChat(page,bridge);
 await attachFiles(page,[fileOf('army-chip.txt')]);
 const chip=page.getByLabel(/^army-chip\.txt, /);
 await expect(chip).toBeVisible();
 await expect(chip).toHaveAttribute('aria-label',/^army-chip\.txt, (Uploading…|\d.*B)$/);
 await expect(chip).toHaveAttribute('aria-label',/^army-chip\.txt, \d.*B$/,{timeout:15000});
 await page.getByRole('button',{name:'Remove army-chip.txt',exact:true}).click({noWaitAfter:true});
 await expect(chip).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Remove army-chip.txt',exact:true})).toHaveCount(0);
});

test('04 attachments are capped at MAX_ATTACHMENTS_PER_TURN (8): extra files are not added',async({page,bridge})=>{
 await openChat(page,bridge);
 // Nine picked in one go: the picker result is trimmed to the eight remaining slots.
 await attachFiles(page,Array.from({length:9},(_,i)=>fileOf(`army-cap-${i}.txt`)));
 await expect(page.getByRole('button',{name:/^Remove army-cap-/})).toHaveCount(8);
 // Full draft: Files must not open another OS picker (the app raises its 'Up to 8 files per message.' notice instead).
 await page.getByRole('button',{name:'Attach file',exact:true}).click({noWaitAfter:true});
 const chooser=page.waitForEvent('filechooser',{timeout:3000}).then(()=>true,()=>false);
 await page.getByRole('button',{name:'Files',exact:true}).click({noWaitAfter:true});
 expect(await chooser).toBe(false);
 await expect(page.getByRole('button',{name:/^Remove army-cap-/})).toHaveCount(8);
});

// ---------- Mic / dictation ----------
test.describe('dictation with a fake capture device',()=>{
 test('04 mic tap starts dictation (Stop dictation), and a transcription error shows Retry dictation',async({page,context,bridge})=>{
  await context.grantPermissions(['microphone'],{origin:web});
  await openChat(page,bridge);
  const mic=controls(page).getByRole('button',{name:'Dictate',exact:true});
  await expect(mic).toBeVisible();
  await mic.click({noWaitAfter:true});
  await expect(page.getByRole('button',{name:'Stop dictation',exact:true}).first()).toBeVisible({timeout:20000});
  await expect(page.getByText(/Preparing microphone…|Listening · tap Stop when finished/).filter({visible:true}).first()).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button',{name:'Stop dictation',exact:true}).first().click({noWaitAfter:true});
  // The isolated bridge has no speech model (DASH_STT_MODEL points at a missing file): transcription must fail visibly.
  await expect(page.getByRole('button',{name:'Retry dictation',exact:true})).toBeVisible({timeout:45000});
  await expect(page.getByRole('alert').filter({hasNotText:/^$/}).first()).toBeVisible();
 });
});

test('04 mic hold and slide up switches the mic to Live voice',async({page,bridge})=>{
 await openChat(page,bridge);
 const mic=controls(page).getByRole('button',{name:'Dictate',exact:true});
 const box=await mic.boundingBox();if(!box)throw Error('mic has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.waitForTimeout(450);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2-60,{steps:8});await page.mouse.up();
 await expect(controls(page).getByRole('button',{name:'Live voice',exact:true})).toBeVisible();
});

// Feature list: "Long-press the mic: thumb side switches hands." At 2c948dc the mic hold switches Dictate/Live voice
// and handedness toggles from the search bar; this asserts the listed behavior and is expected to FAIL if unchanged.
test('04 mic long-press switches the thumb side (handedness)',async({page,bridge})=>{
 await openChat(page,bridge);
 const before=await page.evaluate(()=>{try{return JSON.parse(localStorage.getItem('dash.settings.v1')||'{}').handedness??null;}catch{return null;}});
 const mic=controls(page).getByRole('button',{name:'Dictate',exact:true});
 const box=await mic.boundingBox();if(!box)throw Error('mic has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.waitForTimeout(700);await page.mouse.up();
 await expect.poll(()=>page.evaluate(()=>{try{return JSON.parse(localStorage.getItem('dash.settings.v1')||'{}').handedness??null;}catch{return null;}}),{timeout:5000}).not.toBe(before);
});

// ---------- RC3 chips + bedtime gate (expected FAIL at 2c948dc) ----------
test('04 RC3 #396/#416 tok/s chip in the reserved rate slot while streaming (expect FAIL at 2c948dc: not mounted)',async({page,bridge})=>{
 await openChat(page,bridge);
 await send(page,'ARMY_SLOW ARMY_TOKENS rate chip journey');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 const slot=page.getByTestId('composer-stat-rate-slot');
 await expect(slot).toBeVisible();
 await expect(page.getByTestId('composer-stat-rate')).toHaveCount(0);
 await expect(page.getByTestId('composer-stat-rate')).toHaveText(/^≈?\d+(\.\d+)? tok\/s$/,{timeout:15000});
});

test('04 RC3 #417/#413 bedtime capture mode gates Send into the overnight queue (expect FAIL at 2c948dc: capture-gate has no importer)',async({page,bridge})=>{
 const bedtime=new Date();bedtime.setHours(1,30,0,0);
 await page.clock.install({time:bedtime});await page.clock.resume();
 await openChat(page,bridge);
 await composer(page).fill('bedtime capture journey');
 await expect(primary(page,'Save for tomorrow')).toBeVisible();
 await primary(page,'Save for tomorrow').click({noWaitAfter:true});
 await expect(page.getByText(/Capture-only mode|Saved for tomorrow|overnight|Capture a thought for tomorrow/i).filter({visible:true}).first()).toBeVisible();
 await page.waitForTimeout(1500);
 expect(await promptsSent(bridge)).not.toEqual(expect.arrayContaining([expect.stringContaining('bedtime capture journey')]));
});
