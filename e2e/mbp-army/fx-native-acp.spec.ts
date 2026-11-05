import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test,expect,openChat,chooseHarness,send} from './fixtures';

type SessionCall={agent:string;method:string;sessionId?:string};
function isSessionCall(value:unknown):value is SessionCall {
 return typeof value==='object'&&value!==null&&'agent' in value&&typeof value.agent==='string'
  &&'method' in value&&typeof value.method==='string'
  &&(!('sessionId' in value)||typeof value.sessionId==='string');
}
async function fxSessionCalls(dir:string) {
 const text=await readFile(join(dir,'army-acp-calls.jsonl'),'utf8').catch(()=>'');
 return text.split('\n').filter(Boolean).map((line):unknown=>JSON.parse(line)).filter(isSessionCall)
  .filter(row=>row.agent==='fx')
  .map(row=>({method:row.method,sessionId:row.sessionId}));
}

test.use({bridgeOptions:{phoneHosts:true}});
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

test('fx selection streams a native ACP reply and continues the exact returned session',async({page,bridge})=>{
 await openChat(page,bridge);
 await chooseHarness(page,'fx');
 // Hold completion until the UI has displayed a real ACP chunk, not only a final response.
 await send(page,'ARMY_HOLD fx first native turn');
 await expect(page.getByText(/ARMY_STREAM_BEGIN/).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible();
 await expect.poll(()=>fxSessionCalls(bridge.dir)).toEqual([{method:'session/new',sessionId:undefined}]);
 await writeFile(join(bridge.dir,'army-release'),'release\n');
 await expect(page.getByText(/ARMY_REPLY: ARMY_HOLD fx first native turn/).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
 // A successful changed roster after the executor exits must not end this session.
 const source=join(bridge.dir,'tailscale.json');
 const discovery:{Peer:{s25:{HostName:string}}}=JSON.parse(await readFile(source,'utf8'));
 const marker='ARMY fx post-turn roster refresh';
 discovery.Peer.s25.HostName=marker;
 const refreshed=page.waitForResponse(async response=>{
  if(!response.url().startsWith(`http://127.0.0.1:${bridge.port}/roster`)||response.status()!==200)return false;
  return (await response.text()).includes(marker);
 },{timeout:45000});
 await writeFile(source,JSON.stringify(discovery));
 await (await refreshed).finished();
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 await send(page,'fx second native turn');
 await expect(page.getByText(/ARMY_REPLY: fx second native turn/).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Send',exact:true})).toBeVisible();
 // The shared ACP peer returns this exact id from session/new. A second process must
 // load it, rather than silently opening another session or using a legacy ask command.
 await expect.poll(()=>fxSessionCalls(bridge.dir)).toEqual([
  {method:'session/new',sessionId:undefined},
  {method:'session/load',sessionId:'army-fixture-session'},
 ]);
});
