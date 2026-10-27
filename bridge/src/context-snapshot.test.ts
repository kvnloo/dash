import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = process.env.DASH_HERMES_SOURCE ?? "/workspace/hermes-home/hermes-agent";
test.skipIf(!existsSync(`${source}/agent/context_breakdown.py`))("native Hermes pinned context math and read-only SQLite projection", async () => {
  const child = Bun.spawn([process.env.DASH_HERMES_PYTHON ?? "python3", fileURLToPath(new URL("./context_snapshot_test.py", import.meta.url))], { env: { ...process.env, DASH_HERMES_SOURCE: source, PYTHONDONTWRITEBYTECODE: "1" }, stdout: "pipe", stderr: "pipe" });
  const errors = await new Response(child.stderr).text();
  expect(await child.exited, errors).toBe(0);
}, 30_000);
