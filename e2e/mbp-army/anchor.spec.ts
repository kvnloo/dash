// Owner regression (2026-10-27, RC3 on the S25): tapping Attach opened the sheet floating mid-screen
// instead of on the paperclip. Real Expo web UI at phone width -> isolated real bridge -> ACP fixture.
//
// The web build has no IME, so the journeys move the composer dock with the same CSS transform
// KeyboardDock applies (translateY of the keyboard height). On the phone the sheet was measured while
// the IME still held the dock up (RN reports keyboardDidHide as the hide animation STARTS), then the
// dock came down and left the sheet about one keyboard height above the paperclip.
// Invariants: the sheet is never shown anywhere but on the paperclip, and it stays there if the dock moves.
import {test,expect,send,openChat} from './fixtures';
import type {Page} from 'playwright/test';

test.use({viewport:{width:390,height:844}});
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

type Box={x:number;y:number;width:number;height:number};
const box=async(page:Page,target:ReturnType<Page['getByTestId']>):Promise<Box>=>{const b=await target.boundingBox();if(!b)throw Error('no box');return b;};

/** Move the nearest transformed ancestor of the paperclip (KeyboardDock) like the IME lifting it. */
async function liftDock(page:Page,px:number):Promise<string>{
 return page.getByRole('button',{name:'Attach file',exact:true}).evaluate((clip,lift)=>{
  let n:HTMLElement|null=clip.parentElement;
  while(n&&getComputedStyle(n).transform==='none')n=n.parentElement;
  if(!n)throw Error('no transformed dock ancestor');
  const was=n.style.transform;
  (window as unknown as {__dock?:{el:HTMLElement;was:string}}).__dock={el:n,was};
  n.style.transform=`translateY(${-lift}px)`;
  return was;
 },px);
}
async function dropDock(page:Page):Promise<void>{
 await page.evaluate(()=>{const d=(window as unknown as {__dock?:{el:HTMLElement;was:string}}).__dock;if(d)d.el.style.transform=d.was;});
}

test('Attach sheet follows the paperclip when the dock moves after it opens',async({page,bridge},info)=>{
 await openChat(page,bridge);
 await send(page,'attach anchor journey');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
 const clip=page.getByRole('button',{name:'Attach file',exact:true});
 const rest=await box(page,clip);
 // The IME holds the dock 300px up when Attach is tapped.
 await liftDock(page,300);
 await expect.poll(async()=>(await box(page,clip)).y,{timeout:3000}).toBeCloseTo(rest.y-300,0);
 await clip.click({noWaitAfter:true});
 const sheet=page.getByTestId('attachment-sheet');
 await expect(sheet).toBeVisible();
 // The IME finishes hiding: the dock, and the paperclip with it, return to rest.
 await dropDock(page);
 await expect.poll(async()=>(await box(page,clip)).y,{timeout:3000}).toBeCloseTo(rest.y,0);
 // The sheet sits on the paperclip: its bottom edge is within a hand's width above the button, and
 // the sheet is fully inside the screen.
 await expect.poll(async()=>{const s=await box(page,sheet),c=await box(page,clip);return Math.round(c.y-(s.y+s.height));},{timeout:3000,message:'sheet bottom edge sits just above the paperclip'}).toBeGreaterThanOrEqual(0);
 await expect.poll(async()=>{const s=await box(page,sheet),c=await box(page,clip);return Math.round(c.y-(s.y+s.height));},{timeout:3000,message:'sheet is not floating away from the paperclip'}).toBeLessThanOrEqual(24);
 const s=await box(page,sheet);
 expect(s.y).toBeGreaterThanOrEqual(0);expect(s.x).toBeGreaterThanOrEqual(0);expect(s.x+s.width).toBeLessThanOrEqual(390);
 await page.screenshot({path:info.outputPath('attach-anchored-390.png')});
 await page.getByRole('button',{name:'Cancel attachment',exact:true}).click({noWaitAfter:true});
 await expect(sheet).toHaveCount(0);
});

type Sample={t:number;clipTop:number;sheetBottom:number|null};
/** Record, on every frame from now, where the paperclip is and where the sheet is (null while it is absent or fully transparent). */
async function startSampling(page:Page,ms:number):Promise<void>{
 await page.evaluate(duration=>{
  const w=window as unknown as {__samples:Sample[];__t0:number};
  w.__samples=[];w.__t0=performance.now();
  const tick=()=>{
   const clip=document.querySelector('[aria-label="Attach file"]') as HTMLElement|null;
   const sheet=document.querySelector('[data-testid="attachment-sheet"]') as HTMLElement|null;
   let shown=Boolean(sheet);
   for(let n:HTMLElement|null=sheet;n&&shown;n=n.parentElement)if(Number(getComputedStyle(n).opacity)<0.01)shown=false;
   if(clip)w.__samples.push({t:Math.round(performance.now()-w.__t0),clipTop:clip.getBoundingClientRect().top,sheetBottom:shown&&sheet?sheet.getBoundingClientRect().bottom:null});
   if(performance.now()-w.__t0<duration)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
 },ms);
}
const samples=(page:Page):Promise<Sample[]>=>page.evaluate(()=>(window as unknown as {__samples:Sample[]}).__samples);

test('Attach sheet opens on the paperclip with the dock at rest',async({page,bridge},info)=>{
 await openChat(page,bridge);
 const clip=page.getByRole('button',{name:'Attach file',exact:true});
 await startSampling(page,1500);
 await clip.click({noWaitAfter:true});
 await expect(page.getByTestId('attachment-sheet')).toBeVisible();
 await page.waitForTimeout(1500);
 const all=await samples(page);
 const shown=all.filter(x=>x.sheetBottom!==null);
 expect(shown.length).toBeGreaterThan(0);
 for(const x of shown){expect(x.clipTop-x.sheetBottom!).toBeGreaterThanOrEqual(0);expect(x.clipTop-x.sheetBottom!).toBeLessThanOrEqual(24);}
 // Not asserted (wall time on a shared host): how long the tap takes to show the sheet.
 info.annotations.push({type:'first-visible-ms',description:String(shown[0].t)});
});

// The phone path: the tap hides the IME, RN reports keyboardDidHide as the hide animation starts, and
// the dock is on its way down from then on. The sheet may show late, but never in a wrong place.
test('Attach while the dock is still animating down never shows the sheet away from the paperclip',async({page,bridge},info)=>{
 await openChat(page,bridge);
 await send(page,'attach teleport journey');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
 const clip=page.getByRole('button',{name:'Attach file',exact:true});
 const rest=await box(page,clip);
 const KEYBOARD=330;
 await liftDock(page,KEYBOARD);
 await expect.poll(async()=>(await box(page,clip)).y,{timeout:3000}).toBeCloseTo(rest.y-KEYBOARD,0);
 // The dock starts down inside the tap's own click, before the app's handler runs, so it is already
 // moving at the app's first measure (no race with the test's round trips).
 await page.evaluate(()=>{
  const w=window as unknown as {__dock?:{el:HTMLElement;was:string}};
  const dock=w.__dock!,button=document.querySelector('[aria-label="Attach file"]') as HTMLElement;
  button.addEventListener('click',()=>{dock.el.style.transition='transform 350ms linear';dock.el.style.transform=dock.was;},{capture:true,once:true});
 });
 await startSampling(page,3000);
 await clip.click({noWaitAfter:true});
 const sheet=page.getByTestId('attachment-sheet');
 await expect(sheet).toBeVisible();
 await page.waitForTimeout(3100);
 const rested=await box(page,clip);
 expect(rested.y).toBeCloseTo(rest.y,0);
 const shown=(await samples(page)).filter(x=>x.sheetBottom!==null);
 expect(shown.length,'the sheet is shown').toBeGreaterThan(0);
 // Every frame the sheet was visible: just above where the paperclip ends up. The teleport showed it
 // here about one keyboard height too high, from its first frame.
 const wrong=shown.filter(x=>{const gap=rested.y-x.sheetBottom!;return gap<0||gap>24;});
 expect(wrong,`sheet frames away from the paperclip (rest top ${rested.y})`).toEqual([]);
 info.annotations.push({type:'first-visible-ms',description:String(shown[0].t)});
 await page.screenshot({path:info.outputPath('attach-after-ime-390.png')});
});
