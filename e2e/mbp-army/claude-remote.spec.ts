// Continue a Claude Code chat recorded on another computer from the phone (DASH_REMOTE_HOSTS).
// Real Expo web UI -> isolated real bridge -> ssh stand-in -> the real bridge/bin/dash-acp of this
// checkout -> Claude-shaped ACP fixture, resumed by session id without a history replay.
import {test,expect,composer,send,pair,REMOTE_SESSION} from './fixtures';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const visible=(page:import('playwright/test').Page,rx:RegExp)=>page.getByText(rx).filter({visible:true}).first();
const remoteRow=(page:import('playwright/test').Page)=>page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({hasText:'ARMY remote Claude Code chat'});
const lines=async(path:string)=>(await readFile(path,'utf8').catch(()=>'')).split('\n').filter(Boolean);

test.describe('Claude Code chat recorded on another computer',()=>{
 test.use({bridgeOptions:{remoteClaude:'route'}});
 test('resumes on that computer and streams the reply, turn after turn',async({page,bridge},info)=>{
  await pair(page,bridge);
  await expect(remoteRow(page)).toHaveCount(1,{timeout:30000});
  await remoteRow(page).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByText(/View only/)).toHaveCount(0);
  await expect(page.getByRole('alert').filter({hasText:/cannot route|Pair with that computer|host is unavailable/})).toHaveCount(0);
  await expect(page.getByTestId('chat-window-badge')).toHaveAttribute('aria-label',/host army-remote, harness Claude Code/);
  await expect(composer(page)).toBeEditable();
  await send(page,'ARMY_SLOW remote claude resume ping');
  await expect(visible(page,/ARMY_STREAM_BEGIN/)).toBeVisible({timeout:15000});
  await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
  await expect(visible(page,/ARMY_CLAUDE_REPLY: ARMY_SLOW remote claude resume ping/)).toBeVisible({timeout:20000});
  await page.screenshot({path:info.outputPath('remote-claude-reply.png')});
  await send(page,'second remote turn');
  await expect(visible(page,/ARMY_CLAUDE_REPLY: second remote turn/)).toBeVisible({timeout:20000});
  const log=bridge.logs();
  expect(log).toMatch(new RegExp(`ws\\.chat id=\\S+ harness=claude hostId=machine:army-remote profileId=av:claude:${REMOTE_SESSION} session=resume`));
  expect(log.match(/turn\.remote id=\S+ harness=claude machine=army-remote/g)?.length).toBe(2);
  expect(log).not.toMatch(/turn\.rejected/);
  // The hop: the ssh stand-in got the machine and the launcher command for the session's directory.
  const hops=await lines(join(bridge.dir,'army-ssh.log'));
  expect(hops.length).toBe(2);
  for(const hop of hops) expect(hop).toBe(`army-remote\tdash-acp claude --cwd '${join(bridge.dir,'remote-home','project')}'`);
  // The other computer: session/resume (no history replay) of the native id, in the session's directory.
  const calls=(await lines(join(bridge.dir,'army-acp-calls.jsonl'))).map(l=>JSON.parse(l));
  expect(calls.map(c=>c.method)).toEqual(['session/resume','session/resume']);
  for(const c of calls){expect(c.sessionId).toBe(REMOTE_SESSION);expect(c.cwd).toBe(join(bridge.dir,'remote-home','project'));expect(c.pwd).toBe(join(bridge.dir,'remote-home','project'));}
 });
});

test.describe('the same chat without a route to its computer',()=>{
 test.use({bridgeOptions:{remoteClaude:'off'}});
 test('opens view only and sends nothing',async({page,bridge})=>{
  await pair(page,bridge);
  await expect(remoteRow(page)).toHaveCount(1,{timeout:30000});
  await remoteRow(page).click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(page.getByText(/View only/).first()).toBeVisible();
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();
  expect(bridge.logs()).not.toMatch(/ws\.chat |turn\.remote/);
 });
});
