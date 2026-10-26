import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("L7 native #114 fixture: approved OpenUI roadmap, loaders and invalid states never expose source", async () => {
  const root = mkdtempSync(join(tmpdir(), "flow-114-"));
  try {
    const preload = join(root, "preload.ts");
    await Bun.write(preload, `import {mock} from "bun:test"; import {createElement} from ${JSON.stringify(Bun.resolveSync("react", resolve(import.meta.dir, "../../..")))};
      import * as web from ${JSON.stringify(resolve(import.meta.dir, "../../../node_modules/react-native-web/dist/index.js"))};
      mock.module(${JSON.stringify(Bun.resolveSync("react-native", resolve(import.meta.dir, "../../..")))},()=>({...web, Platform:{...web.Platform,OS:"android"}}));
      mock.module(${JSON.stringify(Bun.resolveSync("react-native-reanimated", resolve(import.meta.dir, "../../..")))},()=>({default:{View:web.View},useReducedMotion:()=>true,useSharedValue:value=>({value}),useAnimatedStyle:fn=>fn(),withSpring:value=>value,withTiming:value=>value,ReduceMotion:{System:0}}));
      mock.module(${JSON.stringify(Bun.resolveSync("expo-clipboard", resolve(import.meta.dir, "../../..")))},()=>({setStringAsync:async()=>{}}));
      mock.module(${JSON.stringify(join(import.meta.dir, "DiagramDOM.tsx"))},()=>({default:()=>createElement(web.Text,null,"DIAGRAM_MARKER")}));
      mock.module(${JSON.stringify(join(import.meta.dir, "InlineHTML.tsx"))},()=>({InlineHTML:()=>createElement(web.Text,null,"HTML_MARKER")}));
      const gesture=new Proxy({}, {get:()=>()=>gesture});
      mock.module(${JSON.stringify(Bun.resolveSync("react-native-gesture-handler", resolve(import.meta.dir, "../../..")))},()=>({GestureDetector:({children})=>children,Gesture:{Manual:()=>gesture}}));
    `);
    const child = Bun.spawn([process.execPath, "--preload", preload, join(import.meta.dir, "flow-114-fixture.tsx")], {
      env: { ...process.env, EXPO_PUBLIC_DASH_TURBO: "1", EXPO_PUBLIC_DASH_FLOW_MODE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const text = await new Response(child.stdout).text();
    const error = await new Response(child.stderr).text();
    expect(await child.exited, error).toBe(0);
    const rendered: Record<string, string> = JSON.parse(text);
    expect(rendered.ready).toContain("Dash");
    expect(rendered.partial).toContain('aria-label="Building interface"');
    expect(rendered.partial).toContain("Building interface…");
    expect(rendered.invalid).toContain('aria-label="Interface could not be rendered"');
    expect(rendered.widgets).toContain("WIDGET_MARKER");
    expect(rendered.openui).toContain("OPENUI_MARKER");
    expect(rendered.mermaid).toContain("DIAGRAM_MARKER");
    expect(rendered.html).toContain("HTML_MARKER");
    expect(rendered.pendingHtml).toContain("Interface could not be rendered");
    expect(rendered.streamingHtml).toContain("Building interface");
    expect(rendered.invalidWidgets).toContain("Interface could not be rendered");
    expect(rendered.invalid).toContain("Interface could not be rendered");
    expect(rendered.oversizedHtml).toContain("Interface could not be rendered");
    for (const key of ["ready", "partial", "invalid", "oversizedHtml"]) {
      expect(rendered[key]).not.toContain("Roadmap(");
      expect(rendered[key]).not.toContain("SENTINEL_RAW_SOURCE");
    }
    expect(rendered.ordinary?.replace(/<[^>]*>/g, "")).toContain("const count = 1");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);
