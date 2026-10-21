// Deterministic Expo-web renderer exercise. Deliberately synthetic stream, never a live-agent claim.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const origin = process.env.DASH_PROOF_ORIGIN ?? 'http://127.0.0.1:18763';
const output = process.env.DASH_PROOF_DIR;
if (!output) throw new Error('Set DASH_PROOF_DIR to the evidence directory');
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let seq = 0;
const run = cmd => page.evaluate(cmd => window.__DASH_DEBUG__.run(cmd), cmd);
const part = value => run({ action: 'replyFixture', part: value, seq: ++seq });
const text = value => run({ action: 'replyFixture', text: value, seq: ++seq });
const frames = [];
try {
  const response = await page.goto(`${origin}/?debug=1`);
  if (response?.status() !== 200) throw new Error('Expo export not served');
  await page.waitForFunction(() => window.__DASH_DEBUG__?.ready);
  for (const mode of ['Compact', 'Full']) {
    await run({ action: 'replyFixture', reset: true, seq: ++seq });
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: `Details ${mode}`, exact: true }).click();
    await part({ kind: 'reasoning', text: 'Trace the event stream without blocking the answer.\nCheck identities, bounded output, and stable layout.\nKeep reasoning visible while tools run.\n' });
    for (const [index, name] of ['read_file', 'terminal', 'web_extract'].entries()) {
      await part({ kind: 'tool_start', callId: `tool-${index}`, name, summary: ['shared/protocol.ts', 'bun test', 'https://example.org/protocol'][index], args: JSON.stringify({ query: ['shared/protocol.ts', 'bun test', 'https://example.org/protocol'][index] }) });
    }
    await text('The reply streams independently below the wrapped blocks. ');
    for (let tick = 0; tick < 6; tick++) {
      await part({ kind: 'reasoning', text: `Reasoning checkpoint ${tick + 1}: the text subscription stays independent.\n` });
      for (let index = 0; index < 3; index++) await part({ kind: 'tool_output', callId: `tool-${index}`, text: `chunk ${tick + 1}: verified stream output for tool ${index + 1}\n`, truncated: false });
      await text(['Tools retain their real call IDs. ', 'Compact mode tails the latest three wrapped lines. ', 'Full mode exposes each call. ', 'Arguments and output remain inspectable. ', 'No token updates enter the conversation store. ', 'The answer remains visible throughout.'][tick]);
      await page.waitForTimeout(180);
      const path = `${output}/${mode.toLowerCase()}-${tick}.png`;
      await page.screenshot({ path });
      const block = page.getByRole('button', { name: 'Thinking', exact: true });
      frames.push({ mode, tick, screenshot: path, reasoning: await block.boundingBox(), answerVisible: await page.getByText(/The reply streams independently/).first().isVisible() });
    }
    for (let index = 0; index < 3; index++) await part({ kind: 'tool_finish', callId: `tool-${index}`, status: index === 2 ? 'error' : 'ok', durationMs: [1200, 4400, 6400][index] });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${output}/${mode.toLowerCase()}-finished.png` });
    if (mode === 'Compact') {
      const heights = frames.filter(frame => frame.mode === mode).map(frame => frame.reasoning?.height);
      if (new Set(heights).size !== 1) throw new Error('Compact block changed height while streaming');
      await page.getByRole('button', { name: 'Thinking', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Thinking"]')?.getAttribute('aria-expanded') === 'true');
      const box = await page.getByRole('button', { name: 'Thinking', exact: true }).boundingBox();
      if (!box) throw new Error('Thinking not measured');
      const touch = await page.context().newCDPSession(page);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 20, y: box.y + 16 }] });
      for (let step = 1; step <= 10; step++) { await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 20 + step * 12, y: box.y + 16 }] }); await page.waitForTimeout(20); }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.detach();
      await page.waitForFunction(() => document.querySelector('[aria-label="Thinking"]')?.getAttribute('aria-expanded') === 'false');
      await page.getByRole('button', { name: 'Thinking', exact: true }).click({ delay: 700 });
      await page.waitForFunction(() => document.querySelector('[aria-label="Thinking"]')?.getAttribute('aria-expanded') === 'true');
    }
    await page.getByRole('button', { name: 'Details Hide', exact: true }).click();
    if (await page.getByRole('button', { name: 'Thinking', exact: true }).count()) throw new Error('Hide retained detail block');
  }
  if (errors.length) throw new Error(errors.join('\n'));
  writeFileSync(`${output}/browser-proof.json`, JSON.stringify({ origin, viewport: { width: 412, height: 915 }, fixture: true, errors, frames }, null, 2));
  console.log(JSON.stringify({ frames: frames.length, errors, output }));
} finally { await browser.close(); }
