// RC3 owner report (2026-10-27): tool and thinking cards were bulky. A turn with five tool calls drew
// "Turn details > Tool calls > vision_analyze x2" boxes inside a box with 56 px rows, a 90 px thinking
// preview, and a raw "Activity" list repeating "Thinking / Running terminal". Real Expo web UI at phone
// width -> isolated real bridge -> ACP fixture that streams thinking and tool calls (ARMY_TOOLS).
import {test,expect,openChat,send} from './fixtures';
import type {Locator} from 'playwright/test';

test.use({viewport:{width:390,height:780}});
test.afterEach(async({page},info)=>{if(!page.isClosed())await page.screenshot({path:info.outputPath('final.png')});});

const box=async(locator:Locator)=>{const b=await locator.boundingBox();if(!b)throw Error('element has no box');return b;};
// One text line is about 20 px; a quiet row is 32 px (hit slop supplies the rest of the 44 px target).
const ONE_ROW=40;

test('tool and thinking cards stay compact and un-nested at phone width',async({page,bridge},info)=>{
 await openChat(page,bridge);
 await send(page,'ARMY_TOOLS ARMY_SLOW render a tool-heavy turn');

 // No box inside a box: the tool header, Turn details and Tool calls tree levels are gone.
 await expect(page.getByText(/^5 tools/)).toBeVisible();
 await expect(page.getByText('Turn details',{exact:true})).toHaveCount(0);
 await expect(page.getByText('Tool calls',{exact:true})).toHaveCount(0);

 // Two unlike runs read at a glance: one header row and one dense row per run.
 const stack=page.getByTestId('reply-tools');
 const rows=stack.getByTestId('reply-tool-row');
 await expect(rows).toHaveCount(2);
 await expect(rows.nth(0)).toContainText('vision_analyze');
 await expect(rows.nth(0)).toContainText('×2');
 await expect(rows.nth(1)).toContainText('Run ×3'); // terminal calls read as "Run" in the compact row
 expect((await box(page.getByTestId('reply-tools-toggle'))).height).toBeLessThanOrEqual(ONE_ROW);
 for(const i of [0,1])expect((await box(rows.nth(i))).height).toBeLessThanOrEqual(ONE_ROW);
 expect((await box(stack)).height).toBeLessThanOrEqual(ONE_ROW*3);
 expect((await box(stack)).width).toBeLessThanOrEqual(390);

 // Thinking: one quiet row that keeps the documented "Reasoning · summary unavailable" text, no preview.
 const thinking=page.getByTestId('reply-thinking');
 await expect(thinking).toContainText('Reasoning · summary unavailable');
 expect((await box(thinking)).height).toBeLessThanOrEqual(ONE_ROW);
 await expect(thinking).not.toContainText('Reading the owner screenshots');

 // Activity: a quiet row that only counts; the status row above it already names the latest update.
 const activity=page.getByTestId('reply-activity');
 await expect(activity).toBeVisible();
 expect((await box(activity)).height).toBeLessThanOrEqual(ONE_ROW);
 // A live turn never says the same thing twice: the label ends at the count, with no "· Running terminal" suffix.
 await expect(activity).toContainText(/Activity · \d+ updates$/); // the chevron glyph precedes it
 await page.screenshot({path:info.outputPath('cards-390-live.png')});

 // Activity opened (it exists only while the turn runs; the reply lands 9 s after Send, so check it first):
 // no line repeats ("Thinking" x4 and "Running terminal" x3 are counted once).
 await page.getByTestId('reply-activity-toggle').click({noWaitAfter:true});
 await expect(page.getByTestId('reply-activity-lines')).toContainText('Running terminal ×3');
 const lines=(await page.getByTestId('reply-activity-lines').innerText()).split('\n').map(line=>line.trim()).filter(Boolean);
 expect(new Set(lines).size,'no activity line repeats: '+JSON.stringify(lines)).toBe(lines.length);
 expect(lines.length,JSON.stringify(lines)).toBeLessThanOrEqual(4);
 expect(lines.some(line=>/^Thinking ×\d+$/.test(line)),JSON.stringify(lines)).toBe(true);
 expect(lines.some(line=>/^Running terminal ×3$/.test(line)),JSON.stringify(lines)).toBe(true);
 await page.screenshot({path:info.outputPath('cards-390-activity.png')});
 await page.getByTestId('reply-activity-toggle').click({noWaitAfter:true});
 await expect(page.getByTestId('reply-activity-lines')).toHaveCount(0);

 // The stack folds to its header and opens again.
 await page.getByTestId('reply-tools-toggle').click({noWaitAfter:true});
 await expect(rows).toHaveCount(0);
 expect((await box(stack)).height).toBeLessThanOrEqual(ONE_ROW);
 await page.getByTestId('reply-tools-toggle').click({noWaitAfter:true});
 await expect(rows).toHaveCount(2);

 // A coalesced row lists its calls; one call opens the existing full-detail inspector.
 await rows.nth(1).click({noWaitAfter:true});
 const calls=stack.getByTestId('reply-tool-call');
 await expect(calls).toHaveCount(3);
 for(let i=0;i<3;i++)expect((await box(calls.nth(i))).height).toBeLessThanOrEqual(ONE_ROW);
 await calls.nth(2).click({noWaitAfter:true});
 await expect(page.getByText(/^terminal · /)).toBeVisible();
 await page.getByRole('button',{name:'Close tool details',exact:true}).click({noWaitAfter:true});
 await expect(page.getByRole('button',{name:'Close tool details',exact:true})).toHaveCount(0);

 // Thinking opens to its text and folds back.
 await page.getByTestId('reply-thinking-toggle').click({noWaitAfter:true});
 await expect(thinking).toContainText('Reading the owner screenshots');
 await page.screenshot({path:info.outputPath('cards-390-thinking.png')});
 await page.getByTestId('reply-thinking-toggle').click({noWaitAfter:true});
 await expect(thinking).not.toContainText('Reading the owner screenshots');

 // A finished turn keeps the same compact cards.
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible({timeout:18000});
 await expect(stack).toContainText('5 tools');
 await expect(rows).toHaveCount(2);
 for(const i of [0,1])expect((await box(rows.nth(i))).height).toBeLessThanOrEqual(ONE_ROW);
 expect((await box(thinking)).height).toBeLessThanOrEqual(ONE_ROW);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 await page.screenshot({path:info.outputPath('cards-390-final.png')});
});

test('a long tool stack folds to its header and opens to every row',async({page,bridge},info)=>{
 await openChat(page,bridge);
 await send(page,'ARMY_TOOLS_MANY render a longer tool turn');
 await expect(page.getByText(/ARMY_REPLY:/).first()).toBeVisible({timeout:18000});

 // Seven calls make four unlike runs: past the open-by-default length, so one folded header row.
 const stack=page.getByTestId('reply-tools');
 const rows=stack.getByTestId('reply-tool-row');
 await expect(stack).toContainText('7 tools');
 await expect(rows).toHaveCount(0);
 expect((await box(stack)).height).toBeLessThanOrEqual(ONE_ROW);
 await page.screenshot({path:info.outputPath('cards-390-many-folded.png')});

 await page.getByTestId('reply-tools-toggle').click({noWaitAfter:true});
 await expect(rows).toHaveCount(4);
 await expect(rows.nth(2)).toContainText('Read');
 for(let i=0;i<4;i++)expect((await box(rows.nth(i))).height).toBeLessThanOrEqual(ONE_ROW);
 await page.screenshot({path:info.outputPath('cards-390-many-open.png')});
});
