// Owner report (2026-10-27, RC3 on the S25): "this screen for showing host info also looks really bad".
// The sheet that opens from the identity badge was a deeply nested, indented Tree with big gaps, its session
// id was clipped, and its three provenance lines floated loose between the sheet and the composer.
// Real Expo web UI at phone width -> isolated real bridge -> ACP fixture.
// Invariants: every provenance line is inside the sheet's bounds, rows are indented at most one level,
// the session id is shown whole (or middle-truncated, never cut off) and copies the full id.
import {test,expect,send,openChat} from './fixtures';
import type {Page} from 'playwright/test';

test.use({viewport:{width:390,height:844}});
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

type Box={x:number;y:number;width:number;height:number};
const box=async(page:Page,target:ReturnType<Page['getByTestId']>):Promise<Box>=>{const b=await target.boundingBox();if(!b)throw Error('no box');return b;};
const inside=(inner:Box,outer:Box)=>inner.x>=outer.x-0.5&&inner.y>=outer.y-0.5&&inner.x+inner.width<=outer.x+outer.width+0.5&&inner.y+inner.height<=outer.y+outer.height+0.5;

test('host info sheet is compact: provenance inside the sheet, one indent level, session id whole and copyable',async({page,bridge},info)=>{
 await page.context().grantPermissions(['clipboard-read','clipboard-write']);
 await openChat(page,bridge);
 await send(page,'host sheet journey');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible();
 await page.getByTestId('chat-window-badge').click({noWaitAfter:true});
 const sheet=page.getByTestId('chat-window-identity');
 await expect(sheet).toBeVisible();
 const s=await box(page,sheet);
 await page.screenshot({path:info.outputPath('host-sheet-390.png')});

 // The three provenance lines are inside the sheet, below its rows, and are not clipped.
 const footer=page.getByTestId('chat-window-provenance');
 expect(inside(await box(page,footer),s),'provenance footer is inside the sheet').toBe(true);
 for(const line of [/^Lineage/,/^Model (reported|unknown)/,/^Model change unavailable/]){
  const t=footer.getByText(line);
  await expect(t).toHaveCount(1);
  expect(inside(await box(page,t),s),`${line} is inside the sheet`).toBe(true);
  expect(await t.evaluate(e=>e.scrollHeight<=e.clientHeight+1&&e.scrollWidth<=e.clientWidth+1),`${line} is not clipped`).toBe(true);
 }
 const rowsBottom=Math.max(...await page.getByTestId('chat-window-sheet-row').evaluateAll(rs=>rs.map(r=>r.getBoundingClientRect().bottom)));
 expect((await box(page,footer)).y,'footer sits below the rows').toBeGreaterThanOrEqual(rowsBottom-0.5);
 // Nothing floats between the sheet and the badge row/composer.
 const row=await box(page,page.getByTestId('chat-window-badge-row'));
 expect(Math.abs(row.y-(s.y+s.height)),'sheet is attached to the badge row').toBeLessThanOrEqual(1);

 // Compact: the old sheet was ~480px of mostly empty space.
 expect(s.height,'sheet height').toBeLessThanOrEqual(260);

 // Rows are flat: one breadcrumb line, and at most one indent level (16px) between any two rows.
 const crumbs=page.getByTestId('chat-window-breadcrumb');
 await expect(crumbs).toBeVisible();
 expect((await box(page,crumbs)).height,'breadcrumb is a single line').toBeLessThanOrEqual(20);
 const lefts=await page.getByTestId('chat-window-sheet-row').evaluateAll(rs=>rs.map(r=>(r.firstElementChild as HTMLElement).getBoundingClientRect().left));
 expect(lefts.length).toBeGreaterThanOrEqual(3);
 expect(Math.max(...lefts)-Math.min(...lefts),`row indents ${lefts}`).toBeLessThanOrEqual(16.5);

 // Session id: whole on its line (not cut off by the sheet or by overflow), clear of the copy button.
 const id=page.getByTestId('chat-window-session-id');
 await expect(id).toBeVisible();
 expect(inside(await box(page,id),s),'session id is inside the sheet').toBe(true);
 expect(await id.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'session id is not clipped').toBe(true);
 const copy=page.getByTestId('chat-window-session-id-copy');
 const c=await box(page,copy);
 expect(inside(c,s),'copy button is inside the sheet').toBe(true);
 expect(c.width,'copy hit target').toBeGreaterThanOrEqual(44);
 const i=await box(page,id);
 expect(i.x+i.width,'id does not run under the copy button').toBeLessThanOrEqual(c.x+0.5);

 // The shown id is the full id or its middle-truncation, and the button copies the full id.
 const shown=(await id.textContent())??'';
 await copy.click({noWaitAfter:true});
 await expect(page.getByRole('button',{name:'session id copied'})).toBeVisible();
 const copied=await page.evaluate(()=>navigator.clipboard.readText());
 expect(copied.length).toBeGreaterThan(0);
 if(shown.includes('…')){const [head,tail]=shown.split('…');expect(copied.startsWith(head)&&copied.endsWith(tail),`copied ${copied} vs shown ${shown}`).toBe(true);}
 else expect(copied).toBe(shown);
 info.annotations.push({type:'session-id',description:`${shown} -> ${copied.length} chars copied`});
 await page.screenshot({path:info.outputPath('host-sheet-copied-390.png')});

 // The sheet still closes from the badge.
 await page.getByTestId('chat-window-badge').click({noWaitAfter:true});
 await expect(sheet).toHaveCount(0);
});
