import { expect, test } from "bun:test";
import { AcpContextReadings } from "./context";
test("agent context sizes, not cumulative throughput, expire and are harness/session-owned", () => {
  let now = 0; const readings = new AcpContextReadings(() => now);
  readings.observe("omp", "s", { sessionUpdate: "usage_update", used: 140000, size: 500000, secret: "never-retained", cost: { amount: 5000 } });
  expect(readings.read("omp", "s")).toMatchObject({ used: 140000, maximum: 500000, model: "Unknown" });
  expect(JSON.stringify(readings.read("omp", "s"))).not.toContain("never-retained");
  expect(readings.read("hermes", "s")).toBeUndefined(); expect(readings.read("omp", "different")).toBeUndefined();
  for (const used of [-1, NaN, Infinity, "10"]) readings.observe("omp", "s", { sessionUpdate: "usage_update", used, size: 1 });
  expect(readings.read("omp", "s")?.used).toBe(140000);
  now = 60001; expect(readings.read("omp", "s")).toBeUndefined();
});
