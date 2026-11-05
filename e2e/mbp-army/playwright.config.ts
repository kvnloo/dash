// Headed runs are allowed only on a private headless compositor (ARMY_HEADED=1 with
// XDG_RUNTIME_DIR pointing at a private virtual runtime). Everything else, including CI,
// runs headless Chromium, which never touches a display. A physical compositor is refused.
const headed = process.env.ARMY_HEADED === '1';
const runtime = process.env.XDG_RUNTIME_DIR || '';
if (headed && (!runtime.endsWith('/virtual-runtime') || /^\/run\/user\//.test(runtime))) throw new Error('Private virtual runtime required for headed runs; physical compositor is forbidden');
import { defineConfig } from 'playwright/test';
export default defineConfig({
 testDir: '.', testMatch: '**/*.spec.ts', fullyParallel: true, workers: 8,
 timeout: 180000, expect: { timeout: 12000 }, retries: 0, forbidOnly: true,
 outputDir: process.env.ARMY_OUTPUT || '../../artifacts/mbp-army/test-results',
 reporter: [['./startup-reporter.ts'], ['list'], ['html', { outputFolder: process.env.ARMY_HTML || '../../artifacts/mbp-army/html', open: 'never' }], ['json', { outputFile: process.env.ARMY_JSON || '../../artifacts/mbp-army/results.json' }]],
 use: { headless: !headed, viewport: { width: 480, height: 780 },
  launchOptions: { args: headed ? ['--ozone-platform=wayland', '--disable-dev-shm-usage'] : ['--disable-dev-shm-usage'], slowMo: Number(process.env.ARMY_SLOWMO || 0) },
  screenshot: 'only-on-failure', trace: 'on', video: 'on', actionTimeout: 12000, navigationTimeout: 120000 },
});
