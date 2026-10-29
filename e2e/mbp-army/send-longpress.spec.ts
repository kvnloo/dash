// RC3 owner regressions (2026-10-27, PR #457): long-press sent a message; Claude Code chats could not
// send; the live bridge logged ws.bad_message every 30 s. Real Expo web UI -> isolated real bridge -> ACP fixture.
import {test,expect,composer,send,pair} from './fixtures';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const visible=(page:import('playwright/test').Page,rx:RegExp)=>page.getByText(rx).filter({visible:true}).first();
const turnLines=(log:string)=>log.split('\n').filter(l=>/ ws\.chat | turn\.start | turn\.remote | voice\.| turn\.rejected /.test(l));

test('long-press on a chat row opens the row menu and sends nothing',async({page,bridge},info)=>{
 await pair(page,bridge);
 const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY native fixture'});
 await expect(row).toHaveCount(1,{timeout:30000});
 const before=turnLines(bridge.logs()).length;
 await row.hover();
 await page.mouse.down();await page.waitForTimeout(900);await page.mouse.up();
 const sheet=page.getByTestId('bottom-action-sheet');
 await expect(sheet).toBeVisible();
 await expect(sheet.getByText('Open',{exact:true})).toBeVisible();
 await expect(sheet.getByText('Send feedback about this chat',{exact:true})).toBeVisible();
 await expect(sheet.getByText('Delete from this phone',{exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('longpress-menu.png')});
 // Nothing opened, nothing sent: no chat window, no feedback chat, no turn on the bridge.
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await expect(page.getByText('Dash feedback',{exact:true})).toHaveCount(0);
 await page.waitForTimeout(2500);
 expect(turnLines(bridge.logs()).slice(before)).toEqual([]);
 await page.getByTestId('bottom-action-sheet-close').click({noWaitAfter:true});
 await expect(sheet).toHaveCount(0);
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await page.waitForTimeout(1000);
 expect(turnLines(bridge.logs()).slice(before)).toEqual([]);
});

test('swiping from a chat row never opens it and the next single tap opens that exact chat without sending',async({page,bridge})=>{
 await page.setViewportSize({width:390,height:844});
 await pair(page,bridge);
 const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY native fixture'});
 await expect(row).toHaveCount(1,{timeout:30000});
 const before=turnLines(bridge.logs()).length;
 const box=await row.boundingBox();if(!box)throw Error('Chat row has no bounds');
 const y=box.y+box.height/2;
 await page.mouse.move(box.x+box.width*.85,y);await page.mouse.down();
 await page.mouse.move(box.x+box.width*.1,y,{steps:12});await page.mouse.up();
 await expect(page.getByRole('tab').nth(2)).toHaveAttribute('aria-selected','true');
 await expect(page.getByTestId('chat-window')).toHaveCount(0);
 await expect(page.getByTestId('bottom-action-sheet')).toHaveCount(0);
 await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');
 await row.click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window')).toBeVisible();
 await expect(composer(page)).toBeInViewport();
 await expect(page.getByTestId('chat-window')).toContainText('ARMY native fixture');
 expect(turnLines(bridge.logs()).slice(before)).toEqual([]);
});

test('send to a new Claude Code chat gets a streamed reply',async({page,bridge},info)=>{
 await pair(page,bridge);
 await page.getByRole('button',{name:'Create new chat',exact:true}).first().click({noWaitAfter:true});
 await expect(composer(page)).toBeVisible();
 await page.getByRole('button',{name:'Choose harness',exact:true}).click({noWaitAfter:true});
 await page.getByRole('button',{name:'Claude Code',exact:true}).click({noWaitAfter:true});
 await expect(composer(page)).toHaveAttribute('placeholder',/Claude Code/);
 await send(page,'ARMY_SLOW claude new chat ping');
 await expect(visible(page,/ARMY_STREAM_BEGIN/)).toBeVisible({timeout:15000});
 await expect(visible(page,/ARMY_CLAUDE_REPLY: ARMY_SLOW claude new chat ping/)).toBeVisible({timeout:20000});
 await page.screenshot({path:info.outputPath('claude-new-reply.png')});
 const log=bridge.logs();
 expect(log).toMatch(/ws\.chat id=\S+ harness=claude /);
 expect(log).not.toMatch(/turn\.rejected/);
});

test.describe('archived Claude Code chat recorded on this host',()=>{
 test.use({bridgeOptions:{archiveClaude:true}});
 test('opens sendable (not view-only) from Chats and gets a streamed reply',async({page,bridge},info)=>{
  await pair(page,bridge);
  const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY archived Claude Code chat'});
  await expect(row).toHaveCount(1,{timeout:30000});
  await row.click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByText(/View only/)).toHaveCount(0);
  await expect(composer(page)).toBeEditable();
  await send(page,'ARMY_SLOW archived claude resume ping');
  await expect(visible(page,/ARMY_STREAM_BEGIN/)).toBeVisible({timeout:15000});
  await expect(visible(page,/ARMY_CLAUDE_REPLY: ARMY_SLOW archived claude resume ping/)).toBeVisible({timeout:20000});
  await page.screenshot({path:info.outputPath('claude-archived-reply.png')});
  const log=bridge.logs();
  expect(log).toMatch(/ws\.chat id=\S+ harness=claude hostId=\S+ profileId=av:claude:11111111-2222-4333-8444-555555555555 session=resume/);
  expect(log).not.toMatch(/turn\.rejected/);
 });
});

test('the app socket keepalive is answered, never logged as ws.bad_message',async({bridge})=>{
 const token=(await readFile(join(bridge.dir,'.dash/token'),'utf8')).trim();
 const ws=new WebSocket(`ws://127.0.0.1:${bridge.port}/ws?token=${encodeURIComponent(token)}`);
 const frames:string[]=[];
 ws.addEventListener('message',e=>frames.push(String(e.data)));
 await new Promise<void>((resolve,reject)=>{ws.addEventListener('open',()=>resolve());ws.addEventListener('error',()=>reject(Error('ws error')));});
 await expect.poll(()=>frames.some(f=>f.includes('"type":"hello"'))).toBe(true);
 // Exactly the frame app/src/net/socket-keepalive.ts sends every 30 s.
 ws.send('{"type":"ping"}');
 await expect.poll(()=>frames.some(f=>f.replace(/\s/g,'')==='{"type":"pong"}'),{timeout:5000}).toBe(true);
 ws.close();
 expect(bridge.logs()).not.toMatch(/ws\.bad_message/);
});
