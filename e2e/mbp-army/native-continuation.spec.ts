// A phone-created ACP session must survive its one-turn process leaving the roster.
import {test,expect,pair,openChat,composer,send} from './fixtures';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

test.use({persistSession:false,bridgeOptions:{phoneHosts:true}});
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

test('phone-created OMP chat resumes after its ACP process exits and the roster refreshes',async({page,bridge})=>{
 await openChat(page,bridge);
 const first='ARMY_HOLD first persisted phone OMP turn';
 await send(page,first);
 await expect(page.getByText('ARMY_STREAM_BEGIN',{exact:true}).filter({visible:true})).toBeVisible();
 await writeFile(join(bridge.dir,'army-release'),'release\n');
 await expect(page.getByText('ARMY_STREAM_BEGIN ARMY_REPLY: '+first,{exact:true}).filter({visible:true})).toBeVisible({timeout:20000});
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toHaveCount(0);
 // Change external discovery, not the app store or HTTP response. The real
 // roster consumer must handle a fresh successful snapshot after completion.
 const source=join(bridge.dir,'tailscale.json');
 const discovery:{Peer:{s25:{HostName:string}}}=JSON.parse(await readFile(source,'utf8'));
 const marker='ARMY post-turn discovery refresh';
 discovery.Peer.s25.HostName=marker;
 const refreshed=page.waitForResponse(async response=>{
  if(!response.url().startsWith(`http://127.0.0.1:${bridge.port}/roster`)||response.status()!==200)return false;
  return (await response.text()).includes(marker);
 },{timeout:45000});
 await writeFile(source,JSON.stringify(discovery));
 await (await refreshed).finished();
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await composer(page).fill('second turn in the same persisted OMP session');
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
 await expect(page.getByText('This chat has ended on the host. Its saved history is still on this phone.',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
 await expect(page.getByText('ARMY_STREAM_BEGIN ARMY_REPLY: second turn in the same persisted OMP session',{exact:true}).filter({visible:true})).toBeVisible({timeout:20000});
 const calls=(await readFile(join(bridge.dir,'army-acp-calls.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 expect(calls.map(call=>call.method)).toEqual(['session/new','session/load']);
 expect(calls[1].sessionId).toBe('army-fixture-session');
 expect(bridge.logs()).not.toMatch(/turn\.rejected/);
});

for(const differentCwd of [false,true]){
test.describe(`restored OMP panes share one native session${differentCwd?' across launcher directories':''}`,()=>{
 test.use({persistSession:true,bridgeOptions:{env:{ARMY_DUPLICATE_SESSION:'1',ARMY_SECONDARY_CWD:differentCwd?'1':'0'}}});
 test(`two restored OMP panes retain one usable chat when its first pane closes${differentCwd?' across launcher directories':''}`,async({page,bridge},info)=>{
  test.setTimeout(90000);
  const token=(await readFile(join(bridge.dir,'.dash','token'),'utf8')).trim();
  const livePanes=async()=>{
   const response=await fetch(`http://127.0.0.1:${bridge.port}/roster`,{headers:{Authorization:`Bearer ${token}`}});
   const body:{hosts:{self:boolean;agents:{id:string;sessionId?:string;cwd?:string}[]}[]}=await response.json();
   return body.hosts.filter(host=>host.self).flatMap(host=>host.agents)
    .filter(agent=>agent.sessionId==='army-fixture-session'&&agent.id.startsWith('omp:'));
  };
  const roster=async()=>(await livePanes()).map(agent=>agent.id).sort();
  await expect.poll(roster,{timeout:20000}).toEqual(['omp:tern-700001','omp:tern-700002']);
  const panes=await livePanes();
  const primary=panes.find(agent=>agent.id==='omp:tern-700001');
  const secondary=panes.find(agent=>agent.id==='omp:tern-700002');
  expect(primary?.cwd).toBeTruthy();expect(secondary?.cwd).toBeTruthy();
  if(differentCwd)expect(secondary?.cwd).not.toBe(primary?.cwd);
  else expect(secondary?.cwd).toBe(primary?.cwd);
  await pair(page,bridge);
  const row=page.getByTestId('chats-pane').getByRole('button',{name:/^OMP ·/,includeHidden:true});
  await expect(row).toHaveCount(1);
  await row.click({noWaitAfter:true});
  await expect(page.getByTestId('chat-window')).toBeVisible();
  await expect(composer(page)).toBeEditable();
  await send(page,'before restored pane closes');
  await expect(page.getByText(/ARMY_REPLY: before restored pane closes/).filter({visible:true}).first()).toBeVisible({timeout:20000});
  const refreshed=page.waitForResponse(async response=>{
   if(response.url()!==`http://127.0.0.1:${bridge.port}/roster`||response.status()!==200)return false;
   const body=await response.text();
   return body.includes('omp:tern-700002')&&!body.includes('omp:tern-700001');
  },{timeout:45000});
  await writeFile(join(bridge.dir,'.omp','agent','army-holder-primary.stop'),'stop\n');
  await expect.poll(roster,{timeout:20000}).toEqual(['omp:tern-700002']);
  await (await refreshed).finished();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.getByText(/ARMY_REPLY: before restored pane closes/).filter({visible:true}).first()).toBeVisible();
  await composer(page).fill('after restored pane closes');
  await expect(page.getByRole('button',{name:'Send',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});
  await expect(page.getByText(/ARMY_REPLY: after restored pane closes/).filter({visible:true}).first()).toBeVisible({timeout:20000});
  await expect(row).toHaveCount(1);
  await page.screenshot({path:info.outputPath('surviving-pane.png')});
  const calls=(await readFile(join(bridge.dir,'army-acp-calls.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(calls.map(call=>call.method)).toEqual(['session/load','session/load']);
  expect(calls.map(call=>call.sessionId)).toEqual(['army-fixture-session','army-fixture-session']);
  expect(calls.map(call=>call.cwd)).toEqual([primary?.cwd,secondary?.cwd]);
 });
});
}
