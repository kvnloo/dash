// RC3 area 09: Settings, notifications and pairing.
// Same isolated fixtures as army.spec.ts: real web export, real isolated bridge per test, scripted ACP agent.
// Selectors come from kvnloo/dash integ/rc3-20261027 (written against 2c948dc) (SettingsScreen.tsx, PairScreen.tsx,
// NotificationSettings.tsx, ModelsPanel.tsx, NoticesScreen.tsx, notification-link.ts, a11y-settings-screen.ts,
// a11y-pair-screen.ts, GelNav.tsx, chat-row-actions.ts, util.ts confirmDestructive).
// Web notes: confirmDestructive is window.confirm(`${title}\n\n${message}`); AsyncStorage is localStorage.
import {test,expect,web,pair,createBridge,type Bridge} from './fixtures';
import type {Locator,Page} from 'playwright/test';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});
// Triage fix: headed Chromium leaves the getUserMedia permission prompt pending forever (no user), so "Listen for pairing sound"
// stalled on "Requesting microphone…" and never reached its error. A fake (silent) capture device lets the real sonic attempt run.
test.use({launchOptions:{args:[...(process.env.ARMY_HEADED==='1'?['--ozone-platform=wayland']:[]),'--disable-dev-shm-usage','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],slowMo:Number(process.env.ARMY_SLOWMO||0)}});

// theme.ts night palette (rendered as computed rgb()).
const GOLD='rgb(215, 185, 134)';   // colors.gold = palette.accent #d7b986
const OK='rgb(152, 207, 139)';     // colors.ok #98cf8b
const DANGER='rgb(227, 127, 101)'; // colors.danger #e37f65
const INTRO='Chat with the coding agents on your own computer. Run the bridge there, then enter its address and privately transferred execution token.';
const PAIR_FAILED='Pairing failed. Check the connection details.';
const OFFLINE=/^(Can't reach the bridge|Bridge rejected the token|Connection closed|Bridge stopped answering|Disconnected \(\d+\))$/;

const btn=(page:Page,name:string|RegExp)=>page.getByRole('button',typeof name==='string'?{name,exact:true}:{name});
const heading=(page:Page,name:string)=>page.getByRole('heading',{name,exact:true});
const field=(page:Page,label:'Address'|'Token'|'Folder')=>page.getByRole('textbox',{name:label,exact:true});
const connectBtn=(page:Page)=>btn(page,'Connect');
const radio=(page:Page,side:'Right'|'Left'|'Automatic')=>page.getByRole('radio',{name:`${side} thumb side`,exact:true});
const feedbackSwitch=(page:Page)=>page.getByRole('switch',{name:'In-app feedback',exact:true});
const pairAddress=(page:Page)=>page.getByRole('textbox',{name:'Laptop bridge address',exact:true});
const pairBootstrap=(page:Page)=>page.getByLabel('Bootstrap token',{exact:true});
const pairCode=(page:Page)=>page.getByRole('textbox',{name:'Pairing code',exact:true});
const pairError=(page:Page)=>page.getByLabel(PAIR_FAILED,{exact:true});
const onPair=(page:Page)=>expect(page.getByText('Pair with your laptop',{exact:true}).filter({visible:true}).first()).toBeVisible();
const onMain=(page:Page)=>expect(page.getByRole('tab',{name:'Orchestra',exact:true})).toBeVisible({timeout:25000});

const execToken=async(b:Bridge)=>(await readFile(join(b.dir,'.dash/token'),'utf8')).trim();
/** Host name the bridge reports (GET / with the bootstrap token), i.e. what the app shows in 'Connected to <host>'. */
async function bridgeHost(b:Bridge):Promise<string>{
 const res=await fetch(`http://127.0.0.1:${b.port}/`,{headers:{Authorization:`Bearer ${b.bootstrap}`}});
 const body:unknown=await res.json();
 if(typeof body!=='object'||body===null||!('host' in body)||typeof body.host!=='string')throw Error('bridge / returned no host');
 return body.host;
}
/** A live 6-char pairing code, as the laptop would display it (GET /pair, bootstrap-authorized). */
async function bridgePairCode(b:Bridge):Promise<string>{
 const res=await fetch(`http://127.0.0.1:${b.port}/pair`,{headers:{Authorization:`Bearer ${b.bootstrap}`}});
 const body:unknown=await res.json();
 if(!res.ok||typeof body!=='object'||body===null||!('code' in body)||typeof body.code!=='string')throw Error('bridge /pair returned no code: '+res.status);
 return body.code;
}
/** Publish an agent report through the bridge's real local notice listener (loopback, execution-token bearer). */
async function publishNotice(b:Bridge,notice:{title:string;body:string;url?:string}){
 const m=/notices\s+http:\/\/127\.0\.0\.1:(\d+)\/notice/.exec(b.logs());
 if(!m)throw Error('isolated bridge did not start its notice listener');
 const res=await fetch(`http://127.0.0.1:${m[1]}/notice`,{method:'POST',headers:{Authorization:`Bearer ${await execToken(b)}`,'Content-Type':'application/json'},body:JSON.stringify(notice)});
 expect(res.status,`publish notice ${notice.title}`).toBe(201);
}
/** Saved settings from the web AsyncStorage (localStorage) key dash.settings.v1. */
async function savedSettings(page:Page):Promise<Record<string,unknown>|null>{
 const raw=await page.evaluate(()=>localStorage.getItem('dash.settings.v1'));
 if(raw===null)return null;
 const v:unknown=JSON.parse(raw);
 return typeof v==='object'&&v!==null&&!Array.isArray(v)?Object.fromEntries(Object.entries(v)):null;
}
function answerNextDialog(page:Page,accept:boolean):Promise<string>{
 return new Promise(resolve=>page.once('dialog',async d=>{const m=d.message();if(accept)await d.accept();else await d.dismiss();resolve(m);}));
}
async function longPress(page:Page,target:Locator){
 await target.scrollIntoViewIfNeeded();
 const box=await target.boundingBox();if(!box)throw Error('long-press target has no box');
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();await page.waitForTimeout(900);await page.mouse.up();
}
/** Cold app (no settings) opens Pair; its manual link opens first-run Settings. */
async function coldFirstRunSettings(page:Page){
 await page.goto(web,{waitUntil:'domcontentloaded'});
 await pairAddress(page).waitFor({timeout:120000});
 await page.getByRole('link',{name:'Enter address and token manually',exact:true}).click({noWaitAfter:true});
 await expect(heading(page,'Settings')).toBeVisible();
}
async function coldPair(page:Page){
 await page.goto(web,{waitUntil:'domcontentloaded'});
 await pairAddress(page).waitFor({timeout:120000});
 await onPair(page);
}
/** Paired app: Chats pane -> 'Open settings'. */
async function openSettings(page:Page){
 await page.getByRole('tab',{name:'Chats',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chats-pane').filter({visible:true}).first()).toBeVisible(); // Triage fix: an earlier Main stays mounted and hidden after a re-pair
 await btn(page,'Open settings').first().click({noWaitAfter:true});
 await expect(heading(page,'Settings')).toBeVisible();
}
async function back(page:Page){await btn(page,'Back').first().click({noWaitAfter:true});}
async function centerX(l:Locator){const b=await l.boundingBox();if(!b)throw Error('no box');return b.x+b.width/2;}
/** Paired app with one owned 'New chat' row in the Chats pane (same steps as fixtures.openChat, without opening it). */
async function pairWithChatRow(page:Page,b:Bridge):Promise<Locator>{
 await pair(page,b);
 await btn(page,'Create new chat').first().click({noWaitAfter:true}); // Spec fix: RC3 a11y label
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeVisible();
 await back(page);
 const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('New chat',{exact:true})});
 await expect(row).toHaveCount(1);
 const id=await row.getAttribute('data-testid');if(!id)throw Error('New chat row id missing');
 return page.getByTestId(id);
}
/** GelNav row on Main: Right keeps Expand left of the dots; Left mirrors it (row-reverse). */
async function expandIsLeftOfDots(page:Page):Promise<boolean>{
 const expand=btn(page,'Expand'),dots=page.getByLabel('Primary mobile workspace',{exact:true});
 return (await centerX(expand))<(await centerX(dots));
}
const textColor=(l:Locator)=>l.evaluate(el=>{const t=el.querySelector('div,span')??el;return getComputedStyle(t).color;});

test.describe('rc3 09 first run and manual connect',()=>{
 test('first run Settings shows sonic link and intro; the link replaces Settings with Pair',async({page})=>{
  await coldFirstRunSettings(page);
  const link=btn(page,'Pair with sonic code instead');
  await expect(link).toHaveText('← Pair with sonic code instead');
  await expect(page.getByText(INTRO,{exact:true})).toBeVisible();
  // First run hides the paired-only sections.
  await expect(feedbackSwitch(page)).toHaveCount(0);
  await expect(btn(page,'Forget this bridge')).toHaveCount(0);
  await link.click({noWaitAfter:true});
  await onPair(page);
  await expect(heading(page,'Connect')).toBeVisible();
  await expect(heading(page,'Settings')).toHaveCount(0);
 });

 test('Address, Token (secure) and Folder accept input; Connect stays disabled until Address and Token are valid',async({page,bridge})=>{
  await coldFirstRunSettings(page);
  await expect(page.getByLabel('Not connected',{exact:true}).first()).toBeVisible();
  await expect(connectBtn(page)).toBeDisabled();
  await expect(field(page,'Token')).toHaveAttribute('type','password');
  await field(page,'Address').fill('   ');
  await field(page,'Token').fill('army-token');
  await expect(connectBtn(page)).toBeDisabled();
  await field(page,'Address').fill('127.0.0.1:'+bridge.port);
  await field(page,'Token').fill('   ');
  await expect(connectBtn(page)).toBeDisabled();
  await field(page,'Token').fill('army-token');
  await field(page,'Folder').fill('/srv/army/folder');
  await expect(field(page,'Address')).toHaveValue('127.0.0.1:'+bridge.port);
  await expect(field(page,'Token')).toHaveValue('army-token');
  await expect(field(page,'Folder')).toHaveValue('/srv/army/folder');
  await expect(connectBtn(page)).toBeEnabled();
  await field(page,'Address').fill('');
  await expect(connectBtn(page)).toBeDisabled();
 });

 test('valid address + execution token connects: status is green Connected to <host> and the app goes to Main',async({page,bridge})=>{
  const host=await bridgeHost(bridge);
  await coldFirstRunSettings(page);
  await field(page,'Address').fill('127.0.0.1:'+bridge.port);
  await field(page,'Token').fill(await execToken(bridge));
  await connectBtn(page).click({noWaitAfter:true});
  await onMain(page);
  await expect(heading(page,'Settings')).toHaveCount(0);
  const saved=await savedSettings(page);
  expect(saved?.address).toBe('127.0.0.1:'+bridge.port);
  await openSettings(page);
  const status=page.getByLabel(`Connected to ${host}`,{exact:true});
  await expect(status).toBeVisible();
  await expect(status).toHaveText(`Connected to ${host}`);
  expect(await status.evaluate(el=>el.firstElementChild?getComputedStyle(el.firstElementChild).backgroundColor:'')).toBe(OK);
  // Saved and connected: the action is Reconnect and is disabled until something changes.
  await expect(btn(page,'Reconnect')).toBeDisabled();
 });

 test('wrong token: alert error text, offline status, and no navigation',async({page,bridge})=>{
  await coldFirstRunSettings(page);
  await field(page,'Address').fill('127.0.0.1:'+bridge.port);
  await field(page,'Token').fill('army-wrong-token-0000');
  await connectBtn(page).click({noWaitAfter:true});
  const alert=page.getByRole('alert');
  await expect(alert).toBeVisible({timeout:15000});
  const message=(await alert.innerText()).trim();
  expect(message.length).toBeGreaterThan(0);
  expect(message).not.toContain('army-wrong-token');
  expect(message).toMatch(/reach|token|closed|Timed out|Disconnected|answering/);
  await expect(heading(page,'Settings')).toBeVisible();
  // Triage fix: Settings itself renders AppNav (Orchestra tab), so "no navigation" means Main is not mounted.
  await expect(page.getByTestId('chats-pane')).toHaveCount(0);
  const status=page.getByLabel(OFFLINE);
  await expect(status).toBeVisible({timeout:15000});
  expect(await status.evaluate(el=>el.firstElementChild?getComputedStyle(el.firstElementChild).backgroundColor:'')).toBe(DANGER);
  await expect(page.getByText(/^Connected to /)).toHaveCount(0);
 });
});

test.describe('rc3 09 paired Settings',()=>{
 test('two paired bridges list in failover order with (in use) on the active one',async({page,bridge})=>{
  const second=await createBridge();
  try{
   await pair(page,bridge);
   const first=await savedSettings(page);
   expect(typeof first?.address).toBe('string');
   await openSettings(page);
   await expect(page.getByTestId('settings-bridge-endpoints')).toHaveCount(0);
   await btn(page,'Pair nearby with sonic code').click({noWaitAfter:true});
   await onPair(page);
   await pairAddress(page).fill('127.0.0.1:'+second.port);
   await pairBootstrap(page).fill(second.bootstrap);
   await btn(page,'Pair over Tailscale').click({noWaitAfter:true});
   await onMain(page);
   const now=await savedSettings(page);
   expect(now?.address).not.toBe(first?.address);
   await openSettings(page);
   // Triage fix: the first Settings screen stays mounted (hidden) in the stack; scope to the visible one.
   await expect(page.getByText('Paired bridges (failover order)',{exact:true}).filter({visible:true})).toBeVisible();
   const list=page.getByTestId('settings-bridge-endpoints').filter({visible:true});
   await expect(list).toHaveText(`1. ${String(first?.address)}\n2. ${String(now?.address)} (in use)`,{useInnerText:true});
  } finally {await second.stop();}
 });

 test('Models + opens the models panel as Models −; tap again closes it',async({page,bridge})=>{
  await pair(page,bridge);await openSettings(page);
  const models=btn(page,'Models');
  await expect(models).toHaveText('Models +');
  await expect(btn(page,'Refresh models')).toHaveCount(0);
  await models.click({noWaitAfter:true});
  await expect(models).toHaveText('Models −');
  await expect(btn(page,'Refresh models')).toBeVisible();
  await expect(page.getByText(/^Read-only host assignments/)).toBeVisible();
  await models.click({noWaitAfter:true});
  await expect(models).toHaveText('Models +');
  await expect(btn(page,'Refresh models')).toHaveCount(0);
  await expect(page.getByText(/^Read-only host assignments/)).toHaveCount(0);
 });

 test('Notifications on web: section renders the web text; native toggle and Android settings are absent',async({page,bridge})=>{
  await pair(page,bridge);await openSettings(page);
  await expect(page.getByText('Notifications',{exact:true})).toBeVisible();
  await expect(page.getByText('Notifications and incoming Android shares require the installed Dash build. Expo Go and web remain usable without them.',{exact:true})).toBeVisible();
  await expect(page.getByRole('switch',{name:/^Notifications/})).toHaveCount(0);
  await expect(btn(page,'Open Dash app settings in Android')).toHaveCount(0);
  await expect(page.getByLabel(/^Notification error:/)).toHaveCount(0);
 });

 test('Notices lists agent reports; a target opens it; malformed targets are inert and never crash',async({page,bridge,errors})=>{
  await pair(page,bridge);
  await publishNotice(bridge,{title:'ARMY notice approvals',body:'ARMY body with a target',url:'dash://approvals'});
  await publishNotice(bridge,{title:'ARMY notice plain',body:'ARMY body without a target'});
  // #351: malformed chat targets the bridge accepts (dash: scheme) but the app must reject.
  await publishNotice(bridge,{title:'ARMY notice nested',body:'ARMY malformed nested',url:'dash://chat/a/b'});
  await publishNotice(bridge,{title:'ARMY notice badescape',body:'ARMY malformed escape',url:'dash://chat/%E0%A4%A'});
  await publishNotice(bridge,{title:'ARMY notice dotdot',body:'ARMY malformed dot segment',url:'dash://chat/..'});
  await publishNotice(bridge,{title:'ARMY notice unknown',body:'ARMY unknown host',url:'dash://elsewhere/x'});
  await openSettings(page);
  await btn(page,'Notices · Agent reports').click({noWaitAfter:true});
  await expect(heading(page,'Notices')).toBeVisible();
  for(const t of ['approvals','plain','nested','badescape','dotdot','unknown'])
   await expect(page.getByText(`ARMY notice ${t}`,{exact:true})).toBeVisible({timeout:20000});
  // Only the valid target gets an open button; malformed URLs show as inert text.
  await expect(btn(page,'Open in Dash →')).toHaveCount(1);
  await expect(page.getByText('dash://chat/a/b',{exact:true})).toBeVisible();
  await expect(page.getByText('dash://chat/%E0%A4%A',{exact:true})).toBeVisible();
  expect(errors.filter(e=>e.startsWith('PAGEERROR'))).toEqual([]);
  await btn(page,'Open in Dash →').click({noWaitAfter:true});
  await expect(heading(page,'Approvals')).toBeVisible();
  await expect(heading(page,'Notices')).toHaveCount(0);
  expect(errors.filter(e=>e.startsWith('PAGEERROR'))).toEqual([]);
 });

 test('Thumb side Right / Left / Automatic: selection turns gold, persists and mirrors the nav row',async({page,bridge})=>{
  await pair(page,bridge);
  // Triage fix: a fresh pairing has no saved handedness and parseHandedness() defaults to Right (not Auto); Auto also resolves to Right on web.
  expect(await expandIsLeftOfDots(page)).toBe(true);
  await openSettings(page);
  await expect.poll(()=>textColor(radio(page,'Right'))).toBe(GOLD); // Spec fix: RN Web drops accessibilityState.checked; selection is gold
  expect(await textColor(radio(page,'Automatic'))).not.toBe(GOLD);

  await radio(page,'Left').click({noWaitAfter:true});
  await expect.poll(()=>textColor(radio(page,'Left'))).toBe(GOLD); // Spec fix: RN Web drops accessibilityState.checked; selection is gold
  await expect.poll(()=>textColor(radio(page,'Automatic'))).not.toBe(GOLD);
  await expect.poll(()=>textColor(radio(page,'Left'))).toBe(GOLD);
  expect(await textColor(radio(page,'Right'))).not.toBe(GOLD);
  await expect.poll(async()=>(await savedSettings(page))?.handedness).toBe('left');
  await back(page);
  await expect.poll(()=>expandIsLeftOfDots(page)).toBe(false);

  await openSettings(page);
  await expect.poll(()=>textColor(radio(page,'Left'))).toBe(GOLD); // Spec fix: RN Web drops accessibilityState.checked; selection is gold
  await radio(page,'Right').click({noWaitAfter:true});
  await expect.poll(()=>textColor(radio(page,'Right'))).toBe(GOLD); // Spec fix: RN Web drops accessibilityState.checked; selection is gold
  await expect.poll(()=>textColor(radio(page,'Left'))).not.toBe(GOLD);
  await expect.poll(()=>textColor(radio(page,'Right'))).toBe(GOLD);
  await expect.poll(async()=>(await savedSettings(page))?.handedness).toBe('right');
  await back(page);
  await expect.poll(()=>expandIsLeftOfDots(page)).toBe(true);

  await openSettings(page);
  await radio(page,'Automatic').click({noWaitAfter:true});
  await expect.poll(()=>textColor(radio(page,'Automatic'))).toBe(GOLD); // Spec fix: RN Web drops accessibilityState.checked; selection is gold
  await expect.poll(()=>textColor(radio(page,'Automatic'))).toBe(GOLD);
  await expect.poll(async()=>(await savedSettings(page))?.handedness).toBe('auto');
  await back(page);
  await expect.poll(()=>expandIsLeftOfDots(page)).toBe(true);
 });

 test('Review approvals, Component lab and Pair nearby open their screens',async({page,bridge})=>{
  await pair(page,bridge);await openSettings(page);
  await btn(page,'Review approvals').click({noWaitAfter:true});
  await expect(heading(page,'Approvals')).toBeVisible();
  await back(page);
  await expect(heading(page,'Settings')).toBeVisible();
  await btn(page,'Component lab').click({noWaitAfter:true});
  await expect(heading(page,'Component lab')).toBeVisible();
  await back(page);
  await expect(heading(page,'Settings')).toBeVisible();
  await btn(page,'Pair nearby with sonic code').click({noWaitAfter:true});
  await onPair(page);
  await expect(heading(page,'Connect')).toBeVisible();
 });

 test('In-app feedback switch toggles On/Off, persists, and changes chat-row long-press',async({page,bridge})=>{
  const row=await pairWithChatRow(page,bridge);
  await btn(page,'Open settings').first().click({noWaitAfter:true});
  const sw=feedbackSwitch(page);
  // Triage fix: RN Web 0.21 drops accessibilityState.checked (no aria-checked); the rendered On/Off text is the state.
  await expect(sw).toContainText('On');
  await sw.click({noWaitAfter:true});
  await expect(sw).toContainText('Off');
  await expect.poll(async()=>(await savedSettings(page))?.inAppFeedback).toBe(false);
  // Triage fix: since 0e145ec long-press opens the row BottomActionSheet and sends nothing. Off: only Open and Delete.
  const sheet=page.getByTestId('bottom-action-sheet');
  const close=sheet.getByRole('button',{name:'Close actions',exact:true});
  await back(page);
  await page.getByRole('tab',{name:'Chats',exact:true}).click({noWaitAfter:true});
  await expect(row).toBeVisible();
  await longPress(page,row);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button',{name:/^Open /})).toBeVisible();
  await expect(sheet.getByRole('button',{name:/^Delete .*from this phone/})).toBeVisible();
  await expect(sheet.getByRole('button',{name:/^Send feedback/})).toHaveCount(0);
  await expect(page.getByTestId('composer-field').filter({visible:true})).toHaveCount(0);
  await close.click({noWaitAfter:true});
  await expect(sheet).toHaveCount(0);
  await expect(row).toHaveCount(1);
  // On again: the sheet gains "Send feedback about <chat>"; choosing it opens the feedback chat. No delete confirm.
  await btn(page,'Open settings').first().click({noWaitAfter:true});
  await expect(sw).toContainText('Off');
  await sw.click({noWaitAfter:true});
  await expect(sw).toContainText('On');
  await expect.poll(async()=>(await savedSettings(page))?.inAppFeedback).toBe(true);
  await back(page);
  await page.getByRole('tab',{name:'Chats',exact:true}).click({noWaitAfter:true});
  await expect(row).toBeVisible();
  let dialogs=0;page.on('dialog',d=>{dialogs++;void d.dismiss();});
  await longPress(page,row);
  await expect(sheet).toBeVisible();
  const feedback=sheet.getByRole('button',{name:/^Send feedback about New chat/});
  await expect(feedback).toBeVisible();
  await expect(page.getByTestId('composer-field').filter({visible:true})).toHaveCount(0); // long-press alone sends nothing and opens nothing
  await feedback.click({noWaitAfter:true});
  await expect(page.getByTestId('composer-field').filter({visible:true}).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(dialogs).toBe(0);
 });

 test('Forget this bridge: confirm copy, then bridge stops, chats are wiped and Settings reloads in first-run state',async({page,bridge})=>{
  await pairWithChatRow(page,bridge);
  expect(await savedSettings(page)).not.toBeNull();
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('dash.conversations')||k==='dash.chats.head.v1')),{timeout:15000}).toBe(true);
  await btn(page,'Open settings').first().click({noWaitAfter:true});
  // Cancel keeps everything.
  let dialog=answerNextDialog(page,false);
  await btn(page,'Forget this bridge').click({noWaitAfter:true});
  expect(await dialog).toBe('Forget this bridge?\n\nRemoves the saved address, token, and every chat on this phone.');
  await expect(btn(page,'Forget this bridge')).toBeVisible();
  expect(await savedSettings(page)).not.toBeNull();
  // Confirm: Forget.
  dialog=answerNextDialog(page,true);
  await btn(page,'Forget this bridge').click({noWaitAfter:true});
  await dialog;
  await expect(btn(page,'Pair with sonic code instead')).toBeVisible();
  await expect(page.getByText(INTRO,{exact:true})).toBeVisible();
  await expect(btn(page,'Forget this bridge')).toHaveCount(0);
  await expect(feedbackSwitch(page)).toHaveCount(0);
  await expect(page.getByLabel('Not connected',{exact:true}).first()).toBeVisible();
  await expect(field(page,'Address')).toHaveValue('');
  await expect(field(page,'Token')).toHaveValue('');
  await expect.poll(()=>savedSettings(page)).toBeNull();
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('dash.conversations')||k==='dash.activeId.v1'||k==='dash.chats.head.v1'))).toEqual([]);
  // Thumb radios are disabled without a paired bridge.
  await expect(radio(page,'Left')).toBeDisabled();
  // Cold reload: no settings means the app opens Pair, never Main.
  await page.reload({waitUntil:'domcontentloaded'});
  await pairAddress(page).waitFor({timeout:120000});
  await onPair(page);
  await expect(page.getByRole('tab',{name:'Orchestra',exact:true})).toHaveCount(0);
 });
});

test.describe('rc3 09 Pair screen',()=>{
 test('Pairing code input uppercases and strips non-alphanumerics; a live code pairs',async({page,bridge})=>{
  await coldPair(page);
  await pairCode(page).fill('a1-b2 c3d4');
  await expect(pairCode(page)).toHaveValue('A1B2C3');
  await expect(btn(page,'Pair with code')).toBeDisabled();
  await pairAddress(page).fill('127.0.0.1:'+bridge.port);
  await pairBootstrap(page).fill(bridge.bootstrap);
  await expect(btn(page,'Pair with code')).toBeEnabled();
  await pairCode(page).fill('ab1');
  await expect(btn(page,'Pair with code')).toBeDisabled();
  const code=await bridgePairCode(bridge);
  await pairCode(page).fill(code.toLowerCase().split('').join('-'));
  await expect(pairCode(page)).toHaveValue(code.toUpperCase());
  await btn(page,'Pair with code').click({noWaitAfter:true});
  await onMain(page);
  expect((await savedSettings(page))?.address).toEqual(expect.any(String));
 });

 test('a bad pairing code shows the pairing-failed error and stays on Pair',async({page,bridge})=>{
  await coldPair(page);
  const real=await bridgePairCode(bridge);
  const bad=real==='ZZZZZ9'?'ZZZZZ8':'ZZZZZ9';
  await pairAddress(page).fill('127.0.0.1:'+bridge.port);
  await pairBootstrap(page).fill(bridge.bootstrap);
  await pairCode(page).fill(bad);
  await btn(page,'Pair with code').click({noWaitAfter:true});
  await expect(pairError(page)).toBeVisible({timeout:15000});
  await onPair(page);
  await expect(page.getByRole('tab',{name:'Orchestra',exact:true})).toHaveCount(0);
  expect(await savedSettings(page)).toBeNull();
 });

 test('Pair over Tailscale with laptop address and bootstrap token pairs and opens Main',async({page,bridge})=>{
  await coldPair(page);
  await expect(btn(page,'Pair over Tailscale')).toBeDisabled();
  await pairAddress(page).fill('127.0.0.1:'+bridge.port);
  await expect(btn(page,'Pair over Tailscale')).toBeDisabled();
  await pairBootstrap(page).fill(bridge.bootstrap);
  await expect(pairBootstrap(page)).toHaveAttribute('type','password');
  await btn(page,'Pair over Tailscale').click({noWaitAfter:true});
  await onMain(page);
  const saved=await savedSettings(page);
  expect(saved?.address).toEqual(expect.any(String));
  expect(typeof saved?.token==='string'&&saved.token.length>0).toBe(true);
  expect(saved?.token).not.toBe(bridge.bootstrap);
 });

 test('Pair over Tailscale with a wrong bootstrap token fails and stays on Pair',async({page,bridge})=>{
  await coldPair(page);
  await pairAddress(page).fill('127.0.0.1:'+bridge.port);
  await pairBootstrap(page).fill('army-wrong-bootstrap');
  await btn(page,'Pair over Tailscale').click({noWaitAfter:true});
  await expect(pairError(page)).toBeVisible({timeout:15000});
  await onPair(page);
  expect(await savedSettings(page)).toBeNull();
 });

 test('z0bridge pairing link + Confirm z0bridge pairing: enabled by address+link; web refuses safely',async({page,bridge})=>{
  await coldPair(page);
  const link=page.getByLabel('z0bridge pairing link',{exact:true});
  const confirm=btn(page,'Confirm z0bridge pairing');
  await expect(link).toHaveAttribute('type','password');
  await expect(confirm).toBeDisabled();
  await link.fill('dash://pair?v=2&army=1');
  await expect(confirm).toBeDisabled();
  await pairAddress(page).fill('127.0.0.1:'+bridge.port);
  await expect(confirm).toBeEnabled();
  await confirm.click({noWaitAfter:true});
  const err=pairError(page);
  await expect(err).toBeVisible();
  await expect(err).toHaveText('Use the native Dash app for z0bridge pairing. Browser WebSockets cannot send authorization headers.');
  await onPair(page);
  expect(await savedSettings(page)).toBeNull();
 });

 test('Listen for pairing sound starts sonic pairing (needs address + bootstrap) and never navigates on failure',async({page,bridge})=>{
  await coldPair(page);
  const listen=btn(page,'Listen for pairing sound');
  await expect(listen).toBeDisabled();
  await pairAddress(page).fill('127.0.0.1:'+bridge.port);
  await pairBootstrap(page).fill(bridge.bootstrap);
  await expect(listen).toBeEnabled();
  await listen.click({noWaitAfter:true});
  // Sonic attempt starts: the status line or (no mic on the virtual display) a pairing error appears.
  await expect.poll(async()=>(await page.getByText(/^(Requesting microphone…|Listening… hold the phone by the laptop speakers|Decoding pairing tones…)$/).count())+(await pairError(page).count()),{timeout:20000}).toBeGreaterThan(0);
  // No audio path on the virtual display: it must end in an error and stay on Pair.
  await expect(pairError(page)).toBeVisible({timeout:30000});
  await expect(listen).toBeEnabled();
  await onPair(page);
  await expect(page.getByRole('tab',{name:'Orchestra',exact:true})).toHaveCount(0);
 });

 test('Enter address and token manually opens first-run Settings',async({page})=>{
  await coldPair(page);
  await page.getByRole('link',{name:'Enter address and token manually',exact:true}).click({noWaitAfter:true});
  await expect(heading(page,'Settings')).toBeVisible();
  await expect(btn(page,'Pair with sonic code instead')).toBeVisible();
  await expect(page.getByText(INTRO,{exact:true})).toBeVisible();
  await expect(connectBtn(page)).toBeDisabled();
 });
});
