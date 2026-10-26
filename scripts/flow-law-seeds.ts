import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const seeds = [
  { law: "off", file: "app/src/lib/flow-trace.ts", before: "if (!enabled) return disabled;", after: "if (false) return disabled;", tests: ["app/src/lib/flow-trace.test.ts"] },
  { law: "L4", file: "app/src/lib/generative-stream.ts", before: "return Number.isSafeInteger(incoming) && incoming >= 0 && incoming === current;", after: "return true;", tests: ["app/src/lib/generative-generation.test.ts"] },
  { law: "L7", file: "app/src/components/genui/GenerativeBlock.tsx", before: "  if (state === \"loading\" || state === \"invalid\")", after: '  if (flowMode) return <CodeBlock code={code} language={language} />;\n  if (state === "loading" || state === "invalid")', tests: ["app/src/components/genui/flow-114.native.test.ts"] },
  { law: "L3", file: "app/src/store/annotate.ts", before: "drawing: flowMode ? s.drawing : EMPTY_DRAWING", after: "drawing: EMPTY_DRAWING", tests: ["app/src/store/annotation-flow.test.ts"] },
];
const out = resolve("docs/flow/wp1-3-evidence");
mkdirSync(out, { recursive: true });
for (const seed of seeds) {
  const original = readFileSync(seed.file, "utf8");
  if (!original.includes(seed.before) || original.indexOf(seed.before) !== original.lastIndexOf(seed.before)) throw new Error(`Seed no longer matches ${seed.law}`);
  try {
    writeFileSync(seed.file, original.replace(seed.before, seed.after));
    const child = Bun.spawn([process.execPath, "test", ...seed.tests], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    await Bun.write(resolve(out, `seed-${seed.law}.log`), stdout + stderr);
    if (code === 0 || !stderr.includes("(fail)")) throw new Error(`Violation survived or failed to execute: ${seed.law}`);
    console.log(`${seed.law}: seeded violation rejected (exit ${code})`);
  } finally { writeFileSync(seed.file, original); }
}
