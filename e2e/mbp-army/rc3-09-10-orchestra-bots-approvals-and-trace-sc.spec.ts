// RC3 tester army, area 10: Orchestra, Bots, Approvals and Trace screens.
// Same isolated fixtures as army.spec.ts: real web export, real isolated bridge, scripted ACP agent.
// Selectors come from kvnloo/dash integ/rc3-20261027 (written against 2c948dc) (IntentionalOrchestra.tsx, OrchestraPane.tsx,
// OrchestraDetailScreen.tsx, NeedsKevin.tsx, ApprovalsScreen.tsx, TraceScreen.tsx, trace/TraceTimeline.tsx,
// trace/TraceDetail.tsx, trace/ActionChip.tsx, trace/TraceEntryCard.tsx, LabScreen.tsx).
// Evidence is real: /orchestra/graph reads native Hermes rows seeded by rc3-09-10-seed.ts into the isolated
// HOME; Approvals reads and writes the real GateStore journal; /supervision reads a fixture batch directory.
// External GitHub navigation is answered by a local stub page so no test leaves the machine.
import {test,expect,web,createBridge,type Bridge,bun,bridgeRoot} from './fixtures';
import type {Page,Locator,BrowserContext} from 'playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';

const seedScript=join(__dirname,'rc3-09-10-seed.ts');
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const btn=(scope:Page|Locator,name:string|RegExp)=>scope.getByRole('button',typeof name==='string'?{name,exact:true}:{name});
const esc=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const composer=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
/** An Orchestra node card: InteractiveTile label is "<label>. <kind>: <label>, <state>. <reason>." */
const card=(page:Page,label:string)=>page.getByRole('button',{name:new RegExp('^'+esc(label)+'\\. (chat|subagent|repo|host): ')});
const sheet=(page:Page)=>page.getByLabel('Node details',{exact:true});
const graph=(page:Page)=>page.getByTestId('orchestra-graph');

function seed(mode:'orchestra'|'gate'|'supervision',dir:string,extra?:string){
 execFileSync(bun,[seedScript,mode,dir,...(extra?[extra]:[])],{env:{...process.env,ARMY_BRIDGE_ROOT:bridgeRoot},stdio:['ignore','pipe','pipe']});
}
/** Native Hermes rows are indexed at bridge boot, so seed with the isolated bridge stopped (same port after restart). */
async function seedOrchestra(b:Bridge){await b.stop();seed('orchestra',b.dir);await b.start();}

/** Pair and stay on Main: the cold app opens Orchestra. */
async function pairCold(page:Page,b:Bridge){
 await page.goto(web,{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('100.64.0.1',{exact:true}).waitFor({timeout:120000});
 await page.getByPlaceholder('100.64.0.1',{exact:true}).fill('127.0.0.1:'+b.port);
 await page.getByLabel('Bootstrap token',{exact:true}).fill(b.bootstrap);
 await btn(page,'Pair over Tailscale').click({noWaitAfter:true});
 await expect(page.getByRole('tab',{name:'Orchestra',exact:true})).toBeVisible({timeout:25000});
 await expect(graph(page)).toBeVisible({timeout:25000});
}
async function mode(page:Page,name:'Fleet'|'Lineage'|'Work'|'Triage'){
 await btn(graph(page),name).click({noWaitAfter:true});
 // Spec fix: RN Web drops accessibilityState.selected; the callers assert the switched view content.
}
/** Work view with the seeded native rows loaded from /orchestra/graph (not the roster-only fallback). */
async function workView(page:Page){
 await mode(page,'Work');
 await expect(card(page,'ARMY parent orchestrator')).toBeVisible({timeout:40000});
}
async function hold(page:Page,target:Locator,ms=900){
 await target.scrollIntoViewIfNeeded();
 const box=await target.boundingBox();if(!box)throw Error('hold target has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
 await page.waitForTimeout(ms);await page.mouse.up();
}
const opacity=(l:Locator)=>l.evaluate(el=>Number(getComputedStyle(el).opacity));
/** Answer github.com navigation locally: the assertion is the URL Dash asked to open. */
async function stubGithub(context:BrowserContext){
 await context.route(/^https:\/\/github\.com\//,r=>r.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>army github stub</title>'}));
}
async function popupUrl(page:Page,open:()=>Promise<unknown>){
 const popup=page.context().waitForEvent('page',{timeout:15000});
 await open();
 const p=await popup;
 await expect.poll(()=>p.url(),{timeout:15000}).toMatch(/^https:\/\/github\.com\//);
 const url=p.url();await p.close();return url;
}

/* ------------------------------------------------------------------ Orchestra */

test.describe('rc3 10 orchestra graph',()=>{
 test('graph renders with mode tabs; each tab switches the view (Fleet telemetry, Lineage tree, Work hubs, Triage lanes)',async({page,bridge})=>{
  await seedOrchestra(bridge);await pairCold(page,bridge);
  await expect(graph(page).getByText(/Read-only host evidence · last 24h · Tap a label to inspect/)).toBeVisible();
  for(const t of ['Fleet','Lineage','Work','Triage'])await expect(btn(graph(page),t)).toBeVisible();
  await workView(page);
  await expect(graph(page).getByText(/^\d+ W1 collisions · \d+ live sessions changing worktrees$/)).toBeVisible();
  await expect(card(page,'army-repo')).toBeVisible();
  await expect(graph(page).getByText(/^\d+ live$/)).toHaveCount(0);
  await mode(page,'Fleet');
  // Fleet header: one telemetry row per host with its live count and health/reason line.
  await expect(graph(page).getByText(/^\d+ live$/).filter({visible:true}).first()).toBeVisible();
  await expect(graph(page).getByText(/Online · bridge roster/).filter({visible:true}).first()).toBeVisible();
  await expect(graph(page).getByText(/W1 collisions/)).toHaveCount(0);
  await mode(page,'Lineage');
  await expect(graph(page).getByText(/^Delegation tree · \d+ recorded links$/)).toBeVisible();
  await expect(graph(page).getByText('ARMY delegated child').filter({visible:true}).first()).toBeVisible();
  // Spec fix: since RC3 (dca0dc3) the Triage tab is LiveTriageList over GET /triage (owner-needed items, board blockers, roadmap asks),
  // not the five node lanes. Feed it a real supervision batch in this bridge's DASH_SUPERVISION_DIR; the Kanban board file does not exist here.
  seed('supervision',join(bridge.dir,'.local/state/dash/supervision'),'2');
  await mode(page,'Triage');
  await expect(graph(page).getByText('Live priority sources · source ages shown · Tap a label to inspect',{exact:true})).toBeVisible();
  await expect(graph(page).getByText('What needs you, in priority order',{exact:true})).toBeVisible();
  const list=graph(page).getByTestId('live-triage-list');
  for(const n of [1,2]){
   const item=list.getByTestId('triage-item-owner:army-kevin-'+n);
   await expect(item).toContainText('ARMY_KEVIN_GOAL_'+n);
   await expect(item).toContainText(/Needs you · P0 · \d+[sm] ago/);
   await expect(item).toContainText('Worker supervision');
  }
  await expect(graph(page).getByText('Work board unavailable',{exact:true})).toBeVisible();
  await expect(graph(page).getByText(/^Needs you \d+ → /)).toHaveCount(0);
 });

 test('tap a node: Node details shows label, kind/state/harness/model, reason, action, path, parent, children; Close closes',async({page,bridge})=>{
  await seedOrchestra(bridge);await pairCold(page,bridge);await workView(page);
  await card(page,'ARMY delegated child').click({noWaitAfter:true});
  const s=sheet(page);await expect(s).toBeVisible();
  await expect(s).toContainText('ARMY delegated child');
  await expect(s).toContainText('subagent · idle · hermes · army-model-child');
  await expect(s).toContainText('Terminal phase: idle');
  await expect(s).toContainText('→ Open chat when ready');
  await expect(s).toContainText(bridge.dir+'/army-repo · army-main');
  await expect(s).toContainText('Parent: ARMY parent orchestrator');
  await expect(s).toContainText('Children: None recorded');
  // A delegated worker is not a roster chat: no Open chat, and no PR path.
  await expect(s.getByText('Open chat',{exact:true})).toHaveCount(0);
  await expect(s.getByText('Open PR',{exact:true})).toHaveCount(0);
  await s.getByText('Close',{exact:true}).click({noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
  await card(page,'ARMY parent orchestrator').click({noWaitAfter:true});
  await expect(sheet(page)).toContainText('chat · idle · hermes · army-model-parent');
  await expect(sheet(page)).toContainText('Parent: None recorded');
  await expect(sheet(page)).toContainText('Children: ARMY delegated child');
  await sheet(page).getByText('Close',{exact:true}).click({noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
 });

 test('Node details Open chat opens that native session chat',async({page,bridge})=>{
  await seedOrchestra(bridge);await pairCold(page,bridge);await workView(page);
  await card(page,'ARMY parent orchestrator').click({noWaitAfter:true});
  const open=sheet(page).getByText('Open chat',{exact:true});
  await expect(open).toBeVisible();
  await open.click({noWaitAfter:true});
  await expect(composer(page)).toBeVisible({timeout:20000});
  await expect(page.getByText('ARMY parent orchestrator').filter({visible:true}).first()).toBeVisible();
  await expect(graph(page)).toBeHidden();
 });

 test('Node details Open PR opens the GitHub pull request',async({page,bridge})=>{
  await stubGithub(page.context());
  await seedOrchestra(bridge);await pairCold(page,bridge);await workView(page);
  await card(page,'ARMY PR worker').click({noWaitAfter:true});
  await expect(sheet(page)).toContainText('https://github.com/example/army-fixture/pull/7');
  const url=await popupUrl(page,()=>sheet(page).getByText('Open PR',{exact:true}).click({noWaitAfter:true}));
  expect(url).toBe('https://github.com/example/army-fixture/pull/7');
  await expect(sheet(page)).toBeVisible();
 });

 test('legend: tap highlights a kind, hold shows only that kind, tap again clears',async({page,bridge})=>{
  await seedOrchestra(bridge);await pairCold(page,bridge);await workView(page);
  const legend=page.getByLabel('Graph legend. Tap to highlight, hold to show only.',{exact:true});
  await expect(legend).toBeVisible();
  const sub=btn(legend,'Legend subagent');
  await expect(sub).toBeVisible();await expect(btn(legend,'Legend chat')).toBeVisible();await expect(btn(legend,'Legend repo')).toBeVisible();
  const parent=card(page,'ARMY parent orchestrator'),child=card(page,'ARMY delegated child');
  await expect.poll(()=>opacity(parent)).toBeGreaterThan(0.9);
  await sub.click({noWaitAfter:true});
  // Highlight: non-subagent cards dim to 0.4, the subagent stays full strength; nothing is removed.
  await expect.poll(()=>opacity(parent)).toBeLessThan(0.6);
  await expect.poll(()=>opacity(child)).toBeGreaterThan(0.9);
  await expect(parent).toBeVisible();
  await hold(page,sub);
  // Show only: the graph is projected to subagents.
  await expect(parent).toHaveCount(0);
  await expect(card(page,'ARMY spoke 01')).toHaveCount(0);
  await expect(child).toBeVisible();
  await sub.click({noWaitAfter:true});
  await expect(parent).toBeVisible();
  await expect.poll(()=>opacity(parent)).toBeGreaterThan(0.9);
 });

 test('footer Focus toggle filters to the focused subtree; All restores',async({page,bridge})=>{
  await seedOrchestra(bridge);await pairCold(page,bridge);await workView(page);
  const spokes=page.getByRole('button',{name:/^ARMY spoke \d\d\. /});
  await expect(spokes.first()).toBeVisible();
  const before=await spokes.count();expect(before).toBeGreaterThan(0);
  await card(page,'ARMY delegated child').click({noWaitAfter:true});
  await expect(sheet(page)).toBeVisible();
  await graph(page).getByText('Focus',{exact:true}).click({noWaitAfter:true});
  await expect(graph(page).getByText('All',{exact:true})).toBeVisible();
  await expect(spokes).toHaveCount(0);
  await expect(card(page,'ARMY parent orchestrator')).toHaveCount(0);
  await expect(card(page,'ARMY delegated child')).toBeVisible();
  await expect(card(page,'army-repo')).toBeVisible();
  await graph(page).getByText('All',{exact:true}).click({noWaitAfter:true});
  await expect(graph(page).getByText('Focus',{exact:true})).toBeVisible();
  await expect(spokes).toHaveCount(before);
  await graph(page).getByText('Reset',{exact:true}).click({noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
 });

 test('hub: Show more expands spokes beyond the cap; Show fewer collapses',async({page,bridge})=>{
  await seedOrchestra(bridge);await pairCold(page,bridge);await workView(page);
  const spokes=page.getByRole('button',{name:/^ARMY spoke \d\d\. /});
  await expect(spokes.first()).toBeVisible();
  const capped=await spokes.count();
  expect(capped).toBeLessThan(13);
  const more=btn(page,/^Show \d+ more sessions on army-repo$/);
  await expect(more).toBeVisible();
  const hidden=Number(/Show (\d+) more/.exec(await more.getAttribute('aria-label')??'')?.[1]);
  expect(hidden).toBeGreaterThan(0);
  await more.click({noWaitAfter:true});
  await expect(spokes).toHaveCount(13);
  expect(13-capped).toBe(hidden);
  const fewer=btn(page,'Show fewer sessions on army-repo');
  await expect(fewer).toBeVisible();
  await fewer.click({noWaitAfter:true});
  await expect(spokes).toHaveCount(capped);
  await expect(btn(page,/^Show \d+ more sessions on army-repo$/)).toBeVisible();
 });
});

/* ---------------------------------------------------------- OrchestraDetail */

test.describe('rc3 10 orchestra detail (product)',()=>{
 test('product opens OrchestraDetail "<project> · <state>"; Open <profile> opens a chat; the linked chat item opens it',async({page,bridge})=>{
  await pairCold(page,bridge);
  const project=basename(bridge.dir);
  const openDetail=async()=>{
   await composer(page).fill('@product '+project);
   const row=btn(page,new RegExp('^'+esc(project)+', Product'));
   await expect(row).toBeVisible({timeout:30000});
   await row.click({noWaitAfter:true});
   await expect(page.getByRole('heading',{name:'Orchestra',exact:true})).toBeVisible();
  };
  await openDetail();
  await expect(page.getByLabel(new RegExp('^'+esc(project)+' · \\S'))).toBeVisible();
  await expect(page.getByText('Agents',{exact:true})).toBeVisible();
  await expect(page.getByText('No linked chats yet',{exact:true})).toBeVisible();
  const profiles=page.getByRole('button',{name:new RegExp('^Open .+ in '+esc(project)+'$')});
  await expect(profiles.first()).toBeVisible();
  const omp=profiles.filter({hasText:/OMP/});
  const pick=(await omp.count())?omp.first():profiles.first();
  const label=await pick.getAttribute('aria-label');
  const name=new RegExp('^Open (.+) in '+esc(project)+'$').exec(label??'')?.[1];
  if(!name)throw Error('profile name missing from '+label);
  await pick.click({noWaitAfter:true});
  // The web export answers an unavailable agent with Alert.alert (a no-op on RN web), so an
  // online harness row must open the chat.
  await expect(composer(page)).toBeVisible({timeout:20000});
  await expect(page.getByText(name).filter({visible:true}).first()).toBeVisible();
  await btn(page,'Back').first().click({noWaitAfter:true});
  await expect(page.getByLabel(new RegExp('^'+esc(project)+' · \\S'))).toBeVisible();
  await expect(page.getByText('No linked chats yet',{exact:true})).toHaveCount(0);
  // FlashList renders the chat rows after the agent rows; the chat title is the profile name.
  // Spec fix: the always-mounted BridgePull sheet also renders a "<harness>" button after this screen, so .last() hit that off-screen
  // copy ("element is outside of the viewport"). The chat row is the first match after the "Chats" section label.
  await page.getByText('Chats',{exact:true}).filter({visible:true}).locator('xpath=following::*[normalize-space(.)="'+name+'"]').first().click({noWaitAfter:true});
  await expect(composer(page)).toBeVisible({timeout:20000});
 });
});

/* ------------------------------------------------------------------ Approvals */

type GateRow={id:string;state:string;body:string;target:{repo:string;number?:number};reason?:string};
async function gateItems(dir:string){
 const text=await readFile(join(dir,'gate','events.jsonl'),'utf8');
 const items=new Map<string,GateRow>();
 for(const line of text.split('\n')){if(!line)continue;const v:GateRow=JSON.parse(line);items.set(v.id,v);}
 return [...items.values()];
}
async function gateId(dir:string,repo:string,number:number){
 const it=(await gateItems(dir)).find(i=>i.target.repo===repo&&i.target.number===number);
 if(!it)throw Error('gate item missing '+repo+'#'+number);return it.id;
}
const gateState=async(dir:string,id:string)=>(await gateItems(dir)).find(i=>i.id===id)?.state;
const gateCard=(page:Page,id:string)=>page.getByTestId('gate-card-'+id);
const checkbox=(page:Page,id:string)=>page.getByRole('checkbox',{name:'Select '+id,exact:true});
async function openApprovals(page:Page,pending:number){
 await btn(page,`Upstream approvals, ${pending} pending`).first().click({noWaitAfter:true});
 await expect(page.getByText('Dry run · Nothing will be posted',{exact:true})).toBeVisible();
 await expect(page.getByTestId('approval-metrics')).toBeVisible();
}
/** seed-gate.ts item (#1, bulk-safe) + rc3-09-10-seed.ts gate (#2 bulk-safe, human-text #5, CLA #9). */
async function seededApprovals(page:Page,b:Bridge){
 seed('gate',join(b.dir,'gate'));
 await pairCold(page,b);await openApprovals(page,4);
 return {one:await gateId(b.dir,'example/army-fixture',1),two:await gateId(b.dir,'example/army-fixture',2),human:await gateId(b.dir,'example/army-human',5),cla:await gateId(b.dir,'example/army-individual',9)};
}

test.describe('rc3 10 approvals screen',()=>{
 test('metrics, Select all bulk-safe, Approve selected then Confirm approve sends gate_decide',async({page,bridge})=>{
  const {one,two,human,cla}=await seededApprovals(page,bridge);
  const m=page.getByTestId('approval-metrics');
  await expect(m).toContainText(/Pending\s*4/);await expect(m).toContainText(/Bulk-ready\s*2/);await expect(m).toContainText(/Blocked\s*0/);
  await expect(checkbox(page,human)).toHaveCount(0);await expect(checkbox(page,cla)).toHaveCount(0);
  await expect(btn(page,'Approve selected (0)')).toBeDisabled();
  await btn(page,'Select all bulk-safe').click({noWaitAfter:true});
  await expect(checkbox(page,one)).toHaveAttribute('aria-checked','true');
  await expect(checkbox(page,two)).toHaveAttribute('aria-checked','true');
  await expect(btn(page,'Approve selected (2)')).toBeEnabled();
  await btn(page,'Approve selected (2)').click({noWaitAfter:true});
  await expect(page.getByText('Approve 2 items?',{exact:true})).toBeVisible();
  await btn(page,'Confirm approve 2').click({noWaitAfter:true});
  await expect.poll(()=>gateState(bridge.dir,one)).toBe('approved');
  await expect.poll(()=>gateState(bridge.dir,two)).toBe('approved');
  expect(await gateState(bridge.dir,human)).toBe('pending');
  await expect(m).toContainText(/Pending\s*2/);
  await expect(btn(gateCard(page,one),'Check dry run')).toBeVisible();
  await expect(btn(gateCard(page,two),'Check dry run')).toBeVisible();
  await expect(btn(page,'Approve selected (0)')).toBeDisabled();
 });

 test('Select group (n), per-item Select <id>, Cancel confirm, Show history and Hide history',async({page,bridge})=>{
  const {one,two,cla}=await seededApprovals(page,bridge);
  await expect(btn(page,'Select group (2)')).toBeEnabled();
  await expect(btn(page,'Select group (0)').first()).toBeDisabled();
  await btn(page,'Select group (2)').click({noWaitAfter:true});
  await expect(checkbox(page,one)).toHaveAttribute('aria-checked','true');
  await expect(checkbox(page,two)).toHaveAttribute('aria-checked','true');
  await btn(page,'Select group (2)').click({noWaitAfter:true});
  await expect(checkbox(page,one)).toHaveAttribute('aria-checked','false');
  await expect(btn(page,'Approve selected (0)')).toBeDisabled();
  await checkbox(page,one).click({noWaitAfter:true});
  await expect(checkbox(page,one)).toHaveAttribute('aria-checked','true');
  await expect(checkbox(page,two)).toHaveAttribute('aria-checked','false');
  await btn(page,'Approve selected (1)').click({noWaitAfter:true});
  await expect(page.getByText('Approve 1 item?',{exact:true})).toBeVisible();
  await btn(page,'Cancel').click({noWaitAfter:true});
  await expect(page.getByText('Approve 1 item?',{exact:true})).toHaveCount(0);
  expect(await gateState(bridge.dir,one)).toBe('pending');
  // Reject the CLA item, then find it only in history.
  await btn(gateCard(page,cla),'Reject').click({noWaitAfter:true});
  await page.getByRole('textbox',{name:'Rejection reason',exact:true}).fill('ARMY area 10 rejection');
  await btn(page,'Confirm reject').click({noWaitAfter:true});
  await expect.poll(()=>gateState(bridge.dir,cla)).toBe('rejected');
  await expect(gateCard(page,cla)).toHaveCount(0);
  await btn(page,'Show history').click({noWaitAfter:true});
  await expect(gateCard(page,cla)).toContainText('rejected · ARMY area 10 rejection');
  await btn(page,'Hide history').click({noWaitAfter:true});
  await expect(gateCard(page,cla)).toHaveCount(0);
  await expect(btn(page,'Show history')).toBeVisible();
 });

 test('Review / edit saves owner text; Write response then Approve item then Check dry run',async({page,bridge})=>{
  const {human,cla}=await seededApprovals(page,bridge);
  // Individual (CLA) item: editor is prefilled with the proposal body; Save needs a real change.
  await btn(gateCard(page,cla),'Review / edit').click({noWaitAfter:true});
  const editor=page.getByRole('textbox',{name:'Owner response',exact:true});
  await expect(editor).toHaveValue('ARMY_INDIVIDUAL: proposal that needs individual review');
  await expect(btn(page,'Save owner text')).toBeDisabled();
  await editor.fill('ARMY owner edited text for the individual item');
  await expect(btn(page,'Save owner text')).toBeEnabled();
  await btn(page,'Save owner text').click({noWaitAfter:true});
  await expect(editor).toHaveCount(0);
  await expect.poll(()=>gateState(bridge.dir,cla)).toBe('edited');
  await expect(gateCard(page,cla)).toContainText('ARMY owner edited text for the individual item');
  // Human-text policy: generated text withheld, Write response required before Approve item.
  const h=gateCard(page,human);
  await expect(h).toContainText('Write your own response. Generated text is not shown under this policy.');
  await expect(btn(h,'Approve item')).toBeDisabled();
  await btn(h,'Write response').click({noWaitAfter:true});
  await expect(editor).toHaveValue('');
  await editor.fill('ARMY owner written reply for the human-text policy');
  await btn(page,'Save owner text').click({noWaitAfter:true});
  await expect.poll(()=>gateState(bridge.dir,human)).toBe('edited');
  await expect(btn(h,'Approve item')).toBeEnabled();
  await btn(h,'Approve item').click({noWaitAfter:true});
  await expect(page.getByText('Approve 1 item?',{exact:true})).toBeVisible();
  await btn(page,'Confirm approve 1').click({noWaitAfter:true});
  await expect.poll(()=>gateState(bridge.dir,human)).toBe('approved');
  // Dry run check runs the real executor; the isolated PATH gh is an offline fixture, so the
  // live-target check must fail closed (stale/failed), never post.
  await writeFile(join(bridge.dir,'bin','gh'),'#!/bin/sh\necho "army fixture gh: offline" >&2\nexit 1\n',{mode:0o700});
  await expect(btn(h,'Check dry run')).toBeVisible();
  await btn(h,'Check dry run').click({noWaitAfter:true});
  await expect.poll(()=>gateState(bridge.dir,human),{timeout:20000}).toMatch(/^(failed|stale)$/);
  await expect(h).toContainText(/(failed|stale) · /);
  await expect(btn(h,'Check dry run')).toHaveCount(0);
 });

 test('repo link opens GitHub; every decision control is disabled offline',async({page,bridge})=>{
  await stubGithub(page.context());
  const {one,human}=await seededApprovals(page,bridge);
  const link=gateCard(page,one).getByRole('link',{name:'example/army-fixture #1',exact:true});
  await expect(link).toBeVisible();
  expect(await popupUrl(page,()=>link.click({noWaitAfter:true}))).toBe('https://github.com/example/army-fixture/issues/1');
  await expect(btn(gateCard(page,one),'Approve item')).toBeEnabled();
  await bridge.stop();
  await expect(page.getByText('Offline. Decisions disabled until the paired bridge reconnects.',{exact:true})).toBeVisible({timeout:20000});
  await expect(btn(page,'Select all bulk-safe')).toBeDisabled();
  await expect(btn(page,'Select group (2)')).toBeDisabled();
  await expect(btn(page,'Approve selected (0)')).toBeDisabled();
  await expect(checkbox(page,one)).toHaveAttribute('aria-disabled','true');
  for(const name of ['Review / edit','Reject','Approve item'])await expect(btn(gateCard(page,one),name)).toBeDisabled();
  await expect(btn(gateCard(page,human),'Write response')).toBeDisabled();
  // History is a local view toggle and stays available offline.
  await expect(btn(page,'Show history')).toBeEnabled();
 });
});

/* -------------------------------------------------------------- Needs Kevin */

const supervised=test.extend<{supervision:{bridge:Bridge;dir:string}}>({
 supervision:async({},use,info)=>{
  const dir=await mkdtemp(join(process.env.ARMY_TMP || tmpdir(),'dash-army-supervision-'));
  seed('supervision',dir,'2');
  const b=await createBridge(true,{env:{DASH_SUPERVISION_DIR:dir}});
  try{await use({bridge:b,dir});}finally{await b.stop();await writeFile(info.outputPath('bridge.log'),b.logs());}
 },
});

supervised.describe('rc3 10 needs kevin',()=>{
 supervised('Needs Kevin group lists owner items; Refresh Needs Kevin reloads the batch',async({page,supervision})=>{
  await pairCold(page,supervision.bridge);await openApprovals(page,1);
  const nk=page.getByTestId('needs-kevin');
  await expect(nk.getByRole('heading',{name:'Needs Kevin · 2',exact:true})).toBeVisible({timeout:20000});
  await expect(nk).toContainText('ARMY_KEVIN_GOAL_1');
  await expect(nk).toContainText('ARMY_KEVIN_WHY_2: fixture worker is blocked on an owner decision');
  await expect(nk).toContainText('Recommended: resume');
  await expect(nk).toContainText('Options: resume / abandon');
  await expect(nk).toContainText('Evidence: fixture/army-worker-1.log');
  await expect(nk).not.toContainText('ARMY_KEVIN_GOAL_3');
  seed('supervision',supervision.dir,'3');
  await btn(nk,'Refresh Needs Kevin').click({noWaitAfter:true});
  await expect(nk.getByRole('heading',{name:'Needs Kevin · 3',exact:true})).toBeVisible({timeout:15000});
  await expect(nk).toContainText('ARMY_KEVIN_GOAL_3');
 });
});

test('Needs Kevin reports an unavailable supervision host honestly',async({page,bridge})=>{
 await pairCold(page,bridge);await openApprovals(page,1);
 const nk=page.getByTestId('needs-kevin');
 await expect(nk.getByRole('alert')).toContainText(/Supervision unavailable \(HTTP 503\)/,{timeout:20000});
 await btn(nk,'Refresh Needs Kevin').click({noWaitAfter:true});
 await expect(nk.getByRole('alert')).toContainText(/Supervision unavailable \(HTTP 503\)/);
});

/* ---------------------------------------------------------------------- Trace */

const timeline=(page:Page)=>page.getByTestId('trace-timeline');
const plot=(page:Page,id='trace-timeline')=>page.getByTestId(id+'-plot');
/** Width of the zoomed content layer (viewW * zoom) and its translated left edge. */
const layer=(l:Locator)=>l.evaluate(el=>{const c=el.firstElementChild;if(!(c instanceof HTMLElement))throw Error('timeline content layer missing');const r=c.getBoundingClientRect();return {width:r.width,left:r.left};});
async function openTrace(page:Page,b:Bridge){
 await pairCold(page,b);
 // Spec fix: since dca0dc3 Trace is the live bridge feed. Before the first visit the entry card reads "Agent trace: Open to load live events"
 // (counts only exist after a snapshot), so match the card by its testID and then require the live feed, not an unavailable state.
 const entry=page.getByTestId('trace-entry');
 await expect(entry).toBeVisible();
 await expect(entry).toHaveAttribute('aria-label',/^Agent trace: \S/);
 await entry.click({noWaitAfter:true});
 await expect(page.getByTestId('trace-feed-live')).toBeVisible();
 await expect(timeline(page)).toBeVisible();
 await expect(page.getByTestId('trace-scroll')).toBeVisible();
}
/** Component lab is a FlashList window: wheel the list until the block is mounted, then bring it on screen. */
async function revealLab(page:Page,testId:string){
 const target=page.getByTestId(testId);
 const vp=page.viewportSize();if(!vp)throw Error('no viewport');
 await expect(async()=>{
  if(await target.count()===0){await page.mouse.move(vp.width/2,vp.height*0.6);await page.mouse.wheel(0,500);}
  await expect(target).toBeAttached({timeout:800});
 }).toPass({timeout:30000});
 await target.scrollIntoViewIfNeeded();
 return target;
}
async function zoom(page:Page,label:'fit'|'3h'|'1h',scope:Locator=timeline(page)){
 await btn(scope,'Zoom '+label).click({noWaitAfter:true});
 await page.waitForTimeout(500);
}
/** Long-press in the plot at the height of the axis row (not a run row): scrub, not the row menu. */
async function axisPoint(page:Page,scope:Locator,plotL:Locator){
 await plotL.scrollIntoViewIfNeeded();
 const axis=await btn(scope,'Zoom fit').boundingBox();const p=await plotL.boundingBox();
 if(!axis||!p)throw Error('timeline has no box');
 return {x:p.x+p.width/2,y:axis.y+axis.height/2,p};
}

test.describe('rc3 10 trace screen',()=>{
 test('trace entry card opens the timeline; Zoom buttons set zoom; drag pans; long-press scrubs with playhead',async({page,bridge})=>{
  await openTrace(page,bridge);
  const pl=plot(page);
  const w=(await pl.boundingBox())?.width;if(!w)throw Error('plot has no box');
  await zoom(page,'fit');
  await expect.poll(async()=>Math.abs((await layer(pl)).width-w)).toBeLessThan(3);
  await zoom(page,'1h');
  await expect.poll(async()=>(await layer(pl)).width).toBeGreaterThan(w*3);
  const oneHour=(await layer(pl)).width;
  await zoom(page,'3h');
  await expect.poll(async()=>(await layer(pl)).width).toBeLessThan(oneHour);
  await expect.poll(async()=>(await layer(pl)).width).toBeGreaterThan(w*1.2);
  // Drag to pan: the content layer translates.
  await zoom(page,'1h');
  const {x,y}=await axisPoint(page,timeline(page),pl);
  const before=(await layer(pl)).left;
  await page.mouse.move(x,y);
  // A press held still for 320 ms is a scrub (TraceTimeline scrub: Pan.activateAfterLongPress(320)). Under
  // load each awaited Playwright step takes ~300 ms, so the drag's first move could land after the long
  // press and scrub instead of pan. The press and the first move go out back to back, so the page sees a drag.
  await Promise.all([page.mouse.down(),page.mouse.move(x+20,y)]);
  await page.mouse.move(x+160,y,{steps:12});await page.mouse.up();
  await expect.poll(async()=>Math.abs((await layer(pl)).left-before)).toBeGreaterThan(40);
  // Long-press to scrub: playhead fades in and the floating readout follows the finger.
  await zoom(page,'fit');
  const a=await axisPoint(page,timeline(page),pl);
  const head=page.getByTestId('scrub-playhead').first();
  expect(await opacity(head)).toBeLessThan(0.1);
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.waitForTimeout(700);
  await page.mouse.move(a.x+30,a.y,{steps:6});
  await expect(page.getByTestId('scrub-float')).toBeVisible();
  await expect(page.getByTestId('scrub-float')).toContainText(/live then/);
  await expect.poll(()=>opacity(head)).toBeGreaterThan(0.5);
  await page.mouse.up();
  await expect(page.getByTestId('scrub-float')).toHaveCount(0);
  await expect.poll(()=>opacity(head)).toBeLessThan(0.1);
 });

 test('Component lab timeline long-press shows the scrub readout',async({page,bridge})=>{
  await openTrace(page,bridge);
  await btn(page,'Component lab').click({noWaitAfter:true});
  await revealLab(page,'lab-timeline');
  const lab=page.locator('[data-testid^="lab-timeline-"]:not([data-testid$="-plot"])').first();
  await expect(lab).toBeVisible();
  const id=await lab.getAttribute('data-testid');if(!id)throw Error('lab timeline id missing');
  const {x,y}=await axisPoint(page,lab,plot(page,id));
  await expect(lab.getByTestId('scrub-readout')).toHaveCount(0);
  await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(700);
  await page.mouse.move(x+24,y,{steps:4});
  await expect(lab.getByTestId('scrub-readout')).toBeVisible();
  await expect(lab.getByTestId('scrub-readout')).toContainText(/live/);
  await page.mouse.up();
  await expect(lab.getByTestId('scrub-readout')).toHaveCount(0);
 });

 test('tap a row label opens trace detail; Close, Close detail and drag down each close it',async({page,bridge})=>{
  await openTrace(page,bridge);
  const row=timeline(page).locator('[data-testid^="row-"]').first();
  const key=(await row.getAttribute('data-testid'))?.slice(4);if(!key)throw Error('row key missing');
  const detail=page.getByTestId('trace-detail');
  const open=async()=>{await row.click({noWaitAfter:true});await expect(detail).toBeVisible();await expect(btn(detail,'Close')).toBeVisible();};
  await open();
  await expect(detail).toContainText(key.split(' · ')[0] ?? key);
  await btn(detail,'Close').click({noWaitAfter:true});
  await expect(detail).toHaveCount(0);
  await open();
  await page.getByLabel('Close detail',{exact:true}).click({position:{x:6,y:6},noWaitAfter:true});
  await expect(detail).toHaveCount(0);
  await open();
  await page.waitForTimeout(600);
  const c=await btn(detail,'Close').boundingBox();if(!c)throw Error('detail close has no box');
  const sx=c.x-80,sy=c.y+c.height/2;
  await page.mouse.move(sx,sy);await page.mouse.down();
  await page.mouse.move(sx,sy+260,{steps:14});await page.mouse.up();
  await expect(detail).toHaveCount(0);
 });

 test('long-press a row opens the row menu with menuitems; Close row menu closes; Open details opens detail',async({page,bridge})=>{
  await openTrace(page,bridge);
  const row=timeline(page).locator('[data-testid^="row-"]').first();
  const pl=plot(page);
  const press=async()=>{
   await row.scrollIntoViewIfNeeded();
   const r=await row.boundingBox(),p=await pl.boundingBox();if(!r||!p)throw Error('row has no box');
   await page.mouse.move(p.x+p.width/2,r.y+r.height/2);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();
  };
  await press();
  const menu=page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items=menu.getByRole('menuitem');
  // Spec fix: copy actions are per row (trace/row-actions.ts). Every live-feed row carries a source, so "Copy source path" is listed;
  // this fixture records no owner request, so there is no "Copy original request".
  await expect(items).toHaveCount(4);
  await expect(items).toHaveText(['Open details','Zoom to this run','Copy source path','Copy summary']);
  const back=page.getByLabel('Close row menu',{exact:true});
  const box=await back.boundingBox();if(!box)throw Error('row menu backdrop has no box');
  await back.click({position:{x:box.width-6,y:6},noWaitAfter:true});
  await expect(menu).toHaveCount(0);
  await press();
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem',{name:'Open details'}).click({noWaitAfter:true});
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('trace-detail')).toBeVisible();
 });

 test('action chip: swipe right commits Do, Undo reverts; swipe left commits Not now and Undo expires after 5 s',async({page,bridge})=>{
  // Spec fix: the live Trace feed has no action chips (bridge /trace/snapshot sends actions: [] and production Trace never shows the bundled
  // sample a-resume/a-triage chips). The swipe chip is the same ActionChip in the Component lab (card and pill variants, demo data).
  await openTrace(page,bridge);
  await btn(page,'Component lab').click({noWaitAfter:true});
  await expect(page.getByRole('heading',{name:'Component lab',exact:true})).toBeVisible();
  await revealLab(page,'lab-action-chip');
  const surface=page.getByTestId('chip-surface-lab-card');
  const swipe=async(s:Locator,dir:1|-1)=>{
   await s.scrollIntoViewIfNeeded();
   const b=await s.boundingBox();if(!b)throw Error('chip has no box');
   const x=b.x+b.width/2,y=b.y+b.height/2;
   await page.mouse.move(x,y);await page.mouse.down();
   await page.mouse.move(x+dir*b.width*0.45,y,{steps:14});await page.mouse.up();
  };
  await expect(surface).toHaveAttribute('aria-label',/Swipe right for Do, left for Not now\.$/);
  await swipe(surface,1);
  await expect(surface).toHaveAttribute('aria-label',/\. Done$/);
  await expect(surface).toContainText('✓ Done');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('dash.trace.feedback/v1'))).toMatch(/"id":"lab-card","value":"do"/);
  const undo=btn(page.getByTestId('chip-lab-card'),'Undo');
  await expect(undo).toBeVisible();
  await undo.click({noWaitAfter:true});
  await expect(surface).toHaveAttribute('aria-label',/Swipe right for Do, left for Not now\.$/);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('dash.trace.feedback/v1'))).toMatch(/"id":"lab-card","value":"undo"/);
  const pill=page.getByTestId('chip-surface-lab-pill');
  await swipe(pill,-1);
  await expect(pill).toHaveAttribute('aria-label',/\. Not now$/);
  const undo2=btn(page.getByTestId('chip-lab-pill'),'Undo');
  await expect(undo2).toBeVisible();
  await expect(undo2).toHaveCount(0,{timeout:8000});
  await expect(pill).toHaveAttribute('aria-label',/\. Not now$/);
 });

 test('action chip buttons: tap Do commits, Undo reverts, tap Not now commits',async({page,bridge})=>{
  await openTrace(page,bridge);
  await btn(page,'Component lab').click({noWaitAfter:true});
  const chip=await revealLab(page,'chip-lab-buttons'),surface=page.getByTestId('chip-surface-lab-buttons');
  await expect(btn(chip,'Do')).toBeVisible();await expect(btn(chip,'Not now')).toBeVisible();
  await btn(chip,'Do').click({noWaitAfter:true});
  await expect(surface).toHaveAttribute('aria-label',/\. Done$/);
  await expect(btn(chip,'Do')).toHaveCount(0);
  await btn(chip,'Undo').click({noWaitAfter:true});
  await expect(surface).not.toHaveAttribute('aria-label',/\. (Done|Not now)$/);
  await btn(chip,'Not now').click({noWaitAfter:true});
  await expect(surface).toHaveAttribute('aria-label',/\. Not now$/);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('dash.trace.feedback/v1'))).toMatch(/"id":"lab-buttons","value":"not_now"/);
 });
});

test.describe('rc3 10 trace pinch',()=>{
 test.use({hasTouch:true});
 test('two-finger pinch on the timeline zooms in',async({page,bridge})=>{
  await openTrace(page,bridge);
  const pl=plot(page);
  await zoom(page,'fit');
  const {x,y}=await axisPoint(page,timeline(page),pl);
  const before=(await layer(pl)).width;
  // Real multi-touch through Chromium's input pipeline (trusted touch + pointer events).
  const cdp=await page.context().newCDPSession(page);
  const pts=(d:number)=>[{x:x-d,y,id:1},{x:x+d,y,id:2}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pts(12)});
  for(let d=16;d<=90;d+=6){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pts(d)});await page.waitForTimeout(16);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>(await layer(pl)).width).toBeGreaterThan(before*1.5);
 });
});
