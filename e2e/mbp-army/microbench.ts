if (!process.env.XDG_RUNTIME_DIR?.endsWith('/dash-e2e-army-20261025/virtual-runtime')) throw new Error('Private virtual runtime required; physical compositor is forbidden');
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
const result:{name:string;ms:number;iteration:number}[]=[];
async function timed<T>(name:string,iteration:number,fn:()=>Promise<T>):Promise<T>{const t=performance.now();const value=await fn();result.push({name,iteration,ms:performance.now()-t});return value;}
for(let launch=0;launch<5;launch++){
 const browser=await timed('browser_launch',launch,()=>chromium.launch({headless:false,args:['--ozone-platform=wayland','--disable-dev-shm-usage']}));
 for(let i=0;i<4;i++){
  const k=launch*4+i;
  const context=await timed('new_context',k,()=>browser.newContext());
  const page=await timed('new_page',k,()=>context.newPage());
  await page.setContent('<label>Entry<input aria-label="Entry"></label><button onclick="this.textContent=\'Clicked\'">Click me</button>');
  await timed('fill',k,()=>page.getByRole('textbox',{name:'Entry'}).fill('framework overhead'));
  await timed('click',k,()=>page.getByRole('button',{name:'Click me'}).click());
  if(await page.getByRole('button').innerText()!=='Clicked')throw Error('Click did not execute');
  await context.close();
 }
 await browser.close();
}
await writeFile(process.env.ARMY_BENCH || 'benchmark-micro.json',JSON.stringify({scope:'Headed Chromium, local inert HTML for action overhead, no tracing/video/slowMo; NOT Dash latency',playwrightVersion:require('playwright/package.json').version,browserRevision:chromium.executablePath(),rows:result},null,2));
