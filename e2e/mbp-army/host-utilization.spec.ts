import { test, expect, pair } from "./fixtures";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { parseHostUtilization } from "../../shared/host-utilization";

test("host utilization persists, prunes history and shows partial coverage on the host row", async ({ page, bridge, request }, info) => {
  test.setTimeout(150000);
  const hostId = hostname(); // The army tailscale stub leaves the real bridge's self-host fallback.
  const fixture = (mode: string): unknown => JSON.parse(execFileSync(process.env.ARMY_BUN || "bun", [join(__dirname, "utilization-fixture.ts"), mode, bridge.dir, hostId], { encoding: "utf8" }) || "null");
  await bridge.stop();
  fixture("seed");
  await bridge.start();
  const token = (await readFile(join(bridge.dir, ".dash/token"), "utf8")).trim();
  const url = `http://127.0.0.1:${bridge.port}/hosts/utilization`;
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.get(url)).status()).toBe(401);
  expect((await request.post(url, { headers })).status()).toBe(405);
  const response = await request.get(url, { headers });
  expect(response.status()).toBe(200);
  const snapshot = parseHostUtilization(await response.json());
  expect(snapshot).not.toBeNull();
  const host = snapshot?.hosts.find(h => h.hostId === hostId);
  expect(host?.day.utilization).toBe(25); // GPU at exactly 70 counts; offline and skipped do not.
  expect(host?.day.coverage).toBeCloseTo(4 / 1440, 5);
  expect(host?.day.averageCpu).toBe(20);
  expect(host?.week.utilization).toBe(25);
  await pair(page, bridge);
  await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
  const row = page.getByTestId(`tree-row-host:${hostId}`);
  await expect(row).toContainText("24h utilization 25% · partial · <1% coverage");
  await expect.poll(() => fixture("inspect")).toMatchObject({ expiredRaw: 0, expiredHourly: 0, hourly: 1 });
  await bridge.stop();
  await bridge.start();
  await page.getByRole("tab").nth(1).click({ noWaitAfter: true });
  await page.getByRole("tab").nth(0).click({ noWaitAfter: true });
  await expect(row).toContainText("24h utilization 25% · partial");
  // Exercise the real periodic sampler, not a test-only write endpoint.
  await expect.poll(() => fixture("inspect"), { timeout: 85000, intervals: [1000, 5000] }).toMatchObject({ live: 1 });
  await page.screenshot({ path: info.outputPath("final.png") });
});
