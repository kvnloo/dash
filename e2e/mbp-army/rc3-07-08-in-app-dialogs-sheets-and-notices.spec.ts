// RC3 tester army, area 08: in-app dialogs, sheets and notices.
// App + bridge under test: kvnloo/dash integ/rc3-20261027 (written against 2c948dc).
// Real Expo web export -> isolated real bridge -> scripted fixture ACP agent (same fixtures as army.spec.ts).
// Selectors come from DashDialogHost.tsx, lib/dash-dialog.ts, lib/a11y-dash-dialog.ts, BottomActionSheet.tsx,
// lib/bottom-action-sheet.ts, util.ts (confirmDestructive), AttachmentNotice.tsx, lib/attachment-notice.ts,
// ReconnectNotice.tsx, lib/reconnect-lifecycle.ts, InteractiveTile.tsx, TileTouch.web.tsx, LabScreen.tsx.
//
// EXPECTED FAILURES at 2c948dc (report, do not "fix" the test):
// - DashDialogHost / dash-dialog have no importer. confirmDestructive still calls window.confirm on web
//   (Alert.alert on native). Every "themed dialog" test fails on the "no system popup" assertion.
// - BottomActionSheet has no importer (chat-row long-press still goes through rowLongPress).
// - AttachmentNotice has no importer. Composer still calls Alert.alert("Attachments", ...), a no-op on RN web.
// - ReconnectNotice has no importer and nothing publishes reconnectStore.
// The web window.confirm path and InteractiveTile (Lab "Gesture playground") are mounted and expected to pass.
import {test,expect,pair,openChat,composer,chatRow,web,type Bridge} from './fixtures';
import {answerNextDialog} from './themed-confirm';
import type {Page,Locator} from 'playwright/test';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const THEMED_TIMEOUT=6000; // RC3 #389/#390 surfaces: fail fast and report, do not hang the run.
const FORGET_MSG='Forget this bridge?\n\nRemoves the saved address, token, and every chat on this phone.';
const DELETE_MSG='Delete chat?\n\nThis removes it from this phone only.';
const CLEAR_MSG='Clear ended chats?\n\nSaved history is removed from this phone only.';

// ---------- UI helpers (role/testID selectors from RC3 source) ----------
const btn=(scope:Page|Locator,name:string|RegExp)=>scope.getByRole('button',typeof name==='string'?{name,exact:true}:{name});
const pane=(page:Page)=>page.getByTestId('chats-pane');
const rows=(page:Page)=>pane(page).locator('[data-testid^="chat-row-"]');
async function selectChats(page:Page){
 await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');
 await expect(pane(page)).toBeVisible();
}
async function openSettings(page:Page){
 await btn(page,'Open settings').first().click({noWaitAfter:true});
 await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
}
async function setInAppFeedback(page:Page,on:boolean){
 await openSettings(page);
 const sw=page.getByRole('switch',{name:'In-app feedback',exact:true});
 await expect(sw).toBeVisible();
 // Spec fix: RN Web 0.21 does not map accessibilityState.checked to aria-checked; assert the rendered On/Off.
 if(((await sw.innerText()).includes('On'))!==on)await sw.click({noWaitAfter:true});
 await expect(sw).toContainText(on?'On':'Off');
 await btn(page,'Back').first().click({noWaitAfter:true});
 await selectChats(page);
}
/** RN Pressable long press with a real pointer hold. */
async function longPress(page:Page,target:Locator,holdMs=900){
 await target.scrollIntoViewIfNeeded();
 const box=await target.boundingBox();if(!box)throw Error('long-press target has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();await page.waitForTimeout(holdMs);await page.mouse.up();
}
/**
 * Records every browser-native dialog and DISMISSES it, so a destructive action can never run
 * through a system popup in a themed-dialog test. Do not combine with answerNextDialog.
 */
function guardNativeDialogs(page:Page):string[]{
 const seen:string[]=[];
 page.on('dialog',d=>{seen.push(d.message());void d.dismiss().catch(()=>{});});
 return seen;
}
/** The themed Dash dialog: RN-web Modal (role=dialog) holding a DashDialogHost card titled `title`. */
const dashDialog=(page:Page,title:string)=>page.getByRole('dialog').filter({has:page.getByRole('heading',{name:title,exact:true})});
async function expectThemedConfirm(page:Page,native:string[],title:string,action:string){
 const dialog=dashDialog(page,title);
 await expect(dialog,`RC3 #389: "${title}" must open the themed Dash dialog`).toBeVisible({timeout:THEMED_TIMEOUT});
 expect(native,'RC3 #389: a confirm must never use a system popup (window.confirm / Alert)').toEqual([]);
 await expect(dialog).toHaveAttribute('aria-modal','true');
 await expect(btn(dialog,'Cancel')).toBeVisible();
 await expect(btn(dialog,action)).toBeVisible();
 await expect(page.getByTestId('dash-dialog-action-cancel')).toBeVisible();
 await expect(page.getByTestId('dash-dialog-action-action:'+action)).toBeVisible();
 return dialog;
}
const settingsSaved=(page:Page)=>page.evaluate(()=>localStorage.getItem('dash.settings.v1'));
/** Kill the fixture-only discoverable OMP holder of this bridge so its row becomes "ended". */
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
/** Local "New chat" row (feedback Off) plus one fixture row that has ended, so both Delete and Clear ended exist. */
async function endedAndLocal(page:Page,bridge:Bridge){
 await openChat(page,bridge);
 await btn(page,'Close chat window').click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await setInAppFeedback(page,false);
 const liveRow=()=>rows(page).filter({has:page.getByLabel('Live on host',{exact:true})}).first();
 await expect(liveRow()).toBeVisible({timeout:30000});
 // Triage fix: open the host-held row once so the phone owns it. A never-opened roster row can be shown from the paged list only
 // (a remote row has no "ended" state: it kept its live dot after the host process died in run 1), or be pruned by the one-time
 // chats.v1 archive migration. Opening stamps openedAt, so the next roster without it turns the owned row "ended" deterministically.
 await liveRow().click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await btn(page,'Close chat window').click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await expect(liveRow()).toBeVisible();
 // The owned row has its own id; read it only now.
 const endedId=await liveRow().getAttribute('data-testid');if(!endedId)throw Error('live row id missing');
 expect(await killOmpHolder(bridge)).toBeGreaterThan(0);
 await expect(page.getByTestId(endedId).getByText('ended',{exact:true})).toBeVisible({timeout:45000});
 const clear=btn(pane(page),'Clear ended');
 await expect(clear).toBeVisible();
 return {endedId,clear};
}

/**
 * Triage fix: since 0e145ec a chat-row long-press opens the BottomActionSheet and sends/asks nothing; the "Delete chat?"
 * confirm is requested only by choosing the sheet's destructive row (feedback is Off in these tests).
 */
async function openRowSheet(page:Page,row:Locator){
 await longPress(page,row);
 const sheet=page.getByTestId('bottom-action-sheet');
 await expect(sheet).toBeVisible({timeout:THEMED_TIMEOUT});
 return {sheet,del:sheet.getByRole('button',{name:/^Delete .*from this phone/})};
}
async function requestDeleteConfirm(page:Page,row:Locator){
 const {del}=await openRowSheet(page,row);
 await del.click({noWaitAfter:true});
}

// ======================================================================
// RC3 #389/#390 themed in-app dialogs (expected FAIL at 2c948dc: DashDialogHost not mounted)
// ======================================================================
test.describe('RC3 08 themed in-app dialogs',()=>{
 test('Forget this bridge opens a themed, focus-trapped Dash modal with Cancel and Forget; Cancel keeps the bridge',async({page,bridge})=>{
  const native=guardNativeDialogs(page);
  await pair(page,bridge);await openSettings(page);
  await btn(page,'Forget this bridge').click({noWaitAfter:true});
  const dialog=await expectThemedConfirm(page,native,'Forget this bridge?','Forget');
  await expect(dialog.getByText('Removes the saved address, token, and every chat on this phone.',{exact:true})).toBeVisible();
  // Cancel sits left of the destructive action; the destructive button is styled differently from Cancel.
  const cancelBox=await btn(dialog,'Cancel').boundingBox();const forgetBox=await btn(dialog,'Forget').boundingBox();
  if(!cancelBox||!forgetBox)throw Error('dialog buttons have no box');
  expect(cancelBox.x<forgetBox.x||cancelBox.y<forgetBox.y).toBeTruthy();
  const bg=async(l:Locator)=>l.evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(await bg(btn(dialog,'Forget'))).not.toBe(await bg(btn(dialog,'Cancel')));
  // Focus trap: keyboard focus never leaves the modal.
  await btn(dialog,'Cancel').focus();
  for(let i=0;i<6;i++){
   await page.keyboard.press('Tab');
   expect(await dialog.evaluate(el=>el.contains(document.activeElement)),'focus must stay inside the dialog').toBe(true);
  }
  await btn(dialog,'Cancel').click({noWaitAfter:true});
  await expect(dialog).toHaveCount(0);
  await expect(btn(page,'Forget this bridge')).toBeVisible();
  expect(await settingsSaved(page)).not.toBeNull();
  expect(native).toEqual([]);
 });

 test('Delete chat confirm is a themed dialog: Cancel keeps the row, Delete removes it',async({page,bridge})=>{
  const native=guardNativeDialogs(page);
  await openChat(page,bridge);
  await btn(page,'Close chat window').click({noWaitAfter:true});
  await setInAppFeedback(page,false);
  const row=chatRow(page);
  await requestDeleteConfirm(page,row);
  let dialog=await expectThemedConfirm(page,native,'Delete chat?','Delete');
  await btn(dialog,'Cancel').click({noWaitAfter:true});
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await requestDeleteConfirm(page,row);
  dialog=await expectThemedConfirm(page,native,'Delete chat?','Delete');
  await btn(dialog,'Delete').click({noWaitAfter:true});
  await expect(dialog).toHaveCount(0);
  await expect(row).toHaveCount(0);
  expect(native).toEqual([]);
 });

 test('Clear ended confirm is a themed dialog: Cancel keeps ended rows, Clear ended removes them',async({page,bridge})=>{
  const native=guardNativeDialogs(page);
  const {endedId,clear}=await endedAndLocal(page,bridge);
  await clear.click({noWaitAfter:true});
  let dialog=await expectThemedConfirm(page,native,'Clear ended chats?','Clear ended');
  await btn(dialog,'Cancel').click({noWaitAfter:true});
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(endedId)).toHaveCount(1);
  await clear.click({noWaitAfter:true});
  dialog=await expectThemedConfirm(page,native,'Clear ended chats?','Clear ended');
  await btn(dialog,'Clear ended').click({noWaitAfter:true});
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId(endedId)).toHaveCount(0);
  expect(native).toEqual([]);
 });

 test('two confirms requested back to back: one dialog at a time, the second shows after the first is answered',async({page,bridge})=>{
  const native=guardNativeDialogs(page);
  const {endedId,clear}=await endedAndLocal(page,bridge);
  const row=chatRow(page);
  // Triage fix: long-press opens the row sheet; request Clear ended, then the sheet's Delete row: two confirms back to back.
  // DOM clicks: the first dialog's scrim covers the sheet, and a real pointer click would be intercepted.
  const {del}=await openRowSheet(page,row);
  await clear.evaluate(el=>(el as HTMLElement).click());
  await del.evaluate(el=>(el as HTMLElement).click());
  const first=dashDialog(page,'Clear ended chats?');const second=dashDialog(page,'Delete chat?');
  await expect(first,'RC3 #390: first request must be the visible themed dialog').toBeVisible({timeout:THEMED_TIMEOUT});
  expect(native,'RC3 #389: no system popup').toEqual([]);
  await expect(second,'queued request must wait behind the visible one').toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await btn(first,'Cancel').click({noWaitAfter:true});
  await expect(first).toHaveCount(0);
  await expect(second).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await btn(second,'Cancel').click({noWaitAfter:true});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId(endedId)).toHaveCount(1);
  await expect(row).toHaveCount(1);
 });

 test('dismissal: Escape and backdrop close the dialog as Cancel; the destructive action never runs',async({page,bridge})=>{
  const native=guardNativeDialogs(page);
  await pair(page,bridge);await openSettings(page);
  await btn(page,'Forget this bridge').click({noWaitAfter:true});
  let dialog=await expectThemedConfirm(page,native,'Forget this bridge?','Forget');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(btn(page,'Forget this bridge')).toBeVisible();
  expect(await settingsSaved(page)).not.toBeNull();
  await btn(page,'Forget this bridge').click({noWaitAfter:true});
  dialog=await expectThemedConfirm(page,native,'Forget this bridge?','Forget');
  await page.getByTestId('dash-dialog-backdrop').click({position:{x:4,y:4},noWaitAfter:true});
  await expect(dialog).toHaveCount(0);
  await expect(btn(page,'Forget this bridge')).toBeVisible();
  expect(await settingsSaved(page)).not.toBeNull();
  expect(native).toEqual([]);
 });
});

// ======================================================================
// Confirm flows answered through the real UI. confirmDestructive is the themed dialog on every platform since #389.
// ======================================================================
test.describe('RC3 08 web confirm path (themed dialog, never window.confirm)',()=>{
 test('Forget this bridge: dismiss cancels, accept forgets the bridge',async({page,bridge})=>{
  await pair(page,bridge);await openSettings(page);
  let dialog=answerNextDialog(page,false);
  await btn(page,'Forget this bridge').click({noWaitAfter:true});
  expect(await dialog).toBe(FORGET_MSG);
  await expect(btn(page,'Forget this bridge')).toBeVisible();
  expect(await settingsSaved(page)).not.toBeNull();
  dialog=answerNextDialog(page,true);
  await btn(page,'Forget this bridge').click({noWaitAfter:true});
  expect(await dialog).toBe(FORGET_MSG);
  await expect(btn(page,'Forget this bridge')).toHaveCount(0,{timeout:15000});
  await expect.poll(()=>settingsSaved(page),{timeout:15000}).toBeNull();
 });

 test('two confirms back to back arrive one at a time, in request order, each answered before the next',async({page,bridge})=>{
  const native=guardNativeDialogs(page);
  const {endedId,clear}=await endedAndLocal(page,bridge);
  const row=chatRow(page);
  // Long-press opens the row sheet (it no longer asks "Delete chat?" itself); Clear ended, then the sheet's Delete row.
  const {del}=await openRowSheet(page,row);
  await clear.evaluate(el=>(el as HTMLElement).click());
  await del.evaluate(el=>(el as HTMLElement).click());
  // Since #389 both are the themed dialog, one at a time, in request order: Clear ended first, Delete only after it is answered.
  expect(await answerNextDialog(page,false)).toBe(CLEAR_MSG);
  expect(await answerNextDialog(page,false)).toBe(DELETE_MSG);
  expect(native,'no system popup on web').toEqual([]);
  // Both cancelled: nothing destructive ran.
  await expect(page.getByTestId(endedId)).toHaveCount(1);
  await expect(row).toHaveCount(1);
 });
});

// ======================================================================
// Bottom action sheet (expected FAIL at 2c948dc: BottomActionSheet not mounted)
// Host: chat-row long-press (RC3 #415 chatRowMenu options).
// ======================================================================
test.describe('RC3 08 bottom action sheet',()=>{
 const sheet=(page:Page)=>page.getByTestId('bottom-action-sheet');
 async function openSheet(page:Page,bridge:Bridge){
  await openChat(page,bridge);
  await btn(page,'Close chat window').click({noWaitAfter:true});
  await setInAppFeedback(page,false);
  await longPress(page,chatRow(page));
  await expect(sheet(page),'long-press must open the themed bottom action sheet').toBeVisible({timeout:THEMED_TIMEOUT});
 }

 test('opens from the bottom with title, rows and Close actions; destructive rows are styled destructive',async({page,bridge})=>{
  const native=guardNativeDialogs(page);
  await openSheet(page,bridge);
  expect(native,'long-press must not fall back to a system confirm').toEqual([]);
  await expect(sheet(page).getByRole('heading',{name:'New chat',exact:true})).toBeVisible();
  await expect(btn(sheet(page),'Close actions')).toBeVisible();
  await expect(page.getByTestId('bottom-action-sheet-close')).toBeVisible();
  // Triage fix: the shipped row menu (lib/chat-row-actions.ts chatRowMenu, since 0e145ec) has ids open/delete and labels
  // "Open New chat, 1 of 2" / "Delete New chat from this phone, 2 of 2"; accept the unshipped lib/chat-row-menu.ts wording too.
  const open=page.getByTestId('bottom-action-sheet-option-open');
  const del=sheet(page).getByRole('button',{name:/^Delete .*from this phone/});
  await expect(open).toBeVisible();await expect(del).toBeVisible();
  await expect(open).toHaveAttribute('aria-label',/^Open (chat: )?New chat, 1 of \d+$/);
  await expect(del).toHaveAttribute('aria-label',/^Delete (chat from this phone: New chat|New chat from this phone), \d+ of \d+$/);
  // Bottom-anchored once the slide-in settles.
  const vh=page.viewportSize()?.height??0;
  await expect.poll(async()=>{const b=await sheet(page).boundingBox();return b?Math.round(b.y+b.height):-1;},{timeout:5000}).toBeGreaterThanOrEqual(vh-24);
  const color=(l:Locator)=>l.getByText(/./).first().evaluate(el=>getComputedStyle(el).color);
  const delColor=await color(del);
  expect(delColor,'destructive row text must differ from a normal row').not.toBe(await color(open));
  const m=/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(delColor);
  expect(m&&Number(m[1])>Number(m[2])&&Number(m[1])>Number(m[3]),'destructive row text is red-dominant: '+delColor).toBeTruthy();
 });

 test('selecting a row closes the sheet, then runs the action',async({page,bridge})=>{
  await openSheet(page,bridge);
  await page.getByTestId('bottom-action-sheet-option-open').click({noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
  await expect(composer(page)).toBeVisible();
 });

 test('Close actions and the backdrop dismiss the sheet with no action',async({page,bridge})=>{
  await openSheet(page,bridge);
  await btn(sheet(page),'Close actions').click({noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
  await expect(chatRow(page)).toHaveCount(1);
  await expect(page.getByTestId('chat-window')).toHaveCount(0);
  await longPress(page,chatRow(page));
  await expect(sheet(page)).toBeVisible({timeout:THEMED_TIMEOUT});
  await page.getByTestId('bottom-action-sheet-backdrop').click({position:{x:4,y:4},noWaitAfter:true});
  await expect(sheet(page)).toHaveCount(0);
  await expect(chatRow(page)).toHaveCount(1);
 });
});

// ======================================================================
// Attachment notice (expected FAIL at 2c948dc: AttachmentNotice not mounted; Composer uses Alert.alert)
// Web-reachable trigger: the 8-attachment limit (MAX_ATTACHMENTS_PER_TURN in shared/protocol.ts).
// ======================================================================
test.describe('RC3 08 attachment notice',()=>{
 async function fillToLimit(page:Page,bridge:Bridge){
  await openChat(page,bridge);
  await btn(page,'Attach file').click({noWaitAfter:true});
  const chooser=page.waitForEvent('filechooser');
  await btn(page,'Files').click({noWaitAfter:true});
  await (await chooser).setFiles(Array.from({length:8},(_,i)=>({name:`army-limit-${i}.txt`,mimeType:'text/plain',buffer:Buffer.from(`ARMY_LIMIT_${i}\n`)})));
  for(let i=0;i<8;i++)await expect(page.getByText(`army-limit-${i}.txt`,{exact:true})).toBeVisible();
 }
 async function hitLimit(page:Page){
  const native=guardNativeDialogs(page);
  let chooserOpened=false;page.on('filechooser',()=>{chooserOpened=true;});
  await btn(page,'Attach file').click({noWaitAfter:true});
  await btn(page,'Files').click({noWaitAfter:true});
  const notice=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Attachment limit reached',exact:true})});
  await expect(notice,'attachment problem must show the in-app AttachmentNotice').toBeVisible({timeout:THEMED_TIMEOUT});
  expect(native,'no system popup for attachment problems').toEqual([]);
  expect(chooserOpened,'no picker past the limit').toBe(false);
  await expect(notice.getByText('Up to 8 files per message. Remove an attachment to add another.',{exact:true})).toBeVisible();
  await expect(btn(notice,'Close attachment notice')).toBeVisible();
  await expect(btn(notice,'OK')).toBeVisible();
  return notice;
 }

 test('limit reached shows title, detail, primary action and Close attachment notice; primary runs (dismiss)',async({page,bridge})=>{
  await fillToLimit(page,bridge);
  const notice=await hitLimit(page);
  await btn(notice,'OK').click({noWaitAfter:true});
  await expect(notice).toHaveCount(0);
  for(let i=0;i<8;i++)await expect(page.getByText(`army-limit-${i}.txt`,{exact:true})).toBeVisible();
  await expect(composer(page)).toBeVisible();
 });

 test('Close attachment notice dismisses without changing the draft',async({page,bridge})=>{
  await fillToLimit(page,bridge);
  const notice=await hitLimit(page);
  await btn(notice,'Close attachment notice').click({noWaitAfter:true});
  await expect(notice).toHaveCount(0);
  for(let i=0;i<8;i++)await expect(page.getByText(`army-limit-${i}.txt`,{exact:true})).toBeVisible();
 });
});

// ======================================================================
// Reconnect notice (expected FAIL at 2c948dc: ReconnectNotice not mounted, reconnectStore unpublished)
// ======================================================================
test.describe('RC3 08 reconnect notice',()=>{
 test('bridge loss shows the reconnect presentation label; it clears when the bridge reconnects',async({page,bridge})=>{
  await openChat(page,bridge);
  await expect(page.getByTestId('pc-reconnect-notice')).toHaveCount(0);
  await bridge.stop();
  const notice=page.getByTestId('pc-reconnect-notice');
  await expect(notice,'connection loss must show the ReconnectNotice').toBeVisible({timeout:15000});
  const action=page.getByTestId('pc-reconnect-action');
  await expect(action).toHaveAttribute('aria-label',/^(Connecting to PC… Retry connection now\.|Reconnecting to PC… Retry connection now\.|PC unavailable · retrying in \d+s\. Retry connection now\.|Offline · reconnects when Dash is active\. Retry connection now\.)$/);
  await expect(notice.getByText(/^(Connecting to PC…|Reconnecting to PC…|PC unavailable · retrying in \d+s|Offline · reconnects when Dash is active)$/)).toBeVisible();
  await expect(notice.getByText('Retry now',{exact:true})).toBeVisible();
  await bridge.start();
  await expect(notice).toHaveCount(0,{timeout:30000});
  await expect(btn(page,'Send')).toBeVisible();
 });
});

// ======================================================================
// Interactive tile (mounted: Lab "Gesture playground", TileDetailProvider at App root). Expected PASS.
// ======================================================================
test.describe('RC3 08 interactive tile',()=>{
 const SUMMARY='Tap opens detail. Double tap pins locally in this view. Triple tap copies this summary. Hold, slide and release selects a radial action; release in the centre cancels.';
 const tile=(page:Page)=>page.getByTestId('gesture-playground');
 async function openLab(page:Page,bridge:Bridge){
  await pair(page,bridge);await openSettings(page);
  await btn(page,'Component lab').click({noWaitAfter:true});
  await expect(tile(page)).toBeVisible({timeout:20000});
  await tile(page).scrollIntoViewIfNeeded();
  await expect(tile(page)).toHaveAttribute('aria-label',/^Gesture playground\. Tap opens detail\./);
 }

 test('tap opens the tile detail sheet; Close tile detail closes it',async({page,bridge})=>{
  await openLab(page,bridge);
  await tile(page).click({noWaitAfter:true});
  const detail=page.getByTestId('tile-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Gesture playground',{exact:true})).toBeVisible();
  await expect(detail.getByText(SUMMARY,{exact:true})).toBeVisible();
  await expect(detail.getByText('Informational detail. No upstream action has been sent.',{exact:true})).toBeVisible();
  await btn(page,'Close tile detail').click({noWaitAfter:true});
  await expect(detail).toHaveCount(0);
  await expect(tile(page)).toBeVisible();
 });

 test('Dismiss tile detail (backdrop) closes the sheet',async({page,bridge})=>{
  await openLab(page,bridge);
  await tile(page).click({noWaitAfter:true});
  const detail=page.getByTestId('tile-detail');
  await expect(detail).toBeVisible();
  await btn(page,'Dismiss tile detail').click({position:{x:4,y:4},noWaitAfter:true});
  await expect(detail).toHaveCount(0);
 });

 test('double-tap pins (label + note reflect pinned), double-tap again unpins, no detail opens',async({page,bridge})=>{
  await openLab(page,bridge);
  await tile(page).dblclick({noWaitAfter:true});
  await expect(tile(page)).toHaveAttribute('aria-label',/\. Pinned locally\.$/);
  await expect(tile(page).getByText(/^Pinned · this view/)).toBeVisible();
  await expect(page.getByTestId('tile-detail')).toHaveCount(0);
  await tile(page).dblclick({noWaitAfter:true});
  await expect(tile(page)).not.toHaveAttribute('aria-label',/Pinned locally/);
  await expect(tile(page).getByText(/Pinned · this view/)).toHaveCount(0);
 });

 test('triple-tap copies the summary (label + note reflect copy state, clipboard holds summary)',async({page,bridge,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:web});
  await openLab(page,bridge);
  await tile(page).click({clickCount:3,noWaitAfter:true});
  await expect(tile(page)).toHaveAttribute('aria-label',/\. Summary copied\.$/);
  await expect(tile(page).getByText(/· Copied$/)).toBeVisible();
  await expect(tile(page)).not.toHaveAttribute('aria-label',/Pinned locally/);
  await expect(page.getByTestId('tile-detail')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe(SUMMARY);
 });

 test('web keyboard equivalents: Enter opens detail, P pins, C copies',async({page,bridge,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:web});
  await openLab(page,bridge);
  await tile(page).focus();
  await page.keyboard.press('p');
  await expect(tile(page)).toHaveAttribute('aria-label',/\. Pinned locally\.$/);
  await page.keyboard.press('c');
  await expect(tile(page)).toHaveAttribute('aria-label',/\. Pinned locally\. Summary copied\.$/);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tile-detail')).toBeVisible();
  await btn(page,'Close tile detail').click({noWaitAfter:true});
  await expect(page.getByTestId('tile-detail')).toHaveCount(0);
 });
});
