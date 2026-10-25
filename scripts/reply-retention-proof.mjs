import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = '.memory-receipts';
await mkdir(out, {recursive:true});
const label = process.env.MEMORY_LABEL || 'after';
const source = await readFile('.memory-build/retention.js');
const server = createServer((req,res) => {
  res.setHeader('content-type', req.url === '/retention.js' ? 'application/javascript' : 'text/html');
  res.end(req.url === '/retention.js' ? source : '<!doctype html><script type="module" src="/retention.js"></script>');
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  try { await page.waitForFunction(() => globalThis.__retentionProbe); } catch (error) { console.error({errors}); throw error; }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  async function sample() { await cdp.send('HeapProfiler.collectGarbage'); return cdp.send('Runtime.getHeapUsage'); }
  const before = await sample(), samples = [];
  for (let batch = 0; batch < 3; batch++) {
    const state = await page.evaluate(() => globalThis.__retentionProbe.run(128));
    await page.waitForTimeout(500);
    samples.push({...state, heap:await sample()});
  }
  const chunks = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', value => chunks.push(value.chunk));
  await cdp.send('HeapProfiler.takeHeapSnapshot', {reportProgress:false});
  await writeFile(`${out}/${label}.heapsnapshot`, chunks.join(''));
  const result = {label, engine:'Chromium', synthetic:true, storage:'no-op adapter; real app/text stores', before, samples, errors};
  await writeFile(`${out}/${label}-retention.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  assert.deepEqual(errors,[]);
  assert.equal(samples.at(-1).conversations,0);
  if (label === 'after') {
    assert.equal(samples.at(-1).retainedCharacters,0);
    assert(samples.at(-1).heap.usedSize - before.usedSize < 8*1024*1024, 'released replies must not retain megabytes per batch');
  } else assert(samples.at(-1).retainedCharacters > 100*1024*1024, 'baseline must reproduce unbounded retention');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
