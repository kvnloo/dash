import { expect, test } from "bun:test";
import { join } from "node:path";
test("inline intent routes to original omp/Hermes session or existing live worker and rejects stale/offline/double taps", async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "inline-intent-fixture.ts")], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(child.stdout).text();
  const errors = await new Response(child.stderr).text();
  expect(await child.exited, errors).toBe(0);
  expect(output).toContain("intent routing assertions passed");
});
