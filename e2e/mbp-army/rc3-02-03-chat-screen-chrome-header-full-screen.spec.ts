// RC3 tester army, area 03: chat screen chrome (header, full-screen status pill + close X, windowed mode, options).
// App under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc), served as a web export; bridge from the same commit.
// Same isolated real bridge + scripted ACP fixture as army.spec.ts. No route mocks, no debug-store seeding.
import {test,expect,pair,composer,send,createBridge,type Bridge} from './fixtures';
import {startFxFixture,type FxFixture} from './rc3-11-fx-fixture';
import type {Page,Locator} from 'playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

// RC3 renamed the workspace header compose action (a11y-workspace-header.ts WORKSPACE_ACTION_LABELS.newChat).
const NEW_CHAT='Create new chat';
const rows=new WeakMap<Page,string>();
const ownRow=(page:Page)=>{const id=rows.get(page);if(!id)throw Error('No owned chat row recorded');return page.getByTestId(id);};
const chatsPane=(page:Page)=>page.getByTestId('chats-pane');
const back=(page:Page)=>page.getByRole('button',{name:'Back',exact:true});
const optionsToggle=(page:Page)=>page.getByRole('button',{name:'Chat options',exact:true});
const trigger=(page:Page,surface='Chat')=>page.getByRole('button',{name:`Options. Current surface: ${surface}`,exact:true});
const menuRow=(page:Page,label:string)=>page.getByRole('button',{name:new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+', ')});

/** Pair, then open a new chat from the workspace header: RC3 presents it full screen. */
async function openFullscreen(page:Page,bridge:Bridge){
 await pair(page,bridge);
 await page.getByRole('button',{name:NEW_CHAT,exact:true}).first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
}
/** Back to Main, record the exact new row (never the first roster row) and reopen it windowed. */
async function openWindow(page:Page,bridge:Bridge){
 await openFullscreen(page,bridge);
 await back(page).click({noWaitAfter:true});
 const row=chatsPane(page).locator('[data-testid^=chat-row-]').filter({has:page.getByText('New chat',{exact:true})});
 await expect(row).toHaveCount(1);
 const id=await row.getAttribute('data-testid');if(!id)throw Error('New chat row id missing');rows.set(page,id);
 await row.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
}
/** The fixture-native persisted Hermes session row, opened windowed. */
async function openHermesRow(page:Page){
 const row=chatsPane(page).locator('[data-testid^=chat-row-]').filter({has:page.getByText('ARMY native fixture')});
 await expect(row).toHaveCount(1,{timeout:30000});
 await row.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
}
async function harnessNameOf(page:Page){
 const chip=page.getByRole('button',{name:'Choose harness',exact:true});
 await expect(chip).toBeVisible();
 const text=(await chip.innerText()).trim();
 const name=text.split(' · ')[0]?.trim();if(!name)throw Error('harness chip text: '+text);
 return name;
}
async function chooseHarnessFullscreen(page:Page,name:string){
 await page.getByRole('button',{name:'Choose harness',exact:true}).click({noWaitAfter:true});
 await page.getByRole('button',{name:new RegExp(name)}).last().click({noWaitAfter:true});
 await expect(page.getByRole('button',{name:'Choose harness',exact:true})).toContainText(name);
}
const colorOf=(l:Locator)=>l.evaluate(el=>getComputedStyle(el).color);
// composer(page) (textbox 'Message') also matches Main's GlobalSearchBar, which has aria-label 'Message'; the chat composer's own wrapper is composer-field.
const chatComposerField=(page:Page)=>page.getByTestId('composer-field');
function captureSent(page:Page){const frames:string[]=[];page.on('websocket',ws=>ws.on('framesent',f=>frames.push(typeof f.payload==='string'?f.payload:f.payload.toString('utf8'))));return frames;}

// ---------- Full-screen chat: header, empty state, RC3 #392/#383 pill ----------

test('03.01 new chat from workspace header opens full screen with top nav, compact header and back to Main',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await expect(page.getByRole('tab',{name:'Chats',exact:true})).toBeVisible();
 const name=await harnessNameOf(page);
 await expect(page.getByRole('heading',{name:new RegExp('^(New chat|'+name+')$')})).toBeVisible();
 await expect(back(page)).toBeEnabled();
 await back(page).click({noWaitAfter:true});
 await expect(chatsPane(page)).toBeVisible();
 await expect(chatComposerField(page)).toHaveCount(0);
});

test('03.02 empty full-screen chat shows agent orb, harness name and host line',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 const name=await harnessNameOf(page);
 const viewport=page.getByTestId('transcript-viewport');
 await expect(viewport.getByTestId('agent-orb')).toBeVisible();
 await expect(viewport.getByTestId('agent-orb')).toHaveAttribute('aria-label',new RegExp('^'+name));
 await expect(viewport.getByText(name,{exact:true})).toBeVisible();
 // Online with a reported host: 'on <host>'. Never both.
 await expect(viewport.getByText(/^on \S+/)).toBeVisible();
 await expect(viewport.getByText('Ask anything',{exact:true})).toHaveCount(0);
 await bridge.stop();
 await expect(viewport.getByText('Ask anything',{exact:true})).toBeVisible({timeout:20000});
});

test('03.03 RC3 #392/#383 on web the full-screen chat keeps the compact header with Back (the status pill and close X are native-only) and Back returns to Main',async({page,bridge})=>{
 // Web contract. FullscreenChatChrome (the #392 cutout pill with the 'Close chat' X) is the native full-screen chrome:
 // lib/chat-chrome.ts resolveChatChrome documents 'Web always keeps ScreenHeader' (pinned by the #383 lane tests), and the
 // pill is built around the native DisplayCutout. So on web the full-screen chat keeps the compact ScreenHeader (title + Back),
 // mounts no pill or close X, and Back returns to Main. The native pill (and its wiring into ChatScreen) is device-only evidence.
 await openFullscreen(page,bridge);
 const name=await harnessNameOf(page);
 await expect(page.getByTestId('chat-fullscreen-pill')).toHaveCount(0);
 await expect(page.getByTestId('chat-fullscreen-close')).toHaveCount(0);
 const title=page.getByRole('heading',{name:new RegExp('^(New chat|'+name+')$')});
 await expect(title).toBeVisible();
 await back(page).click({noWaitAfter:true});
 await expect(chatsPane(page)).toBeVisible();
 await expect(chatComposerField(page)).toHaveCount(0);
});

// ---------- Full-screen options ----------

test('03.04 Options expands to Hide options and collapses again',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 const toggle=optionsToggle(page);
 await expect(toggle).toHaveText('Options');
 await expect(page.getByRole('switch',{name:'Thinking summaries',exact:true})).toHaveCount(0);
 await toggle.click({noWaitAfter:true});
 await expect(toggle).toHaveText('Hide options');
 await expect(page.getByRole('switch',{name:'Thinking summaries',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Annotate this screen',exact:true})).toBeVisible();
 // // Spec fix: RN Web 0.21 drops accessibilityState (README precedent: assert rendered state, not the attribute).
 await toggle.click({noWaitAfter:true});
 await expect(toggle).toHaveText('Options');
 await expect(page.getByRole('switch',{name:'Thinking summaries',exact:true})).toHaveCount(0);
 // // Spec fix: RN Web 0.21 drops accessibilityState (README precedent).
});

test('03.05 Thinking summaries switch toggles on/off and the next turn requests summaries',async({page,bridge})=>{
 const frames=captureSent(page);
 await openFullscreen(page,bridge);
 await optionsToggle(page).click({noWaitAfter:true});
 const sw=page.getByRole('switch',{name:'Thinking summaries',exact:true});
 await expect(sw).toContainText('Thinking summaries · off · next turn');
 await sw.click({noWaitAfter:true});
 await expect(sw).toContainText('Thinking summaries · on · next turn');
 // // Spec fix: RN Web 0.21 drops accessibilityState (README precedent: assert rendered state, not the attribute).
 await send(page,'summaries requested turn');
 await expect(page.getByText(/ARMY_REPLY: summaries requested turn/).filter({visible:true}).first()).toBeVisible();
 await expect.poll(()=>frames.some(f=>f.includes('summaries requested turn')&&/"summariesEnabled":true/.test(f)),{message:'chat frame for the next turn carries summariesEnabled:true'}).toBe(true);
 await sw.click({noWaitAfter:true});
 await expect(sw).toContainText('Thinking summaries · off · next turn');
 await send(page,'summaries off turn');
 await expect(page.getByText(/ARMY_REPLY: summaries off turn/).filter({visible:true}).first()).toBeVisible();
 await expect.poll(()=>frames.some(f=>f.includes('summaries off turn')&&!/"summariesEnabled":true/.test(f))).toBe(true);
});

test('03.06 Details Hide/Compact/Full turn gold and change thinking detail for this chat',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await send(page,'ARMY_THINK detail modes');
 await expect(page.getByText('ARMY_REPLY_AFTER_THINK').filter({visible:true}).first()).toBeVisible();
 const reasoning=page.getByRole('button',{name:/^Reasoning/});
 await expect(reasoning).toBeVisible();
 await expect(reasoning).toHaveAttribute('aria-expanded','false');
 await optionsToggle(page).click({noWaitAfter:true});
 const gold=await colorOf(page.getByText('✎ Annotate',{exact:true}));
 const mode=(m:string)=>page.getByRole('button',{name:`Details ${m}`,exact:true});
 await expect(mode('Compact')).toBeVisible(); // Spec fix: RN Web 0.21 drops accessibilityState (README precedent: assert rendered state, not the attribute).
 expect(await colorOf(mode('Compact').getByText('Compact',{exact:true}))).toBe(gold);
 await mode('Full').click({noWaitAfter:true});
 await expect(mode('Full')).toBeVisible(); // Spec fix: RN Web 0.21 drops accessibilityState (README precedent).
 await expect.poll(()=>colorOf(mode('Full').getByText('Full',{exact:true}))).toBe(gold);
 expect(await colorOf(mode('Compact').getByText('Compact',{exact:true}))).not.toBe(gold);
 await expect(reasoning).toHaveAttribute('aria-expanded','true');
 await expect(page.getByText(/ARMY_THOUGHT_DETAIL line two/).filter({visible:true}).first()).toBeVisible();
 await mode('Hide').click({noWaitAfter:true});
 await expect(mode('Hide')).toBeVisible(); // Spec fix: RN Web 0.21 drops accessibilityState (README precedent).
 await expect.poll(()=>colorOf(mode('Hide').getByText('Hide',{exact:true}))).toBe(gold);
 await expect(reasoning).toHaveCount(0);
 // Scope to this chat's transcript: the retained (hidden) Chats list row for this chat previews the raw reply text
 // 'Last reply · <think>ARMY_THOUGHT_DETAIL line one', which an unscoped getByText also matches.
 await expect(page.getByTestId('transcript-viewport').getByText(/ARMY_THOUGHT_DETAIL/)).toHaveCount(0);
 await expect(page.getByText('ARMY_REPLY_AFTER_THINK').filter({visible:true}).first()).toBeVisible();
 await mode('Compact').click({noWaitAfter:true});
 await expect(reasoning).toHaveAttribute('aria-expanded','false');
});

test('03.07 Annotate in options starts annotation mode with the tray',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await optionsToggle(page).click({noWaitAfter:true});
 await page.getByRole('button',{name:'Annotate this screen',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('annotation-tray')).toBeVisible();
 await expect(page.getByLabel('Annotation mode on',{exact:true})).toBeAttached();
});

// The Live surface talks to z0bridge --fx through the real bridge. The plain isolated bridge has none (live_open ENOENT
// .config/z0bridge/token -> 'Live surface needs z0bridge running with --fx on this host.'), so 03.08 gets the same scripted
// loopback fx stand-in as rc3-10-11 (injected only through the bridge's own DASH_Z0BRIDGE_URL / DASH_Z0BRIDGE_TOKEN_FILE).
const live=test.extend<{fx:FxFixture}>({
 fx: async({},use,testInfo)=>{const fx=await startFxFixture();try{await use(fx);}finally{await writeFile(testInfo.outputPath('fx-requests.json'),JSON.stringify(fx.requests,null,1));await fx.close();}},
 bridge: async({persistSession,bridgeOptions,fx},use,testInfo)=>{
  const b=await createBridge(persistSession,{...bridgeOptions,env:{...(bridgeOptions.env??{}),DASH_Z0BRIDGE_URL:fx.url,DASH_Z0BRIDGE_TOKEN_FILE:fx.tokenFile}});
  try{await use(b);}finally{await b.stop();await writeFile(testInfo.outputPath('bridge.log'),b.logs());}
 },
});
live('03.08 Hermes options show Live surface switch; on, transcript is replaced by the live surface',async({page,bridge})=>{
 await openFullscreen(page,bridge);
 await chooseHarnessFullscreen(page,'Hermes');
 await optionsToggle(page).click({noWaitAfter:true});
 const live=page.getByRole('switch',{name:'Live surface',exact:true});
 await expect(live).toBeVisible();
 await expect(page.getByText('Hermes chat',{exact:true})).toBeVisible();
 await expect(page.getByTestId('transcript-viewport')).toBeVisible();
 await live.click({noWaitAfter:true});
 await expect(page.getByText('fast lane · Hermes stays in charge',{exact:true})).toBeVisible();
 await expect.soft(live).toHaveAttribute('aria-checked','true');
 await expect(page.getByTestId('transcript-viewport')).toHaveCount(0);
 await expect(page.getByTestId('live-surface'),'live surface must attach (not opening/error) on the isolated bridge').toBeVisible({timeout:30000});
});

// ---------- Target error and host handoff (windowed notice under the badge row) ----------

// chats.v1 keeps a Hermes chat opened from the paged list resumable even after its native row is hidden
// (mergeLiveConversations adopt:'live' + resumableWithoutRoster: 'not running, not ended'), so hiding the row never raises
// a target error. A chat recorded on another computer that the bridge does not route to opens View only: that is the
// store's targetError (conversationTargetError viewOnly) shown as an alert in the window dock with the composer disabled.
test.describe('rc3 03 target error',()=>{
 test.use({bridgeOptions:{remoteClaude:'off'}});
 test('03.09 targetError shows an alert under the header and disables the composer',async({page,bridge})=>{
  await pair(page,bridge);
  const row=chatsPane(page).locator('[data-testid^=chat-row-]').filter({hasText:'ARMY remote Claude Code chat'});
  await expect(row).toHaveCount(1,{timeout:30000});
  await row.click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  const alert=page.getByTestId('chat-window-dock').getByRole('alert');
  await expect(alert).toHaveText('View only: Dash can read this chat but cannot send to it.',{timeout:20000});
  await expect(composer(page)).not.toBeEditable();
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
 });
});

test('03.10 host-handoff session (openIn) shows the session viewer note',async({page,bridge})=>{
 // Hermes's own lease registry, pointing at a live fixture process inside the bridge PID namespace.
 const pid=Number((await readFile(join(bridge.dir,'.omp','agent','army-holder.pid'),'utf8')).trim());
 await mkdir(join(bridge.dir,'.hermes','runtime'),{recursive:true});
 await writeFile(join(bridge.dir,'.hermes','runtime','active_sessions.json'),JSON.stringify({entries:[{session_id:'army-fixture-session',pid,surface:'tui'}]}));
 await pair(page,bridge);
 await openHermesRow(page);
 await expect(page.getByTestId('chat-window-dock').getByText(/^Also open in TUI on .+ · reply here to continue$/)).toBeVisible({timeout:30000});
});

// ---------- Windowed chat ----------

test('03.11 return to Main and tap the exact row: windowed chat with pill and dock',async({page,bridge})=>{
 await openWindow(page,bridge);
 await expect(page.getByTestId('chat-window-pill')).toBeVisible();
 await expect(page.getByTestId('chat-window-dock')).toBeVisible();
 await expect(page.getByTestId('chat-window-pill-title')).toHaveText('New chat');
 await expect(optionsToggle(page)).toHaveCount(0);
 await expect(back(page)).toHaveCount(0);
 await expect(ownRow(page)).toBeAttached();
});

test('03.12 window pill status slot reflects idle/thinking/tool/queued/offline and toggles app nav',async({page,bridge})=>{
 await openWindow(page,bridge);
 const pill=page.getByTestId('chat-window-pill');
 const status=page.getByTestId('chat-window-pill-status');
 await expect(status).toHaveCount(0); // online + idle shows nothing
 await expect(pill).toHaveAttribute('aria-label',/^Navigation, collapsed\. New chat.*Double-tap to show navigation\.$/);
 // Pill toggles the window's own app nav (the retained workspace beneath may keep its own tabs mounted).
 const tabs=page.getByRole('tab',{name:'Chats',exact:true});
 const before=await tabs.count();
 await pill.click({noWaitAfter:true});
 await expect(tabs).toHaveCount(before+1);
 await expect(pill).toHaveAttribute('aria-label',/Double-tap to hide navigation\.$/);
 await pill.click({noWaitAfter:true});
 await expect(tabs).toHaveCount(before);
 await expect(pill).toHaveAttribute('aria-label',/Double-tap to show navigation\.$/);
 // Thinking.
 await send(page,'ARMY_HANG pill thinking');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).filter({visible:true}).first()).toBeVisible();
 // The slot is a Feather glyph followed by the text, so the element text is '\uf100working'; match the label at the end.
 await expect(status).toHaveText(/working$/);
 await page.getByRole('button',{name:'Stop',exact:true}).click({noWaitAfter:true});
 await expect(status).toHaveCount(0,{timeout:20000});
 // Running tool.
 await send(page,'ARMY_TOOLHANG pill tool');
 await expect(status).toContainText('armytool',{timeout:20000});
 // Queued behind the running tool (tool outranks queued in the reserved slot; the label lists both).
 await composer(page).fill('queued behind tool');
 await page.getByRole('button',{name:'Queue',exact:true}).click({noWaitAfter:true});
 await expect(pill).toHaveAttribute('aria-label',/1 queued/);
 // Offline outranks everything.
 await bridge.stop();
 await expect(status).toHaveText(/offline$/,{timeout:20000});
});

test('03.13 identity badge opens the identity panel with host, harness, profile, session and model line',async({page,bridge})=>{
 await openWindow(page,bridge);
 const badge=page.getByTestId('chat-window-badge');
 await expect(badge).toHaveAttribute('aria-label',/^Chat identity: host .+, harness .+, profile .+, session .+, model .+\. Double-tap for details\.$/);
 await expect(page.getByTestId('chat-window-identity')).toHaveCount(0);
 await badge.click({noWaitAfter:true});
 const panel=page.getByTestId('chat-window-identity');
 await expect(panel).toBeVisible();
 await expect(panel.getByTestId('chat-window-model-source')).toHaveText(/^(Model reported by host for this session · checked \d\d:\d\d:\d\d|Model unknown: host has not reported it for this session)$/);
 const label=await badge.getAttribute('aria-label')??'';
 const harness=/, harness (.+?), profile /.exec(label)?.[1];if(!harness)throw Error('badge label: '+label);
 await expect(panel).toContainText(harness);
 await expect(panel).toContainText(/session (not attached yet|\S+)/);
 await expect(panel).toContainText(/host unknown|\S+/);
 await expect(panel).toContainText(/Lineage/);
 await badge.click({noWaitAfter:true});
 await expect(panel).toHaveCount(0);
});

test('03.14 Close chat window returns to Main with a morph animation',async({page,bridge})=>{
 await openWindow(page,bridge);
 await page.evaluate(()=>{const w=window as unknown as {__armyMorph:number[]};w.__armyMorph=[];const t0=performance.now();const tick=()=>{const el=document.querySelector('[data-testid="chat-window"]');if(el)w.__armyMorph.push(Number(getComputedStyle(el).opacity));if(performance.now()-t0<3000)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 await page.getByTestId('chat-window-close').click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await expect(chatsPane(page)).toBeVisible();
 await expect(ownRow(page)).toBeVisible();
 const samples=await page.evaluate(()=>(window as unknown as {__armyMorph:number[]}).__armyMorph);
 expect(samples.some(o=>o>0.02&&o<0.98),'close morph shows intermediate opacity frames: '+JSON.stringify(samples.slice(0,40))).toBe(true);
});

test('03.15 window options menu rows run their actions and Close Options closes it',async({page,bridge})=>{
 await openWindow(page,bridge);
 const t=trigger(page);
 await t.click({noWaitAfter:true});
 for(const label of ['Thinking & tools','Thinking summaries','Annotate','Harness'])await expect(menuRow(page,label)).toBeVisible();
 await expect(menuRow(page,'Surface')).toHaveCount(0); // not Hermes
 // Close Options...
 await page.getByRole('button',{name:'Close Options. Current surface: Chat',exact:true}).click({noWaitAfter:true});
 await expect(menuRow(page,'Harness')).toHaveCount(0);
 // Thinking & tools cycles Compact -> Full.
 await t.click({noWaitAfter:true});
 await expect(menuRow(page,'Thinking & tools')).toHaveAccessibleName('Thinking & tools, Compact');
 await menuRow(page,'Thinking & tools').click({noWaitAfter:true});
 await expect(menuRow(page,'Harness')).toHaveCount(0);
 await t.click({noWaitAfter:true});
 await expect(menuRow(page,'Thinking & tools')).toHaveAccessibleName('Thinking & tools, Full');
 // Thinking summaries Off -> On · next turn.
 await expect(menuRow(page,'Thinking summaries')).toHaveAccessibleName('Thinking summaries, Off');
 await menuRow(page,'Thinking summaries').click({noWaitAfter:true});
 await t.click({noWaitAfter:true});
 await expect(menuRow(page,'Thinking summaries')).toHaveAccessibleName('Thinking summaries, On · next turn');
 // Harness opens the picker.
 await menuRow(page,'Harness').click({noWaitAfter:true});
 await expect(page.getByRole('button',{name:'Close harness picker',exact:true}).first()).toBeVisible();
 await page.getByRole('button',{name:'Close harness picker',exact:true}).first().click({noWaitAfter:true});
 // Annotate starts annotation mode.
 await t.click({noWaitAfter:true});
 await menuRow(page,'Annotate').click({noWaitAfter:true});
 await expect(page.getByTestId('annotation-tray')).toBeVisible();
});

test('03.16 window options Approvals row with warn dot opens Approvals',async({page,bridge})=>{
 await openWindow(page,bridge);
 // seed-gate.ts proposes one deterministic dry-run approval in the isolated gate.
 await expect(page.getByLabel(/^\d+ approvals pending$/)).toBeAttached({timeout:30000});
 await trigger(page).click({noWaitAfter:true});
 const row=menuRow(page,'Approvals');
 await expect(row).toHaveAccessibleName(/^Approvals, \d+ pending( · preview)? ›$/);
 await row.click({noWaitAfter:true});
 await expect(page.getByRole('heading',{name:'Approvals',exact:true})).toBeVisible();
});

test('03.17 Hermes window options Surface row switches to Live surface',async({page,bridge})=>{
 await pair(page,bridge);
 await openHermesRow(page);
 await trigger(page).click({noWaitAfter:true});
 const row=menuRow(page,'Surface');
 await expect(row).toHaveAccessibleName('Surface, Current: Chat · switch to Live surface');
 await row.click({noWaitAfter:true});
 await expect(trigger(page,'Live surface')).toBeVisible();
 await expect(page.getByTestId('transcript-viewport')).toHaveCount(0);
});

test('03.18 options trigger hold-to-scrub applies the scrubbed value on release',async({page,bridge})=>{
 await openWindow(page,bridge);
 // The window is still morphing in from its row when it first becomes visible (useWindowMorph, distance-based), so a bounding box read
 // now is stale. hover() waits for the trigger to be stable, then parks the mouse on its settled centre.
 await trigger(page).hover();
 const box=await trigger(page).boundingBox();if(!box)throw Error('options trigger has no box');
 const x=box.x+box.width/2, y=box.y+box.height/2;
 await page.mouse.down();
 await page.waitForTimeout(450); // > HOLD_MS (250): pan activates, menu opens
 await expect(menuRow(page,'Thinking & tools')).toBeVisible();
 // Row 0 (nearest the button) = Thinking & tools: slide up into it and dwell (> DWELL_MS 350) to arm.
 await page.mouse.move(x,y-28,{steps:6});
 await page.waitForTimeout(600);
 // Scrub right one level (40 px/level) from Compact to Full, then release.
 await page.mouse.move(x+46,y-28,{steps:10});
 await page.waitForTimeout(150);
 await page.mouse.up();
 await expect(menuRow(page,'Harness')).toHaveCount(0);
 await trigger(page).click({noWaitAfter:true});
 await expect(menuRow(page,'Thinking & tools')).toHaveAccessibleName('Thinking & tools, Full');
});

// ---------- Target switcher badge ----------

test('03.19 target switcher badge opens the switcher and its close X closes it',async({page,bridge})=>{
 // Expected to FAIL at 2c948dc: TargetSwitcherBadge has no importer (its own doc: "not mounted by the parallel lane").
 await openWindow(page,bridge);
 const badge=page.getByTestId('target-switcher-badge');
 await expect(badge,'TargetSwitcherBadge is not mounted anywhere at 2c948dc').toBeVisible();
 await badge.click({noWaitAfter:true});
 await expect(page.getByRole('heading',{name:'Switch target',exact:true})).toBeVisible();
 await expect(page.getByLabel('Available hosts, harnesses, profiles, sessions and models')).toBeVisible();
 await page.getByTestId('target-switcher-close').click({noWaitAfter:true});
 await expect(page.getByRole('heading',{name:'Switch target',exact:true})).toHaveCount(0);
});
