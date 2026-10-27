import { test as base, expect, type Page, type Locator } from 'playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { once } from 'node:events';
export const web = process.env.ARMY_WEB || 'http://127.0.0.1:18400';
const root = resolve(__dirname, '../..');
const bridgeRoot = process.env.ARMY_BRIDGE_ROOT || root;
const bun = process.env.ARMY_BUN || execFileSync('sh',['-c','command -v bun'],{encoding:'utf8'}).trim();
const bunDir = dirname(bun);
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export type Bridge = { dir: string; port: number; bootstrap: string; stop(): Promise<void>; start(): Promise<void>; logs(): string };
export async function createBridge(persistSession=true): Promise<Bridge> {
 const dir = await mkdtemp(join(process.env.ARMY_TMP || tmpdir(), 'dash-army-'));
 const bin = join(dir,'bin'); await mkdir(bin); await mkdir(join(dir,'tmp'));await mkdir(join(dir,'.hermes'));await mkdir(join(dir,'.omp','agent'),{recursive:true});
 for (const name of ['hermes','omp']) await writeFile(join(bin,name), '#!/bin/sh\nexec '+quote(bun)+' '+quote(join(__dirname,'fixture-agent.ts'))+'\n', {mode:0o700});
 await writeFile(join(bin,'tailscale'),'#!/bin/sh\nexit 1\n',{mode:0o700});
 const env = {...process.env, HOME:dir, TMPDIR:join(dir,'tmp'), PATH:bin+':'+bunDir+':/usr/bin:/bin', DASH_HOST:'127.0.0.1', DASH_ALLOW_LOOPBACK:'1', DASH_PORT:'0', DASH_CWD:dir, HERMES_HOME:join(dir,'.hermes'), DASH_HERMES_ROOT:join(dir,'.hermes'), PI_CODING_AGENT_DIR:join(dir,'.omp','agent'), DASH_Z0LIVE_SESSIONS:join(dir,'z0live'), XDG_CONFIG_HOME:join(dir,'.config'), DASH_CREDENTIAL_DIR:join(dir,'.dash'), DASH_CONFIG_DIR:join(dir,'.dash'), DASH_GATE_DIR:join(dir,'gate'), DASH_GATE_ENABLED:'1', DASH_GATE_LIVE:'0', DASH_GATE_OWNER_DECISIONS:'0', ARMY_PERSIST_SESSION:persistSession?'1':'0', DASH_ENABLE_LEGACY_CLI:'0', DASH_ALLOWED_ORIGINS:web, DASH_STT_MODEL:join(dir,'no-model'), ARMY_BRIDGE_ROOT:bridgeRoot, DASH_KANBAN_DB:join(dir,'work.db'), DASH_SUPERVISION_DIR:join(dir,'.local/state/dash/supervision'), DASH_ORCHESTRA_PROFILES:join(dir,'.hermes')};
 const seed = spawn(bun,[join(__dirname,'seed-gate.ts')],{env,stdio:['ignore','pipe','pipe']});
 let seedLog=''; seed.stderr.on('data',d=>seedLog+=d); const [seedCode]=await once(seed,'exit'); if(seedCode!==0) throw Error('gate seed: '+seedLog);
 let child: ChildProcess; let log=''; let port=0;
 const f: Bridge = {dir,port:0,bootstrap:'',logs:()=>log,
  async start() {
   const oldPort=port; if(oldPort) env.DASH_PORT=String(oldPort);
   let startup='';child=spawn('bwrap',['--bind','/','/','--unshare-pid','--proc','/proc','--dev','/dev','--die-with-parent','/bin/sh','-c','if [ "$ARMY_PERSIST_SESSION" = 1 ]; then "$1" "$2" & fi; exec "$1" "$3"','army-bridge',bun,join(__dirname,'session-holder.ts'),join(bridgeRoot,'bridge/index.ts')],{cwd:bridgeRoot,env,stdio:['ignore','pipe','pipe']});
   const collect=(d: Buffer)=>{const s=d.toString();log+=s;startup+=s; const m=/dash bridge\s+ws:\/\/127\.0\.0\.1:(\d+)/.exec(startup);if(m)port=Number(m[1]);};
   child.stdout?.on('data',collect);child.stderr?.on('data',collect);
   await expect.poll(()=>port>0 && startup.includes('dash bridge'),{timeout:20000,message:'isolated real bridge startup'}).toBeTruthy();
   f.port=port; f.bootstrap=(await readFile(join(dir,'.dash/bootstrap-token'),'utf8')).trim();
  }, async stop(){if(child && child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
 };await f.start();
 if(persistSession){
  const token=(await readFile(join(dir,'.dash/token'),'utf8')).trim();
  let lastRoster='';
  await expect.poll(async()=>{
   const response=await fetch(`http://127.0.0.1:${f.port}/roster`,{headers:{Authorization:`Bearer ${token}`}});
   const body:unknown=await response.json();
   const text=JSON.stringify(body);
   await writeFile(join(dir,'fixture-roster.json'),text);lastRoster=text;
   return text.includes('omp:')&&text.includes('army-fixture-session')&&text.includes('hermes:session:default:army-fixture-session');
  },{timeout:15000,message:'fixture must expose real native OMP and Hermes session rows before UI tests'}).toBe(true).catch((e:unknown)=>{throw Error(String(e)+'\nlast roster: '+lastRoster.slice(0,1500)+'\nbridge log tail: '+f.logs().slice(-1500));});
 }
 return f;
}
export const test=base.extend<{bridge:Bridge; persistSession:boolean; errors:string[]; metrics: {name:string;ms:number}[]}>({
 persistSession:[true,{option:true}],
 bridge: async({persistSession},use,testInfo)=>{const b=await createBridge(persistSession);try{await use(b);}finally{await b.stop();await writeFile(testInfo.outputPath('bridge.log'),b.logs());}},
 errors: [async({page},use,testInfo)=>{const errors:string[]=[];page.on('pageerror',e=>errors.push('PAGEERROR '+e.message));page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE '+m.text());});await use(errors);await writeFile(testInfo.outputPath('console.json'),JSON.stringify(errors,null,2));}, {auto:true}],
 metrics: [async({},use,testInfo)=>{const rows:{name:string;ms:number}[]=[];await use(rows);await writeFile(testInfo.outputPath('action-metrics.json'),JSON.stringify(rows,null,2));},{auto:true}],
});
export {expect};
export async function act(metrics:{name:string;ms:number}[],name:string,fn:()=>Promise<unknown>) {const t=performance.now();await fn();metrics.push({name,ms:performance.now()-t});}
export async function pair(page:Page,b:Bridge) {
 await page.goto(web,{waitUntil:'domcontentloaded'});
 await page.getByPlaceholder('100.64.0.1',{exact:true}).waitFor({timeout:120000});
 await page.getByPlaceholder('100.64.0.1',{exact:true}).fill('127.0.0.1:'+b.port);
 await page.getByLabel('Bootstrap token',{exact:true}).fill(b.bootstrap);
 await page.getByRole('button',{name:'Pair over Tailscale',exact:true}).click({noWaitAfter:true});
 await expect(page.getByRole('tab').nth(1)).toBeVisible({timeout:25000});
 await page.getByRole('tab').nth(1).click({noWaitAfter:true});
 await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected','true');
 await expect(page.getByTestId('chats-pane')).toBeVisible();
}
const rows = new WeakMap<Page,string>();
export function chatRow(page:Page){const id=rows.get(page);if(!id)throw Error('No owned chat row recorded');return page.getByTestId(id);}
export async function openChat(page:Page,b:Bridge) {await pair(page,b);await page.getByRole('button',{name:/^(Create new chat|New chat)$/}).first().click({noWaitAfter:true});await expect(composer(page)).toBeVisible();await page.getByRole('button',{name:'Back',exact:true}).click({noWaitAfter:true});const row=page.getByTestId('chats-pane').locator('[data-testid^=chat-row-]').filter({has:page.getByText('New chat',{exact:true})});await expect(row).toHaveCount(1);const id=await row.getAttribute('data-testid');if(!id)throw Error('New chat row id missing');rows.set(page,id);await row.click({noWaitAfter:true});await expect(page.getByTestId('chat-window')).toBeVisible();}
export const composer=(page:Page)=>page.getByRole('textbox',{name:'Message',exact:true});
export async function chooseHarness(page:Page,name='OMP') {
 await page.getByRole('button',{name:'Options. Current surface: Chat',exact:true}).click({noWaitAfter:true});
 await page.getByRole('button',{name:/^Harness,/}).click({noWaitAfter:true});
 await page.getByRole('button',{name:new RegExp(name)}).last().click({noWaitAfter:true});
}
export async function send(page:Page,text:string) {await composer(page).fill(text);await page.getByRole('button',{name:'Send',exact:true}).click({noWaitAfter:true});}
