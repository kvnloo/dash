import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("RN-web renderer (animation stub only): catalog, escaped labels, accessible controls and inert fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "genui-render-"));
  try {
    // Child-only alias: never contaminate other Bun tests' module registry. Render the actual
    // components with RN-web and ReactDOM; only UI-thread animation is a static substitute.
    const preload = join(root, "web-preload.ts");
    await Bun.write(preload, `import {mock} from "bun:test";
      import * as web from ${JSON.stringify(resolve(import.meta.dir, "../../../node_modules/react-native-web/dist/index.js"))};
      mock.module("react-native",()=>web);
      mock.module("react-native-reanimated",()=>({default:{View:web.View},ReduceMotion:{System:0},useSharedValue:value=>({value}),useAnimatedStyle:fn=>fn(),withSpring:value=>value}));`);
    const child = Bun.spawn([process.execPath, "--preload", preload, join(import.meta.dir, "render-fixture.tsx")], { stdout: "pipe", stderr: "pipe" });
    const text = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    expect(await child.exited, error).toBe(0);
    const rendered: { enabled: string; disabled: string } = JSON.parse(text);
    for (const label of ["Card title", "Count", "Table", "Key", "Value", "Choose yes", "Next", "Reviewed", "Started", "Today"]) expect(rendered.enabled).toContain(label);
    expect(rendered.enabled).toContain("&lt;script&gt;not executable&lt;/script&gt;");
    expect(rendered.enabled).not.toContain("<script>");
    expect(rendered.enabled).toContain('role="table"');
    expect(rendered.enabled).toContain('role="progressbar"');
    expect(rendered.enabled).toContain('aria-valuenow="45"');
    expect(rendered.enabled).toContain('role="checkbox"');
    expect(rendered.enabled).toContain('aria-checked="true"');
    expect(rendered.disabled).toContain('aria-disabled="true"');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);
