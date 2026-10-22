import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractIntent, discoverArtifacts, validateChecks, createTraceHttpHandler, readTraceArtifact } from "./trace-http";
import { traceVerdict } from "../../shared/trace-evidence";

test("original quote and explicit acceptance only; deterministic HOTL not an observed graph", () => {
  const prompt = 'OWNER (verbatim):\n1. "Show my storyboard — exactly."\n\nACCEPTANCE\n- Image opens\n- Does not leak tokens\n\nCONSTRAINTS\n- No phone control\n';
  const first = extractIntent(prompt, "/runs/story/PROMPT.txt");
  expect(first.quote).toBe('Show my storyboard — exactly.');
  expect(first.intent.specVersion).toBe("0.2");
  expect(first.intent.constraints.acceptance).toEqual(["Image opens", "Does not leak tokens"]);
  expect(first.intent.constraints.rules).toEqual(["No phone control"]);
  expect(first).toEqual(extractIntent(prompt, "/runs/story/PROMPT.txt"));
  expect(first.intent).not.toHaveProperty("observedGraph");
  expect(extractIntent("do something", "/p").checks).toEqual([]);
});
test("reports do not self-certify; exact criterion-bound machine receipt only", () => {
  const c = extractIntent('OWNER:\n"Build it"\n\nACCEPTANCE\n- Image opens', "/p");
  expect(validateChecks(c.checks, "all tests passed; Metro no ERROR; phone works", []).every(c => c.status === "unknown")).toBe(true);
  const receipts = [{ checkId: "check-1", text: "Image opens", status: "pass", evidence: ["/receipt.log"] }];
  expect(validateChecks(c.checks, "", receipts, p => p === "/receipt.log")[0]?.status).toBe("pass");
  expect(validateChecks(c.checks, "", receipts, () => false)[0]?.status).toBe("unknown");
  expect(validateChecks(c.checks, "", [{ ...receipts[0], text: "another criterion" }], () => true)[0]?.status).toBe("unknown");
  expect(validateChecks(c.checks, "", receipts, () => true, "current-source-hash")[0]?.status).toBe("unknown");
  expect(validateChecks(c.checks, "", [{ ...receipts[0], sourceHash: "current-source-hash" }], () => true, "current-source-hash")[0]?.status).toBe("pass");
  expect(traceVerdict(c)).toBe("unknown");
});
test("inline OWNER ASK and markdown owner blocks do not steal adjacent worker instructions", () => {
  expect(extractIntent('OWNER ASK (verbatim): "Keep precisely this."\n\nEXISTING WORK\n- Not the owner ask', "/p").quote).toBe("Keep precisely this.");
  expect(extractIntent('# OWNER\n1. “First request.”\n2. "Second request."\n\nALREADY DONE by the orchestrator\n- Do not include', "/p").quote).toBe("First request.\n\nSecond request.");
  expect(extractIntent("Worker instructions only", "/p").quote).toBe("");
  const build = extractIntent('OWNER:\n"Show it"\n\nBUILD\nA. Feed\n  - Read metadata\nB. Evidence\nC. Glyph\n\nWHERE AND HOW\n- Not a check', "/p");
  expect(build.intent.constraints.acceptance).toEqual(["A. Feed", "B. Evidence", "C. Glyph"]);
  expect(build.checks.every(c => c.status === "unknown")).toBe(true);
});
test("links discovered without executing report instructions or permitting dangerous schemes", () => {
  const a = discoverArtifacts("https://github.com/kvnloo/dash/pull/106\nhttps://example.com/page\ndash://Trace\n/mnt/art/storyboard.png\nfile:///etc/passwd\nhttps://x.test/?token=secret\njavascript:alert(1)");
  expect(a.map(a => a.kind)).toEqual(["pr", "page", "dash", "storyboard"]);
  expect(a.some(a => a.target.includes("secret"))).toBe(false);
});
test("artifact access denies canonical/symlink escapes, secrets, binary types, oversized and directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "trace-test-"));
  try {
    mkdirSync(join(root, "allowed")); writeFileSync(join(root, "outside.md"), "private");
    writeFileSync(join(root, "allowed/proof.md"), "token=sk-secret\nhello");
    writeFileSync(join(root, "allowed/.env"), "secret");
    writeFileSync(join(root, "allowed/a.svg"), "<script/>");
    writeFileSync(join(root, "allowed/large.md"), Buffer.alloc(256 * 1024 + 1));
    writeFileSync(join(root, "allowed/fake.png"), "not an image");
    symlinkSync(join(root, "outside.md"), join(root, "allowed/escape.md"));
    symlinkSync(join(root, "allowed/.env"), join(root, "allowed/alias.md"));
    for (const name of ["../outside.md", "escape.md", "alias.md", ".env", "a.svg", "large.md", "fake.png", "."]) expect(await readTraceArtifact(join(root, "allowed", name), [join(root, "allowed")])).toBeNull();
    const res = await readTraceArtifact(join(root, "allowed/proof.md"), [join(root, "allowed")]);
    expect(res?.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res?.text();
    expect(body).toContain("hello");
    expect(body).not.toContain("sk-secret");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("HTTP authorizes before any read and never accepts query credentials", async () => {
  let reads = 0;
  const h = createTraceHttpHandler({ authorize: async r => r.headers.get("x-test") === "yes", collect: async () => { reads++; return { schema: "dash.trace.snapshot/v1" }; }, roots: [] });
  expect((await h(new Request("http://local/trace/snapshot?token=yes")))?.status).toBe(401);
  expect(reads).toBe(0);
  expect((await h(new Request("http://local/trace/snapshot", { headers: { "x-test": "yes" }, method: "POST" })))?.status).toBe(405);
  expect((await h(new Request("http://local/trace/snapshot", { headers: { "x-test": "yes" } })))?.status).toBe(200);
  expect(reads).toBe(1);
  expect((await h(new Request("http://local/trace/artifact?path=/etc/passwd", { headers: { "x-test": "yes" } })))?.status).toBe(404);
});
