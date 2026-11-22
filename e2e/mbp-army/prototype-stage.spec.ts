import { createServer } from 'node:http';
import { test, expect, openChat, send } from './fixtures';

test.use({ bridgeOptions: { generatedUI: true } });
test.afterEach(async ({ page }, info) => {
 if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png') });
});

test.use({ launchOptions: { args: [
 ...(process.env.ARMY_HEADED === "1" ? ["--ozone-platform=wayland"] : []),
 '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
] } });
test('opens a hosted prototype link and uses its control in Dash', async ({ page, bridge }) => {
 const requested: string[] = [];
 const server = createServer((req, res) => {
  requested.push(req.url ?? '');
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`
    <button onclick="this.nextElementSibling.textContent=location.hash">Try hosted control</button><p>Ready</p>
    <button onclick="navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const tracks = stream.getAudioTracks();
      document.querySelector('output').textContent = tracks.some(track => track.readyState === 'live')
        ? 'Microphone stream opened' : 'No live audio track';
      stream.getTracks().forEach(track => track.stop());
    }).catch(error => { document.querySelector('output').textContent = error.name; })">Try microphone</button>
    <output>Microphone idle</output>
  `);
 });
 await new Promise<void>(resolve => server.listen(0, 'localhost', resolve));
 try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Prototype server has no port');
  await openChat(page, bridge);
  await send(page, `ARMY_PROTOTYPE_LINK=${address.port}`);
  await page.getByRole('button', { name: 'Open review in stage', exact: true }).click();
  const stage = page.frameLocator('iframe[title="artifact-stage"]');
  await stage.getByRole('button', { name: 'Try hosted control' }).click();
  await expect(stage.getByText('#t=0123456789abcdef', { exact: true })).toBeVisible();
  await stage.getByRole('button', { name: 'Try microphone' }).click();
  await expect(stage.getByText('Microphone stream opened', { exact: true })).toBeVisible();
  expect(requested).toContain('/previews/counter?channel=dash');
 } finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
 }
});

test('runs generated HTML controls only in the explicit prototype stage', async ({ page, bridge }) => {
 await openChat(page, bridge);
 await send(page, 'ARMY_HTML_PROTOTYPE');
 const preview = page.frameLocator('iframe[title="HTML preview"]');
 await preview.getByRole('button', { name: 'Try control' }).click();
 await expect(preview.getByText('Ready', { exact: true })).toBeVisible();
 await page.getByRole('button', { name: 'Open interactive prototype', exact: true }).click();
 const stage = page.frameLocator('iframe[title="Interactive prototype"]');
 await expect(stage.getByText('Ready', { exact: true })).toBeVisible();
 await stage.getByRole('button', { name: 'Try control' }).click();
 await expect(stage.getByText('Updated', { exact: true })).toBeVisible();
});
