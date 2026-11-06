import { expect, test } from 'bun:test';

test('army keeps failure diagnostics without retaining passing recordings', async () => {
  const runtime = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = '/tmp/dash-e2e-army-20261025/virtual-runtime';
  try {
    const { default: config } = await import('./playwright.config');
    expect(config.use?.trace).toBe('retain-on-failure');
    expect(config.use?.video).toBe('retain-on-failure');
    expect(config.use?.screenshot).toBe('only-on-failure');
    expect(config.retries).toBe(0);
  } finally {
    if (runtime === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = runtime;
  }
});
