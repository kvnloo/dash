import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'apk.device.ts',
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 240_000,
  reporter: [['list'], ['json', { outputFile: process.env.DEVICE_ARMY_JSON }]],
});
