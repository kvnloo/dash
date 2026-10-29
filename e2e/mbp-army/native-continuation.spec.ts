// A phone-created ACP session must survive its one-turn process leaving the roster.
import {test,expect,openChat,composer,send} from './fixtures';
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
