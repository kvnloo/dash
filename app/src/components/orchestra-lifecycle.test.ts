import { expect, test } from "bun:test";

// The harness mounts the real Orchestra with react-dom/client in its own Bun process.
async function harness(mode: "switch" | "unmount") {
  const child = Bun.spawn([process.execPath, "orchestra-lifecycle.harness.tsx", mode], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit !== 0) throw new Error(stderr || stdout);
  return JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
}

test("50 switches across the 4 Orchestra views keep animations, mappers, listeners and gestures flat", async () => {
  const out = await harness("switch");
  expect(out.visits).toBe(50);
  for (const view of ["Fleet", "Lineage", "Work", "Triage"]) {
    // Every visit to a view leaves identical counts: nothing accumulates from earlier views.
    expect(out.distinct[view]).toHaveLength(1);
    const [counts] = out.distinct[view];
    // Only the app's one shared OrbMotion clock loops; wires and cards own no running animation.
    expect(counts.running).toBe(1);
    expect(counts.appState).toBe(1);
  }
  // Tabs, legend and footer stay mounted and must not rebuild their native gesture on every switch.
  expect(out.reattachesPerSwitch).toBe(0);
  // 15 sessions per host: hub spokes cap at 12 with a "+3 more" row.
  expect(out.hubMore).toBeGreaterThan(0);
});

test("unmounting the Orchestra mid-press cancels every animation and detaches every mapper and listener", async () => {
  const out = await harness("unmount");
  expect(out.pressed.running).toBeGreaterThan(1);
  expect(out.after).toEqual({ running: 0, mappers: 0, appState: 0, detectors: 0, elements: 0 });
});
