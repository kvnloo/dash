import { expect, test } from "bun:test";

test("L3 real annotation path: back preserves a committed flow draft but explicit Clear removes it", async () => {
  const child = Bun.spawn([process.execPath, "-e", `
    import {expect} from "bun:test";
    import {annotate,commitStroke,enterAnnotation,exitAnnotation,toggleAnnotation,clearStrokes} from "./app/src/store/annotate";
    enterAnnotation();
    commitStroke({tool:"pen",color:"accent",pointer:"stylus",points:[{x:0,y:0,p:0.5,t:1760000000000},{x:1,y:1,p:0.5,t:1760000000010}]});
    const strokes=annotate.get().drawing.strokes;
    exitAnnotation();
    expect(annotate.get().active).toBe(false);
    expect(annotate.get().drawing.strokes).toBe(strokes);
    toggleAnnotation();
    expect(annotate.get().drawing.strokes).toBe(strokes);
    clearStrokes(); expect(annotate.get().drawing.strokes).toHaveLength(0);
  `], { cwd: new URL("../../..", import.meta.url).pathname, env: { ...process.env, EXPO_PUBLIC_DASH_TURBO: "1", EXPO_PUBLIC_DASH_FLOW_MODE: "1" }, stdout: "pipe", stderr: "pipe" });
  const error = await new Response(child.stderr).text(); expect(await child.exited, error).toBe(0);
});
