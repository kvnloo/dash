if (!process.env.XDG_RUNTIME_DIR?.endsWith('/dash-e2e-army-20261025/virtual-runtime')) throw new Error('Private virtual runtime required; physical compositor is forbidden');
import { defineConfig } from 'playwright/test';
export default defineConfig({
 testDir: '.', testMatch: '**/*.spec.ts', fullyParallel: true, workers: 8,
 timeout: 180000, expect: { timeout: 12000 }, retries: 0,
 outputDir: process.env.ARMY_OUTPUT || '../../artifacts/mbp-army/test-results',
 reporter: [['./startup-reporter.ts'], ['list'], ['html', { outputFolder: process.env.ARMY_HTML || '../../artifacts/mbp-army/html', open: 'never' }], ['json', { outputFile: process.env.ARMY_JSON || '../../artifacts/mbp-army/results.json' }]],
 use: { headless: false, viewport: { width: 480, height: 780 },
  launchOptions: { args: ['--ozone-platform=wayland', '--disable-dev-shm-usage'], slowMo: Number(process.env.ARMY_SLOWMO || 30) },
  screenshot: 'only-on-failure', trace: 'on', video: 'on', actionTimeout: 12000, navigationTimeout: 120000 },
});
