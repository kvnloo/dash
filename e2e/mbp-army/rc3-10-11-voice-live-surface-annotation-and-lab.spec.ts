// RC3 tester army, area 11: Voice, Live surface, annotation and Lab.
// App under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc), served as a web export; bridge from the same commit.
// Same isolated real bridge + scripted ACP fixture as army.spec.ts. No browser route mocks, no debug-store seeding.
// Live surface: the real bridge's LiveSurface talks HTTP to a scripted loopback z0bridge `--fx` stand-in
// (rc3-11-fx-fixture.ts), injected only through the bridge's own DASH_Z0BRIDGE_URL / DASH_Z0BRIDGE_TOKEN_FILE.
// Selectors: VoiceScreen.tsx, ContinuousVoiceRoot.tsx (+ lib/voice-bar.ts), ChatScreen.tsx (dock voice rows),
// LiveSurface.tsx, LiveArtifactFrame.web.tsx, ArtifactStageScreen.tsx, annotate/AnnotationRoot.tsx, LabScreen.tsx,
// BotFaceLab.tsx, InteractiveTile.tsx, TileGestures.tsx, trace/{StatTile,ActionChip,ReadStrip}.tsx.
// Web evidence only: no real microphone, WebRTC, S Pen, IME or Android permission acceptance.
import {test,expect,pair,composer,send,createBridge,web,type Bridge} from './fixtures';
import {startFxFixture,FX,type FxFixture} from './rc3-11-fx-fixture';
import type {Page,Locator} from 'playwright/test';
import {writeFile} from 'node:fs/promises';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});
// Spec fix (11.13): launchOptions must be file-level (forces a new worker); a fake capture device plus an explicit microphone grant is how the
// army exercises the web recorder (rc3-03-04 and rc3-11-12 do the same). Without it headed Chromium leaves getUserMedia on an unanswered prompt.
test.use({launchOptions:{args:[...(process.env.ARMY_HEADED==='1'?['--ozone-platform=wayland']:[]),'--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],slowMo:Number(process.env.ARMY_SLOWMO||0)}});

// ---------- shared helpers ----------
const btn=(scope:Page|Locator,name:string|RegExp)=>scope.getByRole('button',typeof name==='string'?{name,exact:true}:{name});
const NEW_CHAT='Create new chat'; // RC3 workspace header compose action (a11y-workspace-header.ts)
const chatsPane=(page:Page)=>page.getByTestId('chats-pane');
const WEB_VOICE_NOTE='Pair Dash with z0bridge identity to use voice'; // ContinuousVoiceRoot.start(): web pairing never holds a z0bridge identity

/** Pair, then open a new chat from the workspace header: RC3 presents it full screen. */
async function openFullscreen(page:Page,bridge:Bridge){
 await pair(page,bridge);
 await btn(page,NEW_CHAT).first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
}
/** Back to Main, select the exact new row (never the first roster row) and reopen it windowed. */
async function openWindow(page:Page){
 await btn(page,NEW_CHAT).first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await btn(page,'Back').click({noWaitAfter:true});
 const row=chatsPane(page).locator('[data-testid^=chat-row-]').filter({has:page.getByText('New chat',{exact:true})});
 await expect(row).toHaveCount(1);
 await row.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
}
async function openVoice(page:Page){
 await btn(page,'Expand').first().click({noWaitAfter:true});
 await expect(page.getByRole('heading',{name:/^(Voice|Live call)$/})).toBeVisible();
 await expect(page.getByTestId('voice-caption')).toBeVisible();
}

// ======================================================================
// Voice screen + continuous voice pill (web: honest error path only)
// ======================================================================

test('11.01 Voice screen Start voice in Dash: caption, transcript, label and Back (web reaches the identity error, never live)',async({page,bridge})=>{
 await pair(page,bridge);
 await openVoice(page);
 const caption=page.getByTestId('voice-caption');
 await expect(caption).toHaveText('Realtime voice inside Dash');
 await expect(page.getByTestId('voice-transcript')).toBeAttached();
 const start=btn(page,'Start voice in Dash');
 await expect(start).toBeVisible();
 await expect(start).toContainText('Start voice');
 await expect(page.getByText(/Requires the native Dash APK and explicit voice authorization/)).toBeVisible();
 // Before any attempt the app-wide pill is hidden (voiceBarVisible: attempted || phase!=idle).
 await expect(page.getByTestId('voice-mic-bar')).toHaveCount(0);
 await start.click({noWaitAfter:true});
 // Caption carries the state note; the call is NOT live, so the button never flips to Stop.
 await expect(caption).toHaveText(WEB_VOICE_NOTE);
 await expect(btn(page,'Stop voice in Dash')).toHaveCount(0);
 await expect(start).toBeVisible();
 await expect(page.getByRole('heading',{name:'Voice',exact:true})).toBeVisible();
 // Mute / "Back to chat · call keeps going" only exist while live.
 await expect(btn(page,'Mute')).toHaveCount(0);
 await expect(btn(page,'Back to chat · call keeps going')).toHaveCount(0);
 // No transcript lines without a call.
 await expect(page.getByTestId('voice-transcript').getByText(/^(you|agent)\s/)).toHaveCount(0);
 await btn(page,'Back').first().click({noWaitAfter:true});
 await expect(page.getByTestId('voice-caption')).toHaveCount(0);
 await expect(page.getByRole('tab').nth(1)).toBeVisible();
});

test('11.02 continuous voice pill: error status, Retry, then End voice call and dismiss error closes the error',async({page,bridge})=>{
 await pair(page,bridge);
 await openVoice(page);
 await btn(page,'Start voice in Dash').click({noWaitAfter:true});
 const bar=page.getByTestId('voice-mic-bar');
 await expect(bar).toBeVisible();
 const error=page.getByTestId('voice-error');
 await expect(error).toHaveText(WEB_VOICE_NOTE);
 await expect(error).toHaveAttribute('role','alert');
 // Error pill: primary is Retry (labelled Start voice), plus End; no mute control (mute only exists while connecting/live).
 const retry=page.getByTestId('voice-retry');
 await expect(retry).toHaveAccessibleName('Start voice');
 await expect(retry).toHaveText('Retry');
 await expect(page.getByTestId('voice-mute')).toHaveCount(0);
 await retry.click({noWaitAfter:true});
 await expect(error).toHaveText(WEB_VOICE_NOTE);
 await expect(page.getByTestId('voice-caption')).toHaveText(WEB_VOICE_NOTE);
 const end=btn(page,'End voice call and dismiss error');
 await expect(end).toBeVisible();
 await end.click({noWaitAfter:true});
 await expect(error).toHaveCount(0);
 // attempted=true keeps an idle pill with Start; the status label is the voice-bar accessibility label.
 await expect(page.getByTestId('voice-start')).toHaveAccessibleName('Start voice');
 await expect(page.getByTestId('voice-start')).toHaveText('Start');
 await expect(page.getByTestId('voice-phase')).toHaveAttribute('aria-label','Voice status: idle');
 await expect(page.getByTestId('voice-phase')).toHaveText('Voice idle');
 await expect(page.getByTestId('voice-caption')).toHaveText('Realtime voice inside Dash');
});

test('11.03 windowed chat with a voice error: dock note + Retry Live voice; window owns voice controls (no live controls on web)',async({page,bridge})=>{
 await pair(page,bridge);
 await openVoice(page);
 await btn(page,'Start voice in Dash').click({noWaitAfter:true});
 await expect(page.getByTestId('voice-error')).toHaveText(WEB_VOICE_NOTE);
 await btn(page,'Back').first().click({noWaitAfter:true});
 await expect(chatsPane(page)).toBeVisible();
 await openWindow(page);
 // The dock row shows the voice error note and a Retry Live voice chip.
 const note=page.getByRole('alert').filter({hasText:WEB_VOICE_NOTE}).first();
 await expect(note).toBeVisible();
 const retryLive=btn(page,'Retry Live voice');
 await expect(retryLive).toBeVisible();
 await expect(retryLive).toHaveText('Retry voice');
 // While a window is open its dock is the single voice home: the app-wide pill steps aside.
 await expect(page.getByTestId('voice-mic-bar')).toHaveCount(0);
 // window-voice-controls (voice-mute / voice-end) render only for a connecting/live call.
 await expect(page.getByTestId('window-voice-controls')).toHaveCount(0);
 await retryLive.click({noWaitAfter:true});
 await expect(note).toBeVisible();
 await expect(btn(page,'Retry Live voice')).toBeVisible();
 await expect(page.getByTestId('chat-window')).toBeVisible();
});

// ======================================================================
// Live surface (Hermes) through the real bridge and a scripted z0bridge --fx peer
// ======================================================================

const live=test.extend<{fx:FxFixture}>({
 fx: async({},use,testInfo)=>{const fx=await startFxFixture();try{await use(fx);}finally{await writeFile(testInfo.outputPath('fx-requests.json'),JSON.stringify(fx.requests,null,1));await fx.close();}},
 // Same isolated bridge as fixtures.ts; the z0bridge endpoint is passed through the bridge's own env only.
 bridge: async({persistSession,bridgeOptions,fx},use,testInfo)=>{
  const b=await createBridge(persistSession,{...bridgeOptions,env:{...(bridgeOptions.env??{}),DASH_Z0BRIDGE_URL:fx.url,DASH_Z0BRIDGE_TOKEN_FILE:fx.tokenFile}});
  try{await use(b);}finally{await b.stop();await writeFile(testInfo.outputPath('bridge.log'),b.logs());}
 },
});
// The file-level afterEach above (suite-scoped) also captures final.png for these tests.

/** Full-screen Hermes chat, Options → Live surface switch on, attached to the fx worker. */
async function openLiveSurface(page:Page,bridge:Bridge){
 await openFullscreen(page,bridge);
 await btn(page,'Choose harness').click({noWaitAfter:true});
 await page.getByRole('button',{name:/Hermes/}).last().click({noWaitAfter:true});
 await expect(btn(page,'Choose harness')).toContainText('Hermes');
 await btn(page,'Chat options').click({noWaitAfter:true});
 const sw=page.getByRole('switch',{name:'Live surface',exact:true});
 await expect(sw).toBeVisible();
 await sw.click({noWaitAfter:true});
 const surface=page.getByTestId('live-surface');
 await expect(surface,'live surface must attach through the bridge to the fx fixture').toBeVisible({timeout:30000});
 await expect(surface.getByText(new RegExp(`fx worker · ${FX.model} → Hermes`))).toBeVisible();
 return surface;
}
const fxPosts=(fx:FxFixture,suffix:string)=>fx.requests.filter(r=>r.method==='POST'&&r.path.endsWith(suffix));

live('11.04 Live surface: artifact card with Version n tabs switches the shown fx0 version',async({page,bridge,fx})=>{
 const surface=await openLiveSurface(page,bridge);
 const card=surface.getByTestId('live-artifact');
 await expect(card).toBeVisible();
 await expect(card.getByText(FX.title,{exact:true})).toBeVisible();
 const v1=card.getByRole('tab',{name:'Version 1',exact:true});
 const v2=card.getByRole('tab',{name:'Version 2',exact:true});
 await expect(v2).toHaveAttribute('aria-selected','true');
 await expect(v1).toHaveAttribute('aria-selected','false');
 await expect(card.locator('iframe[title="fx0 design v2"]')).toBeVisible();
 await v1.click({noWaitAfter:true});
 await expect(v1).toHaveAttribute('aria-selected','true');
 await expect(v2).toHaveAttribute('aria-selected','false');
 await expect(card.locator('iframe[title="fx0 design v1"]')).toBeVisible();
 await expect(card.locator('iframe[title="fx0 design v2"]')).toHaveCount(0);
 await expect.soft(page.frameLocator('iframe[title="fx0 design v1"]').getByText('ARMY_FX_V1',{exact:true})).toBeVisible();
 expect(fx.requests.every(r=>r.authorized),'bridge must forward the z0bridge bearer on every call').toBe(true);
});

live('11.05 Live surface: Open live artifact in stage opens ArtifactStage with the static preview; Back returns',async({page,bridge})=>{
 const surface=await openLiveSurface(page,bridge);
 const open=btn(surface,'Open live artifact in stage');
 await expect(open).toBeVisible();
 await open.click({noWaitAfter:true});
 const preview=page.locator('iframe[title="HTML preview"]');
 await expect(preview).toBeVisible();
 await expect(preview).toHaveAttribute('sandbox','');
 await expect(page.getByText(FX.title,{exact:true}).last()).toBeVisible();
 await btn(page,'Back').last().click({noWaitAfter:true});
 await expect(preview).toHaveCount(0);
 await expect(page.getByTestId('live-surface')).toBeVisible();
});

live('11.06 Live surface: Receipts in Hermes: n toggles the receipt list',async({page,bridge})=>{
 const surface=await openLiveSurface(page,bridge);
 const receipts=btn(surface,'Receipts in Hermes: 2');
 await expect(receipts).toBeVisible();
 await expect(receipts).toContainText('In Hermes · 2 receipts');
 // Collapsed: only the newest receipt summary.
 await expect(receipts).toContainText('Decided: Earlier choice');
 await expect(receipts.getByText(/^#41 turn · /)).toHaveCount(0);
 await receipts.click({noWaitAfter:true});
 await expect(receipts.getByText(/#41 turn · ARMY earlier worker turn/)).toBeVisible();
 await expect(receipts.getByText(/#42 intent · Decided Earlier choice/)).toBeVisible();
 await receipts.click({noWaitAfter:true});
 await expect(receipts.getByText(/#41 turn · /)).toHaveCount(0);
});

live('11.07 Live surface: a quick turn streams the reply, adds a version, a control prompt and the timing line',async({page,bridge,fx})=>{
 const surface=await openLiveSurface(page,bridge);
 await expect(surface.getByTestId('live-timing')).toHaveCount(0);
 await expect(composer(page)).toHaveAttribute('placeholder','Live surface · quick reply');
 await send(page,'ARMY live quick turn');
 await expect(surface.getByText('ARMY live quick turn',{exact:true})).toBeVisible();
 await expect(surface.getByText(/ARMY_FX_REPLY: ARMY live quick turn/)).toBeVisible();
 const v3=surface.getByRole('tab',{name:'Version 3',exact:true});
 await expect(v3).toHaveAttribute('aria-selected','true');
 await expect(surface.locator('iframe[title="fx0 design v3"]')).toBeVisible();
 const timing=surface.getByTestId('live-timing');
 await expect(timing).toHaveText(/first char \d+ ms · html \d+\.\d s · turn \d+\.\d s/);
 await expect(btn(surface,/^Receipts in Hermes: [3-9]$/)).toBeVisible();
 const turn=fxPosts(fx,'/turns').at(-1);
 expect(turn?.body,'plain turn goes to the worker verbatim').toMatchObject({text:'ARMY live quick turn'});
 // Control prompt with option buttons: tap records an intent, marks the option, and lands a receipt.
 const group=surface.getByRole('radiogroup',{name:FX.control.prompt});
 await expect(group).toBeVisible();
 const grid=group.getByRole('radio',{name:/Grid layout/});
 const list=group.getByRole('radio',{name:/List layout/});
 await expect(grid).toHaveAttribute('aria-checked','false');
 await expect(list).toContainText('one column');
 await grid.click({noWaitAfter:true});
 await expect(grid).toHaveAttribute('aria-checked','true');
 await expect(grid).toContainText('Grid layout  · Selected');
 await expect(list).toHaveAttribute('aria-checked','false');
 await expect(surface.getByText('Picked Grid layout',{exact:true})).toBeVisible();
 await expect.poll(()=>fxPosts(fx,'/intents').length).toBe(1);
 expect(fxPosts(fx,'/intents')[0]?.body).toMatchObject({intent:{controlId:FX.control.id,value:'grid',label:'Grid layout',surface:'dash-live-surface'}});
 await expect(btn(surface,/^Receipts in Hermes: /)).toContainText('Decided: Grid layout');
});

live('11.08 Live surface: Ask Hermes chip toggles ask mode (placeholder) and routes the question through Hermes',async({page,bridge,fx})=>{
 const surface=await openLiveSurface(page,bridge);
 const ask=surface.getByRole('switch',{name:'Ask Hermes',exact:true});
 await expect(ask).toHaveAttribute('aria-checked','false');
 await expect(composer(page)).toHaveAttribute('placeholder','Live surface · quick reply');
 await ask.click({noWaitAfter:true});
 await expect(ask).toHaveAttribute('aria-checked','true');
 await expect(composer(page)).toHaveAttribute('placeholder','Ask Hermes through the live surface');
 await ask.click({noWaitAfter:true});
 await expect(ask).toHaveAttribute('aria-checked','false');
 await expect(composer(page)).toHaveAttribute('placeholder','Live surface · quick reply');
 await ask.click({noWaitAfter:true});
 await expect(ask).toHaveAttribute('aria-checked','true');
 await send(page,'ARMY ask question');
 await expect(surface.getByText('Ask Hermes: ARMY ask question',{exact:true})).toBeVisible();
 await expect(surface.getByLabel(`Hermes: ${FX.hermesAnswer}`,{exact:true})).toBeVisible();
 await expect(surface.getByText(/ARMY_FX_RELAY/)).toBeVisible();
 // Sending consumes ask mode.
 await expect(ask).toHaveAttribute('aria-checked','false');
 await expect(composer(page)).toHaveAttribute('placeholder','Live surface · quick reply');
 const turn=fxPosts(fx,'/turns').at(-1);
 expect(String((turn?.body as {text?:string}|undefined)?.text)).toMatch(/^Use the hermes tool to ask Hermes exactly this.*ARMY ask question$/);
});

// ======================================================================
// Annotation mode (web: mouse is a finger-class pointer; S Pen is native-only)
// ======================================================================

const tray=(page:Page)=>page.getByTestId('annotation-tray');
const chip=(page:Page,name:string)=>btn(tray(page),name);
// Spec fix: RN Web 0.21 drops accessibilityState.selected/checked, so the rendered state is asserted instead. A selected tool chip is painted
// with a fill (styles.chipOn), an unselected chip is transparent; the selected ink swatch carries a 2px ring (styles.swatchOn).
const CLEAR='rgba(0, 0, 0, 0)';
const chipOn=(l:Locator)=>expect(l).not.toHaveCSS('background-color',CLEAR);
const chipOff=(l:Locator)=>expect(l).toHaveCSS('background-color',CLEAR);
const swatchRing=(l:Locator)=>l.evaluate(el=>{let n:Element=el;while(n.firstElementChild)n=n.firstElementChild;return getComputedStyle(n).borderTopWidth;});

/** Full-screen OMP chat with one finished turn (a registered annotation sink), then Options → Annotate. */
async function enterAnnotate(page:Page,bridge:Bridge){
 await openFullscreen(page,bridge);
 await send(page,'ARMY annotate seed');
 await expect(page.getByText(/ARMY_REPLY: ARMY annotate seed/).filter({visible:true}).first()).toBeVisible();
 await btn(page,'Chat options').click({noWaitAfter:true});
 await btn(page,'Annotate this screen').click({noWaitAfter:true});
 await expect(tray(page)).toBeVisible();
 await expect(page.getByLabel('Annotation mode on',{exact:true})).toHaveCount(1);
}
/** A free band on the overlay: off the tray, under the voice pill, above the 280dp composer clearance. */
async function drawBand(page:Page){
 const vp=page.viewportSize();if(!vp)throw Error('no viewport');
 const box=await tray(page).boundingBox();if(!box)throw Error('tray has no box');
 const floor=vp.height-300, ceil=70;
 if(floor-(box.y+box.height)>=60)return {x0:60,x1:vp.width-60,y:Math.round((box.y+box.height+floor)/2)};
 if(box.y-ceil>=60)return {x0:60,x1:vp.width-60,y:Math.round((ceil+box.y)/2)};
 throw Error(`no free drawing band: tray ${JSON.stringify(box)} viewport ${vp.height}`);
}
async function stroke(page:Page,dy=0){
 const b=await drawBand(page);const y=b.y+dy;
 await page.mouse.move(b.x0,y);await page.mouse.down();
 for(let i=1;i<=12;i++)await page.mouse.move(b.x0+(b.x1-b.x0)*i/12,y+Math.sin(i/2)*14,{steps:2});
 await page.mouse.up();
}
/** CanvasKit loads on first entry; retry the pan until the first stroke commits (Clear enables). */
async function firstStroke(page:Page){
 await expect(async()=>{await stroke(page);await expect(chip(page,'Clear')).toBeEnabled({timeout:1500});}).toPass({timeout:90000});
}

test('11.09 annotation tray: no strokes disables Undo/Clear/Keep/Send; tool chips and ink swatches select',async({page,bridge})=>{
 await enterAnnotate(page,bridge);
 for(const name of ['Undo','Clear','Send and keep drawing','Send annotation'])await expect(chip(page,name)).toBeDisabled();
 await expect(tray(page).getByText(/^→ .+ · hold Talk or type a note/)).toBeVisible();
 const tools=['Pen','Highlighter','Arrow','Box','Circle','Eraser'];
 await chipOn(chip(page,'Pen'));
 for(const o of tools.slice(1))await chipOff(chip(page,o));
 for(const t of tools.slice(1)){
  await chip(page,t).click({noWaitAfter:true});
  await chipOn(chip(page,t));
  for(const o of tools.filter(x=>x!==t))await chipOff(chip(page,o));
 }
 await chip(page,'Pen').click({noWaitAfter:true});
 await chipOn(chip(page,'Pen'));
 const red=tray(page).getByRole('radio',{name:'Red ink',exact:true});
 const accent=tray(page).getByRole('radio',{name:'Accent ink',exact:true});
 await expect.poll(()=>swatchRing(accent)).toBe('2px');
 await expect.poll(()=>swatchRing(red)).toBe('0px');
 await red.click({noWaitAfter:true});
 await expect.poll(()=>swatchRing(red)).toBe('2px');
 await expect.poll(()=>swatchRing(accent)).toBe('0px');
 await accent.click({noWaitAfter:true});
 await expect.poll(()=>swatchRing(accent)).toBe('2px');
 await expect.poll(()=>swatchRing(red)).toBe('0px');
});

test('11.10 annotation: pan on the overlay draws; Undo removes it, Clear wipes all; S Pen mode lets the mouse pass through',async({page,bridge})=>{
 await enterAnnotate(page,bridge);
 await firstStroke(page);
 await expect(chip(page,'Undo')).toBeEnabled();
 await expect(chip(page,'Send annotation')).toBeEnabled();
 await expect(chip(page,'Send and keep drawing')).toBeEnabled();
 await chip(page,'Undo').click({noWaitAfter:true});
 await expect(chip(page,'Clear')).toBeDisabled();
 await expect(chip(page,'Send annotation')).toBeDisabled();
 await stroke(page);await stroke(page,24);
 await expect(chip(page,'Clear')).toBeEnabled();
 await chip(page,'Undo').click({noWaitAfter:true});
 await expect(chip(page,'Clear'),'one stroke must remain after one Undo').toBeEnabled();
 await chip(page,'Clear').click({noWaitAfter:true});
 await expect(chip(page,'Clear')).toBeDisabled();
 await expect(chip(page,'Send annotation')).toBeDisabled();
 // S Pen pen-only mode: only a stylus draws; a mouse/finger stroke passes through.
 const pen=chip(page,'Pen mode: only the S Pen draws, fingers scroll');
 await expect(pen).toHaveText('S Pen');
 await chipOff(pen);
 await pen.click({noWaitAfter:true});
 await expect(pen).toHaveText('S Pen ✓');
 await chipOn(pen);
 await expect(tray(page).getByText(/ · fingers scroll$/)).toBeVisible();
 await stroke(page);
 await page.waitForTimeout(400);
 await expect(chip(page,'Clear'),'mouse must not ink in pen-only mode').toBeDisabled();
 await pen.click({noWaitAfter:true});
 await expect(pen).toHaveText('S Pen');
 await chipOff(pen);
 await stroke(page);
 await expect(chip(page,'Clear')).toBeEnabled();
});

test('11.11 annotation: ⇅ moves the tray between top and bottom; Exit leaves annotation mode',async({page,bridge})=>{
 await enterAnnotate(page,bridge);
 const toBottom=chip(page,'Move tray to the bottom');
 await expect(toBottom).toHaveText('⇅');
 const top=(await tray(page).boundingBox())?.y??0;
 await toBottom.click({noWaitAfter:true});
 const toTop=chip(page,'Move tray to the top');
 await expect(toTop).toBeVisible();
 await expect.poll(async()=>(await tray(page).boundingBox())?.y??0).toBeGreaterThan(top+20);
 await toTop.click({noWaitAfter:true});
 await expect(chip(page,'Move tray to the bottom')).toBeVisible();
 await expect.poll(async()=>Math.abs(((await tray(page).boundingBox())?.y??0)-top)).toBeLessThan(4);
 await chip(page,'Exit annotation').click({noWaitAfter:true});
 await expect(tray(page)).toHaveCount(0);
 await expect(page.getByLabel('Annotation mode on',{exact:true})).toHaveCount(0);
 await expect(composer(page)).toBeVisible();
});

test('11.12 annotation: Keep sends and keeps drawing; Send sends, exits and shows the sent preview',async({page,bridge})=>{
 await enterAnnotate(page,bridge);
 await firstStroke(page);
 await chip(page,'Send and keep drawing').click({noWaitAfter:true});
 // C19: marks without words ask first; Send anyway sends them as they are.
 await expect(tray(page).getByText('No words captured. Send the marks only?',{exact:true})).toBeVisible();
 await chip(page,'Send anyway').click({noWaitAfter:true});
 // The chat receives the composed annotation turn (fixture echoes it).
 await expect(page.getByText(/ARMY_REPLY: Annotated .*\(1 stroke\)/).filter({visible:true}).first()).toBeVisible({timeout:30000});
 await expect(tray(page)).toBeVisible();
 await expect(tray(page).getByRole('alert')).toHaveCount(0);
 await expect(chip(page,'Clear'),'submitted strokes are cleared on Keep').toBeDisabled();
 await stroke(page);await stroke(page,24);
 await expect(chip(page,'Send annotation')).toBeEnabled();
 await chip(page,'Send annotation').click({noWaitAfter:true});
 await expect(tray(page).getByText('No words captured. Send the marks only?',{exact:true})).toBeVisible();
 await chip(page,'Send anyway').click({noWaitAfter:true});
 await expect(page.getByLabel(/^Annotation preview\. Sent to .* · 2 strokes$/)).toBeVisible({timeout:30000});
 await expect(page.getByText(/ARMY_REPLY: Annotated .*\(2 strokes\)/).filter({visible:true}).first()).toBeVisible({timeout:30000});
 await expect(chip(page,'Exit annotation')).toHaveCount(0);
 await expect(page.getByLabel('Annotation mode on',{exact:true})).toHaveCount(0);
});

test('11.13 annotation: Hold to talk on web reports the missing microphone honestly and adds no spoken segment',async({page,bridge,context})=>{
 await context.grantPermissions(['microphone'],{origin:web});
 await enterAnnotate(page,bridge);
 // Entering annotation auto-starts conversation voice; on web it errors, so the talk chip stays a manual hold control.
 const talk=chip(page,'Hold to talk');
 await expect(talk).toBeEnabled();
 await expect(talk).toHaveText('Talk');
 const box=await talk.boundingBox();if(!box)throw Error('talk chip has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 // Releasing before the recorder is prepared cancels the capture silently, so hold until the chip shows it is recording.
 await expect(talk).toHaveText('● Talk',{timeout:15000});
 await page.waitForTimeout(600);await page.mouse.up();
 // The fake capture device records; the isolated bridge has no speech model (DASH_STT_MODEL is a missing file), so transcription must fail visibly.
 await expect(tray(page).getByRole('alert').filter({hasText:/\S/}).first()).toBeVisible({timeout:45000});
 await expect(tray(page).getByText(/hold Talk or type a note/)).toBeVisible();
 await expect(tray(page).getByText(/\d+ spoken/)).toHaveCount(0);
});

// ======================================================================
// Component lab
// ======================================================================

async function openLab(page:Page,bridge:Bridge){
 await pair(page,bridge);
 await btn(page,'Open settings').first().click({noWaitAfter:true});
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
 await btn(page,'Component lab').click({noWaitAfter:true});
 await expect(page.getByRole('heading',{name:'Component lab',exact:true})).toBeVisible();
}
/** FlashList renders a window: wheel the list until the block is mounted, then bring it on screen. */
async function reveal(page:Page,testId:string){
 const target=page.getByTestId(testId);
 const vp=page.viewportSize();if(!vp)throw Error('no viewport');
 await expect(async()=>{
  if(await target.count()===0){await page.mouse.move(vp.width/2,vp.height*0.6);await page.mouse.wheel(0,500);}
  await expect(target).toBeAttached({timeout:800});
 }).toPass({timeout:30000});
 await target.scrollIntoViewIfNeeded();
 return target;
}

test('11.14 Lab: gesture playground tile tap opens detail, double tap pins locally',async({page,bridge})=>{
 await openLab(page,bridge);
 const tile=await reveal(page,'gesture-playground');
 await expect(tile).toHaveAccessibleName(/^Gesture playground\. Tap opens detail/);
 await tile.click({noWaitAfter:true});
 await expect(page.getByTestId('tile-detail')).toBeVisible();
 await btn(page,'Close tile detail').click({noWaitAfter:true});
 await expect(page.getByTestId('tile-detail')).toHaveCount(0);
 await tile.dblclick({noWaitAfter:true});
 await expect(tile.getByText(/Pinned · this view/)).toBeVisible();
 await expect(tile).toHaveAccessibleName(/Pinned locally\.$/);
});

test('11.15 Lab: timeline and lane row variants render; Pick <name> switches the saved pick and Send picks files it',async({page,bridge})=>{
 await openLab(page,bridge);
 const timeline=await reveal(page,'lab-timeline');
 for(const v of ['bars','density','compact'])await expect(timeline.getByTestId(`lab-timeline-${v}`)).toBeAttached();
 const footer=page.getByTestId('lab-picks');
 const pickBars=btn(timeline,'Pick bars'), pickDensity=btn(timeline,'Pick density');
 await expect(pickBars).not.toHaveText('Picked');
 await pickBars.click({noWaitAfter:true});
 await expect(pickBars).toHaveText('Picked'); // Spec fix: RN Web drops accessibilityState.selected; rendered label is the state
 await expect(pickBars).toHaveText('Picked');
 await pickDensity.click({noWaitAfter:true});
 await expect(pickDensity).toHaveText('Picked'); // Spec fix: RN Web drops accessibilityState.selected; rendered label is the state
 await expect(pickBars).not.toHaveText('Picked');
 await expect(pickBars).toHaveText('Pick');
 const lane=await reveal(page,'lab-lane-row');
 for(const v of ['bars','density','compact'])await expect(lane.getByTestId(`lab-lane-${v}`)).toBeAttached();
 await btn(lane,'Pick compact').click({noWaitAfter:true});
 await expect(btn(lane,'Pick compact')).toHaveText('Picked'); // Spec fix: RN Web drops accessibilityState.selected; rendered label is the state
 await reveal(page,'lab-picks');
 await expect(footer).toContainText('timeline: density · lane-row: compact');
 const sendPicks=btn(footer,'Send picks');
 await expect(sendPicks).toHaveText('Send picks');
 await sendPicks.click({noWaitAfter:true});
 await expect(sendPicks).toHaveText('Sent to Dash feedback ✓');
});

test('11.16 Lab: READ strip Replay re-runs the arrival; Action chip Reset undoes lab decisions',async({page,bridge})=>{
 await openLab(page,bridge);
 const read=await reveal(page,'lab-read-strip');
 const strip=read.getByTestId('read-strip-slide');
 await expect(strip).toHaveAttribute('aria-label',/^Read: /);
 const tag=await strip.getByText('READ',{exact:true}).elementHandle();if(!tag)throw Error('READ tag missing');
 await btn(read,'Replay').click({noWaitAfter:true});
 await expect.poll(()=>tag.evaluate(n=>n.isConnected),{message:'Replay remounts the READ strip'}).toBe(false);
 await expect(strip.getByText('READ',{exact:true})).toBeVisible();
 const actions=await reveal(page,'lab-action-chip');
 const chipBtns=actions.getByTestId('chip-lab-buttons');
 await btn(chipBtns,'Do').click({noWaitAfter:true});
 await expect(chipBtns.getByText('✓ Done',{exact:true})).toBeVisible();
 await expect(btn(chipBtns,'Do')).toHaveCount(0);
 await btn(actions,'Reset').click({noWaitAfter:true});
 await expect(chipBtns.getByText('✓ Done',{exact:true})).toHaveCount(0);
 await expect(btn(chipBtns,'Do')).toBeVisible();
 await expect(btn(chipBtns,'Not now')).toBeVisible();
});

test('11.17 Lab: stat tile tap opens detail, hold → Segment cycles the focused segment, Replay remounts',async({page,bridge})=>{
 await openLab(page,bridge);
 const block=await reveal(page,'lab-stat-tile');
 const number=block.getByTestId('stat-number-cut');
 await number.click({noWaitAfter:true});
 await expect(page.getByTestId('tile-detail')).toBeVisible();
 await btn(page,'Close tile detail').click({noWaitAfter:true});
 await expect(page.getByTestId('tile-detail')).toHaveCount(0);
 const meter=block.getByTestId('stat-meter-cut');
 await meter.scrollIntoViewIfNeeded();
 // Spec fix: the tile label is rendered with text-transform: uppercase, so innerText is "CUT".
 await expect.poll(()=>meter.innerText()).toMatch(/^\s*cut/i);
 const box=await meter.boundingBox();if(!box)throw Error('meter tile has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 await page.waitForTimeout(650); // > activateAfterLongPress(350)
 await expect(page.getByTestId('radial-wheel')).toBeVisible();
 const seg=await page.getByTestId('radial-segment').boundingBox();if(!seg)throw Error('Segment action missing from the wheel');
 await page.mouse.move(seg.x+seg.width/2,seg.y+seg.height/2,{steps:12});
 await page.mouse.up();
 await expect(page.getByTestId('radial-wheel')).toHaveCount(0);
 await expect.poll(()=>meter.innerText(),{message:'Segment focuses the first segment (resumed)'}).toMatch(/^\s*resumed/i);
 // Pin a tile, then Replay (key=replay) remounts it and drops the local pin.
 await number.dblclick({noWaitAfter:true});
 await expect(number.getByText(/Pinned · this view/)).toBeVisible();
 await btn(block,'Replay').click({noWaitAfter:true});
 await expect(block.getByTestId('stat-number-cut').getByText(/Pinned · this view/)).toHaveCount(0);
 // Replay re-keys the InteractiveTile (pin reset, asserted above). The focused segment lives in StatTile, which Replay does not remount, so no claim is made about it here.
});

test('11.18 Lab: bot faces Face state <x>, orb states Animate 20 / Cap at 6, voice orb hero cycles',async({page,bridge})=>{
 await openLab(page,bridge);
 const faces=await reveal(page,'lab-bot-faces');
 // Spec fix: RN Web drops accessibilityState.selected; the chosen state is what every profile face reports ("<profile> · <state> · <expression> face").
 const shows=(state:string)=>faces.getByRole('img',{name:new RegExp(' · '+state+' · ')});
 await expect(shows('idle')).toHaveCount(4);
 for(const s of ['thinking','working','done','error','waiting-approval','idle']){
  await btn(faces,`Face state ${s}`).click({noWaitAfter:true});
  await expect(shows(s)).toHaveCount(4);
 }
 await expect(shows('thinking')).toHaveCount(0);
 const orbs=await reveal(page,'lab-orb-states');
 await expect(orbs.getByRole('img',{name:'waiting-approval',exact:true})).toHaveCount(4);
 await btn(orbs,'Animate 20').click({noWaitAfter:true});
 await expect(btn(orbs,'Cap at 6')).toBeVisible();
 await expect(orbs.getByText('Stress: all 20 animated · shared clock')).toBeVisible();
 await expect(orbs.getByRole('img',{name:'thinking stress orb',exact:true})).toHaveCount(32);
 await btn(orbs,'Cap at 6').click({noWaitAfter:true});
 await expect(btn(orbs,'Animate 20')).toBeVisible();
 await expect(orbs.getByRole('img',{name:'thinking stress orb',exact:true})).toHaveCount(0);
 await btn(orbs,'Pick 64px').click({noWaitAfter:true});
 await expect(btn(orbs,'Pick 64px')).toHaveText('Picked'); // Spec fix: rendered label is the state (same as 11.15)
 const hero=await reveal(page,'lab-orb-hero');
 const phases=['listening','speaking','thinking','tool','connecting','idle','listening'];
 for(let i=0;i<phases.length-1;i++){
  await expect(hero.getByRole('img',{name:`hero ${phases[i]}`,exact:true})).toBeVisible();
  await btn(hero,phases[i]!).click({noWaitAfter:true});
  await expect(btn(hero,phases[i+1]!)).toBeVisible();
 }
 await expect(hero.getByRole('img',{name:'hero listening',exact:true})).toBeVisible();
});
