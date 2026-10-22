import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("actual summary chip renders safe degradation without claiming thought duration", async () => {
  const root = mkdtempSync(join(tmpdir(), "summary-render-"));
  try {
    // Child-only RN-web alias; render the real component and keyed-store hook.
    const preload = join(root, "web-preload.ts");
    await Bun.write(preload, `import {mock} from "bun:test";
      import * as web from ${JSON.stringify(resolve(import.meta.dir, "../../node_modules/react-native-web/dist/index.js"))};
      mock.module(${JSON.stringify(Bun.resolveSync("react-native", resolve(import.meta.dir, "../..")))},()=>web);`);
    const child = Bun.spawn([process.execPath, "--preload", preload, join(import.meta.dir, "summary-render-fixture.tsx")], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(child.stdout).text(); const errors = await new Response(child.stderr).text();
    expect(await child.exited, errors).toBe(0);
    const rendered: { success: string; degraded: string } = JSON.parse(output);
    expect(rendered.success).toContain("Thought 3 s · Checked demo branch; planned a fix.");
    expect(rendered.degraded).toContain("Summary unavailable · @smol sign-in required");
    expect(rendered.degraded).not.toContain("Thought 3 s");
    expect(rendered.degraded).toContain('aria-label="Turn summary"');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);
