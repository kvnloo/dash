// Actual Expo AnnotationRoot + Gesture Handler + Skia. No draw/store payload injection.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
const out=path.resolve('.repair-receipts'), port=8197;
await mkdir(out,{recursive:true});
const result={revision:process.env.DASH_PROOF_REVISION,scope:'Actual Expo Web raw pointer → gesture → store → Skia pixels, NOT Android/S Pen qualification',cases:[],errors:[]};
const expo=spawn('bun',['x','expo','start','--web','--port',String(port)],{cwd:path.resolve('app'),env:{...process.env,CI:'1',EXPO_PUBLIC_DEBUG:'0',EXPO_PUBLIC_DEMO:'0'},detached:true,stdio:['ignore','pipe','pipe']});
let log='',browser,page;
expo.stdout.on('data',d=>log+=d);expo.stderr.on('data',d=>log+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){for(let i=0;i<240;i++){try{if(await fn())return;}catch{}await sleep(500);}throw new Error(`Timeout: ${label}`);}
async function pixels(png){
  return page.evaluate(async data=>{
    const image=new Image();image.src=data;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const {data:d}=ctx.getImageData(30,200,250,300);let red=0;
    for(let i=0;i<d.length;i+=4)if(d[i]>150&&d[i+1]<125&&d[i+2]<125)red++;
    return red;
  },`data:image/png;base64,${png.toString('base64')}`);
}
try{
  await wait(async()=>(await fetch(`http://127.0.0.1:${port}`)).ok,'Expo');
  browser=await chromium.launch({headless:true});
  for(const width of [390,412]){
    const context=await browser.newContext({viewport:{width,height:915},deviceScaleFactor:1});
    page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`,{waitUntil:'domcontentloaded',timeout:180000});
    await wait(()=>page.evaluate(()=>Boolean(window.__dashAnnotate)),'annotation mount');
    await page.evaluate(()=>window.__dashAnnotate.enterAnnotation());
    await page.getByLabel('Annotation mode on',{exact:true}).waitFor();
    await page.getByRole('radio',{name:'Red ink',exact:true}).click();
    await wait(()=>page.locator('canvas').count(),'Skia canvas');await sleep(1500);
    const before=await page.screenshot({path:path.join(out,`${width}-before.png`)});
    const redBefore=await pixels(before);
    await page.mouse.move(60,280);await page.mouse.down();
    await page.mouse.move(210,380,{steps:30});
    await sleep(300);
    const live=await page.screenshot({path:path.join(out,`${width}-live.png`)});
    const redLive=await pixels(live);
    await page.mouse.up();await sleep(300);
    const committed=await page.screenshot({path:path.join(out,`${width}-committed.png`)});
    const redCommitted=await pixels(committed);
    const strokes=await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes);
    const canvases=await page.locator('canvas').evaluateAll(nodes=>nodes.map(n=>({width:n.width,height:n.height,bounds:n.getBoundingClientRect().toJSON()})));
    result.cases.push({width,redBefore,redLive,redCommitted,strokes,canvases});
    assert.equal(strokes.length,1,'raw mouse gesture commits one stroke');
    assert(redLive>redBefore+150,'live Skia stroke must produce visible pixels before pointer up');
    assert(redCommitted>redBefore+150,'committed Skia stroke remains visible');
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__dashAnnotate.annotate.get().drawing.strokes.length),0);
    await context.close();
  }
  assert.deepEqual(result.errors,[]);result.status='PASS';
}catch(error){result.status='FAIL';result.error=String(error.stack??error);if(page){result.body=await page.locator('body').innerText().catch(()=>'');await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}throw error;}
finally{await browser?.close();try{process.kill(-expo.pid,'SIGTERM');}catch{}await writeFile(path.join(out,'expo.log'),log);await writeFile(path.join(out,'rendered-result.json'),JSON.stringify(result,null,2));}
