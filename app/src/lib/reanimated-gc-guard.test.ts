import { expect, test } from "bun:test";
import { join } from "node:path";

// Runs Reanimated's real PropsRegistryGarbageCollector source (native module mocked) in its own process.
async function run(guard: boolean) {
  const script = `
    import { mock } from "bun:test";
    const src = ${JSON.stringify(join(import.meta.dir, "../../node_modules/react-native-reanimated/src"))};
    mock.module(src + "/ReanimatedModule/index.ts", () => ({ ReanimatedModule: { getSettledUpdates: () => [] } }));
    mock.module(src + "/ReanimatedModule", () => ({ ReanimatedModule: { getSettledUpdates: () => [] } }));
    mock.module(src + "/common/style/processors/colors", () => ({ unprocessColor: c => c, unprocessColorsInProps: () => {} }));
    mock.module(src + "/common/style/processors/colors.ts", () => ({ unprocessColor: c => c, unprocessColorsInProps: () => {} }));
    const { PropsRegistryGarbageCollector: gc } = await import(src + "/PropsRegistryGarbageCollector.ts");
    if (${guard}) (await import(${JSON.stringify(join(import.meta.dir, "reanimated-gc-guard.ts"))})).guardPropsRegistryGC(gc);
    const state = () => ({ count: gc.viewsCount, views: gc.viewsMap.size, interval: gc.intervalId !== null });
    const steps = [];
    // A screen keeps one plain Animated.View (tag 2) mounted for the whole test.
    gc.registerView(2, "screen");
    // 20 Orchestra cards: <GestureDetector> + <Animated.View> share one tag, so each registers twice ...
    for (let tag = 10; tag < 30; tag++) { gc.registerView(tag, "inner"); gc.registerView(tag, "outer"); }
    steps.push(state());
    // ... and a view switch unmounts both components of every card.
    for (let tag = 10; tag < 30; tag++) { gc.unregisterView(tag); gc.unregisterView(tag); }
    steps.push(state());
    // The next view mounts 5 cards.
    for (let tag = 40; tag < 45; tag++) { gc.registerView(tag, "inner"); gc.registerView(tag, "outer"); }
    steps.push(state());
    gc.unregisterInterval();
    console.log(JSON.stringify(steps));
  `;
  const child = Bun.spawn([process.execPath, "-e", script], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit !== 0) throw new Error(stderr || stdout);
  return JSON.parse(stdout);
}

test("upstream Reanimated 4.5.1 GC loses its settle interval after nested GestureDetector views unmount", async () => {
  // Pins the upstream bug the guard exists for. If this starts failing, Reanimated fixed it: drop the guard.
  const [, afterSwitch, nextView] = await run(false);
  expect(afterSwitch).toEqual({ count: -19, views: 1, interval: false });
  expect(nextView).toEqual({ count: -14, views: 6, interval: false });
});

test("guarded GC keeps one count per mounted view and keeps pruning settled props while any view is mounted", async () => {
  expect(await run(true)).toEqual([
    { count: 21, views: 21, interval: true },
    { count: 1, views: 1, interval: true },
    { count: 6, views: 6, interval: true },
  ]);
});
