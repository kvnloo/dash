// Two owner-visible pieces of finished work that sat unwired in the lane (PR #483 chat previews, PR #210
// harness submenu). Real Expo web UI -> isolated real bridge -> scripted ACP fixture agent.
import {test,expect,openChat,composer,send,chatRow} from './fixtures';
import type {Page} from 'playwright/test';
import {writeFile} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {execFileSync} from 'node:child_process';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const toList=async(page:Page)=>{await page.getByRole('button',{name:'Close chat window',exact:true}).click({noWaitAfter:true});await expect(page.getByTestId('chats-pane')).toBeVisible();};
const reopen=async(page:Page)=>{await chatRow(page).click({noWaitAfter:true});await expect(page.getByTestId('chat-window')).toBeVisible();};
const preview=(page:Page)=>chatRow(page).getByTestId('chat-work-summary');

test('Chats list rows prioritize failures and keep a current task rather than the last reply',async({page,bridge},info)=>{
 execFileSync('git', ['init', '-q', bridge.dir]);
 await openChat(page,bridge);
 // A chat nobody has written to says so; it does not repeat its title or folder.
 await toList(page);
 await expect(preview(page)).toHaveText('No summary yet');

 // The agent fails: the row says Failed and why, not "No summary yet".
 await reopen(page);await send(page,'ARMY_ERROR preview failure');
 await expect(page.getByText(/ACP request failed during session\/prompt/).first()).toBeVisible();
 await toList(page);
 await expect(preview(page)).toHaveText(/^Failed · ACP request failed during session\/prompt/);

 // A turn still in flight outranks the old failure.
 await reopen(page);await send(page,'ARMY_HOLD preview in flight');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
 await toList(page);
 await expect(chatRow(page)).toContainText(/Running/);
 await expect(preview(page)).toHaveText('Task · ARMY_HOLD preview in flight');
 await page.screenshot({path:info.outputPath('row-preview-in-flight.png')});

 // The reply lands, but the work label is still the request, not the latest message.
 await writeFile(join(bridge.dir,'army-release'),'');
 await reopen(page);
 const reply = page.getByText('ARMY_STREAM_BEGIN ARMY_REPLY: ARMY_HOLD preview in flight', { exact: true }).filter({ visible: true });
 await expect(reply).toBeVisible({timeout:30000});
 const lastMessage = await reply.innerText();
 await toList(page);
 await expect(preview(page)).toHaveText('Task · ARMY_HOLD preview in flight');
 await expect(preview(page)).not.toHaveText(lastMessage);
 await expect(chatRow(page)).not.toContainText('Failed');
 await expect(chatRow(page).getByText('Repo · ' + basename(bridge.dir), { exact: true })).toBeVisible();

 await reopen(page);
 await send(page, 'Please review the keyboard layout.');
 await expect(page.getByText('ARMY_REPLY: Please review the keyboard layout.', { exact: true }).filter({ visible: true })).toBeVisible();
 await send(page, 'Thanks!');
 await expect(page.getByText('ARMY_REPLY: Thanks!', { exact: true }).filter({ visible: true })).toBeVisible();
 await toList(page);
 await expect(preview(page)).toHaveText('Task · review the keyboard layout.');

});

test('holding the Harness row in the chat options lists the harnesses and choosing one switches without sending',async({page,bridge},info)=>{
 await page.setViewportSize({width:390,height:780});
 await openChat(page,bridge);
 await page.getByRole('button',{name:'Options. Current surface: Chat',exact:true}).click({noWaitAfter:true});
 const row=page.getByTestId('composer-menu-row-harness');
 await expect(row).toBeVisible();
 const box=await row.boundingBox();if(!box)throw Error('Harness row has no box');
 // A tap would open the full picker. A hold opens the harness list right under the row instead.
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForTimeout(700);await page.mouse.up();
 const list=page.getByTestId('composer-menu-submenu-harness');
 await expect(list).toBeVisible();
 await expect(page.getByRole('dialog',{name:/harness/i})).toHaveCount(0);
 for(const name of ['OMP','Claude Code','Hermes'])await expect(list.getByRole('button',{name,exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('harness-hold-menu.png')});

 const before=bridge.logs().split('\n').filter(l=>/ ws\.chat | turn\.start /.test(l)).length;
 await list.getByRole('button',{name:'Hermes',exact:true}).click({noWaitAfter:true});
 await expect(page.getByTestId('chat-window-badge')).toContainText('Hermes');
 await expect(composer(page)).toHaveAttribute('placeholder',/Hermes/);
 // Choosing only switches: nothing is sent.
 await page.waitForTimeout(1000);
 expect(bridge.logs().split('\n').filter(l=>/ ws\.chat | turn\.start /.test(l)).length).toBe(before);
});
