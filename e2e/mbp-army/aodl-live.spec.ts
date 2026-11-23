import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, pair } from './fixtures';

test.afterEach(async ({ page }, info) => { if (!page.isClosed()) await page.screenshot({ path: info.outputPath('final.png'), fullPage: true }); });

const bun = () => execFileSync('sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();

// The native Hermes fixture session becomes a live session working in a checkout named `dash`,
// written to the isolated state.db exactly as Hermes records cwd and its activity projection.
// The checkout is its own Git repository, as a real one is: the bridge resolves the session's
// repository with `git rev-parse --show-toplevel`, and the army's temp dir may sit inside another repo.
function liveHermesIn(dir: string, repo: string) {
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync(bun(), [join(__dirname, 'seed-trace-live.ts'), join(dir, '.hermes/state.db')]);
  execFileSync('python3', ['-c', 'import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1])\ndb.execute("UPDATE sessions SET cwd=? WHERE id=?",(sys.argv[2],"army-fixture-session"))\ndb.commit()', join(dir, '.hermes/state.db'), repo]);
}

// The fixture OMP session works in its own repository, nested under a plain folder named `dash`
// (as a CI checkout at .../work/dash/dash nests everything). A folder is not a repository:
// only the Hermes session whose repository is `dash` is a dash session, on every checkout path.
test.use({ bridgeOptions: { env: { ARMY_HOLDER_REPO: join('dash', 'army-omp-scratch') } } });

test('Orchestra AODL network shows live nodes from the bridge, with no unavailable source warnings', async ({ page, bridge }, info) => {
  liveHermesIn(bridge.dir, join(bridge.dir, 'work', 'dash'));
  await page.setViewportSize({ width: 390, height: 844 });
  await pair(page, bridge);
  const graph = page.waitForResponse(response => new URL(response.url()).pathname === '/orchestra/graph' && response.ok());
  await page.getByRole('tab').nth(2).click();
  await graph;
  const network = page.getByTestId('aodl-catalog-network');
  await expect(network).toBeVisible();
  await expect(network.getByText('Live from the paired bridge · roster and session graph', { exact: true })).toBeVisible();
  await expect(page.getByTestId('aodl-node-dash')).toHaveAttribute('aria-label', /^dash\. Live · 1 live session · hermes\. Owns: /, { timeout: 30000 });
  await expect(page.getByTestId('aodl-node-blueprint')).toHaveAttribute('aria-label', /^blueprint\. Idle · no running session\. /);
  await expect(page.getByTestId('aodl-node-frontier-kb')).toHaveAttribute('aria-label', /^frontier-kb\. Idle · no running session\. /);
  await expect(network.getByRole('button', { name: 'AODL network catalog' })).toContainText(/AODL network · [1-7] live/);
  // The fixture's configured fleet registry and empty supervision directory are real, healthy sources.
  await page.getByRole('button', { name: 'Fleet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Legend host', exact: true })).toBeVisible();
  await expect(page.getByText(/(registry|queue|evidence|metadata|roadmap) (unavailable|unreadable)/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('aodl-live.png') });
});

test.describe('Orchestra with a broken fleet registry', () => {
  test.use({ bridgeOptions: { env: { DASH_FLEET_REGISTRY: join(process.env.ARMY_TMP || '/tmp', 'army-broken-fleet.yaml') } } });
  test('Orchestra reports an unreadable fleet registry instead of hiding it', async ({ page, bridge }) => {
    writeFileSync(join(process.env.ARMY_TMP || '/tmp', 'army-broken-fleet.yaml'), 'nodes: [unterminated\n');
    await page.setViewportSize({ width: 390, height: 844 });
    await pair(page, bridge);
    await page.getByRole('tab').nth(2).click();
    await page.getByRole('button', { name: 'Fleet', exact: true }).click();
    await expect(page.getByText(/Fleet registry unreadable/)).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/Needs Kevin queue unavailable/)).toHaveCount(0);
  });
});
