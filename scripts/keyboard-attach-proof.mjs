#!/usr/bin/env node
// Render the real Expo app. IME samples apply KeyboardDock's native style outputs;
// they are layout regressions, not evidence of a real Android keyboard or picker UI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const out = path.join(root, '.keyboard-receipts');
const port = 8196;
const files = ['app/src/screens/ChatScreen.tsx', 'app/src/components/Composer.tsx'];
const proofFiles = [...files, 'app/src/components/AttachmentChooser.tsx', 'app/src/lib/dismiss-keyboard.ts',
  'app/src/components/KeyboardDock.tsx', 'app/src/components/PromptRail.tsx',
  'app/src/lib/attachment-picker.ts', 'app/src/lib/attachment-upload.ts', 'app/src/lib/attachments.ts',
  'scripts/fleet-keyboard-attach.sh', 'scripts/keyboard-attach-proof.mjs'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = data => createHash('sha256').update(data).digest('hex');
const receipt = { host: process.env.HOSTNAME, revision: process.env.DASH_PROOF_REVISION ?? 'uncommitted', ime: 'Simulated native shared-value style outputs on real Expo web DOM; no device control', phases: [], errors: [] };

async function ready(url) {
  for (let i = 0; i < 180; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await sleep(1000);
  }
  throw new Error('Expo did not become ready');
}

async function phase(name) {
  const expo = spawn('bun', ['x', 'expo', 'start', '--web', '--port', String(port)], {
    cwd: path.join(root, 'app'), detached: true,
    env: { ...process.env, CI: '1', EXPO_PUBLIC_DEBUG: '1', EXPO_PUBLIC_DEBUG_AUTONAV: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let expoLog = '';
  expo.stdout.on('data', data => { expoLog += data; });
  expo.stderr.on('data', data => { expoLog += data; });
  let browser;
  const result = { name, sources: {}, cases: [] };
  for (const file of proofFiles) result.sources[file] = sha(await readFile(file));
  receipt.phases.push(result);
  try {
    await ready(`http://127.0.0.1:${port}`);
    browser = await chromium.launch({ headless: true });
    for (const width of [390, 412]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 915 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('pageerror', e => receipt.errors.push(`${name}/${width}: ${e.message}`));
      await page.goto(`http://127.0.0.1:${port}/?debug=1`, { waitUntil: 'networkidle', timeout: 180000 });
      await page.waitForFunction(() => window.__DASH_DEBUG__?.ready, undefined, { timeout: 120000 });
      await page.evaluate(() => window.__DASH_DEBUG__.scenario('ux-long'));
      await page.getByLabel('Prompt navigator', { exact: true }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await sleep(600);
      const input = page.getByRole('textbox', { name: 'Message', exact: true });
      await input.fill('Keep my draft\nand selection');
      await input.evaluate(el => el.setSelectionRange(5, 13));
      // Find the actual keyboard inset + dock without modifying application debug APIs.
      await page.evaluate(() => {
        const navigator = document.querySelector('[aria-label="Prompt navigator"]');
        let inset = navigator.parentElement;
        while (inset && !inset.nextElementSibling?.querySelector('[aria-label="Message"]')) inset = inset.parentElement;
        if (!inset) throw new Error('Missing keyboard inset/dock pair');
        window.__keyboardProof = { inset, dock: inset.nextElementSibling };
      });
      const samples = [];
      // Rising/falling native IME progress, safe-area removal and variable dock height.
      for (const extraDock of [0, 72]) {
        for (const height of [0, 80, 160, 240, 320, 240, 160, 80, 0]) {
          const geometry = await page.evaluate(async ({ height, extraDock }) => {
            const { inset, dock } = window.__keyboardProof;
            inset.style.paddingBottom = `${height}px`;
            dock.style.transform = `translateY(${-height}px)`;
            dock.style.paddingBottom = `${8 * (1 - height / 320)}px`;
            dock.style.paddingTop = `${extraDock}px`;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const nav = document.querySelector('[aria-label="Prompt navigator"]');
            let rail = nav;
            while (rail && getComputedStyle(rail).position !== 'absolute') rail = rail.parentElement;
            if (!rail) throw new Error('Missing absolute rail');
            const list = document.querySelector('[data-testid="transcript-viewport"]') ?? inset.firstElementChild;
            const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right }; };
            return { height, extraDock, viewport:rect(list), rail:rect(rail), dock:rect(dock), latest:rect(rail.lastElementChild) };
          }, { height, extraDock });
          samples.push(geometry);
          if (name === 'after') {
            assert(geometry.viewport.height > 0, 'positive transcript viewport');
            assert(geometry.rail.y >= geometry.viewport.y - 1, 'rail starts in viewport');
            assert(geometry.rail.bottom <= geometry.viewport.bottom + 1, 'rail ends in viewport');
            assert(geometry.latest.bottom <= geometry.dock.y + 1, 'Latest stays above translated dock');
            assert(Math.abs(geometry.viewport.bottom - geometry.dock.y) <= 1, 'viewport meets composer dock throughout motion');
          }
          if (extraDock === 0 && [0, 160, 320].includes(height)) {
            await page.screenshot({ path: path.join(out, `${name}-${width}-ime-${height}.png`) });
          }
        }
      }
      if (name === 'before') assert(samples.some(s => s.rail.bottom > s.viewport.bottom + 1), 'baseline reproduces rail overlap');
      // Return the injected styles to the closed state before attachment interactions.
      await page.evaluate(() => {
        const { inset, dock } = window.__keyboardProof;
        inset.style.paddingBottom = '0px'; dock.style.transform = ''; dock.style.paddingBottom = ''; dock.style.paddingTop = '';
      });
      await sleep(100);
      const chooser = { widths: [], pickers: [] };
      if (name === 'before') {
        const fileChooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Attach file', exact: true }).click();
        await (await fileChooser).setFiles([]);
        assert.equal(await page.getByRole('button', { name: 'Photos', exact: true }).count(), 0);
        chooser.baseline = 'Web bypasses app-owned chooser directly to OS file picker; Android Alert is source-checked separately';
        await page.screenshot({ path: path.join(out, `${name}-${width}-attach.png`) });
      } else {
        await page.getByRole('button', { name: 'Attach file', exact: true }).click();
        await page.getByRole('button', { name: 'Photos', exact: true }).waitFor();
        const attach = await page.getByRole('button', { name: 'Attach file', exact: true }).boundingBox();
        const sheet = await page.getByTestId('attachment-sheet').boundingBox();
        assert(sheet.x >= 0 && sheet.x + sheet.width <= width, 'chooser horizontally contained');
        assert(sheet.y >= 0 && sheet.y + sheet.height <= attach.y, 'chooser is anchored above paperclip');
        assert(Math.abs(sheet.y + sheet.height - (attach.y - 8)) < 2, '8px anchor gap');
        for (const label of ['Photos', 'Files', 'Cancel attachment']) {
          const rect = await page.getByRole('button', { name: label, exact: true }).boundingBox();
          assert(rect.width >= 44 && rect.height >= 44, `${label} >=44px`);
          chooser.widths.push({ label, rect });
        }
        await page.screenshot({ path: path.join(out, `${name}-${width}-attach.png`) });
        await page.getByRole('button', { name: 'Cancel attachment', exact: true }).click();
        assert.equal(await input.inputValue(), 'Keep my draft\nand selection');
        assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [5, 13]);
        for (const label of ['Photos', 'Files']) {
          await page.getByRole('button', { name: 'Attach file', exact: true }).click();
          const fileChooser = page.waitForEvent('filechooser');
          await page.getByRole('button', { name: label, exact: true }).click();
          const picker = await fileChooser;
          chooser.pickers.push({ label, accept: await picker.element().getAttribute('accept'), multiple: picker.isMultiple() });
          await picker.setFiles([]);
          await sleep(100);
          assert.equal(await page.getByTestId('attachment-sheet').count(), 0, 'closed before OS picker');
          assert.equal(await input.inputValue(), 'Keep my draft\nand selection');
        }
        await page.getByRole('button', { name: 'Attach file', exact: true }).click();
        await page.getByRole('button', { name: 'Close attachment chooser', exact: true }).click({ position: { x: 8, y: 8 } });
        assert.equal(await page.getByTestId('attachment-sheet').count(), 0, 'backdrop dismisses');
        await page.getByRole('button', { name: 'Attach file', exact: true }).click();
        await page.getByRole('button', { name: 'Photos', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await page.getByTestId('attachment-sheet').waitFor({ state: 'detached' });
        // Native accessibility and motion have no new custom animation. Exercise the web reduced-motion path too.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.getByRole('button', { name: 'Attach file', exact: true }).click();
        await page.getByRole('button', { name: 'Photos', exact: true }).waitFor();
        await page.screenshot({ path: path.join(out, `${name}-${width}-attach-reduced-motion.png`) });
        await page.getByRole('button', { name: 'Cancel attachment', exact: true }).click();
        // Handedness is changed by the app's own settings control, not a renderer stub.
        await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Settings' }));
        await page.getByRole('radio', { name: 'Left handedness', exact: true }).click();
        await page.evaluate(() => window.__DASH_DEBUG__.run({ action: 'navigate', screen: 'Chat' }));
        await page.getByRole('button', { name: 'Attach file', exact: true }).click();
        await page.getByRole('button', { name: 'Photos', exact: true }).waitFor();
        const leftAnchor = await page.getByRole('button', { name: 'Attach file', exact: true }).boundingBox();
        const leftSheet = await page.getByTestId('attachment-sheet').boundingBox();
        assert(leftSheet.x >= 0 && leftSheet.x + leftSheet.width <= width, 'left-hand chooser contained');
        chooser.left = { anchor:leftAnchor, sheet:leftSheet };
        await page.screenshot({ path: path.join(out, `${name}-${width}-attach-left.png`) });
        await page.getByRole('button', { name: 'Cancel attachment', exact: true }).click();
      }
      result.cases.push({ width, samples, chooser });
      await context.close();
    }
  } finally {
    await browser?.close();
    try { process.kill(-expo.pid, 'SIGTERM'); } catch {}
    await new Promise(resolve => expo.exitCode !== null ? resolve() : expo.once('exit', resolve));
    await writeFile(path.join(out, `${name}-expo.log`), expoLog);
  }
}

await mkdir(out, { recursive: true });
const original = await Promise.all(files.map(file => readFile(file)));
try {
  for (let i = 0; i < files.length; i++) await writeFile(files[i], await readFile(path.join(root, '.keyboard-inputs', path.basename(files[i]))));
  await phase('before');
  for (let i = 0; i < files.length; i++) await writeFile(files[i], original[i]);
  await phase('after');
  assert.equal(receipt.errors.length, 0, receipt.errors.join('\n'));
  receipt.status = 'PASS';
} catch (error) {
  receipt.status = 'FAIL'; receipt.failure = String(error.stack ?? error); throw error;
} finally {
  for (let i = 0; i < files.length; i++) await writeFile(files[i], original[i]);
  await writeFile(path.join(out, 'rendered-proof.json'), JSON.stringify(receipt, null, 2));
}
console.log(JSON.stringify({ status: receipt.status, phases: receipt.phases.map(p => ({ name:p.name, widths:p.cases.map(c => c.width) })) }));
